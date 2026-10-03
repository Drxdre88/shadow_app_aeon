import { and, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { beliefField, isBelief, liveHeld } from './beliefs'

// Surprise gate data access (spec_surprise Lane 1): the SurpriseStep's mark
// upkeep (prune, pressure valve) and the readers the owner-correction signals
// use. Pure DB. Like lib/data/surprise-marks, every write is one atomic jsonb
// statement that NEVER bumps updatedAt (it drives confidence decay) and logs
// no memory_ops row (the surprise ledger is the audit trail).

const sm = sql`${memories.sourceMetadata}`
const mark = sql`(${sm} -> 'engine' -> 'surprise')`
const alignedHeld = (userId: string): SQL[] => [eq(memories.userId, userId), isBelief, liveHeld, sql`${beliefField('mind')} = 'aligned'`]

// Drops mark signals older than `cutoff`, and a pressure counter that started
// before it; a mark left closed, signal-less and pressure-less is removed.
export function pruneMarkSql(cutoff: string, now: string) {
  const signals = sql`(CASE WHEN jsonb_typeof(${mark} -> 'signals') = 'array' THEN ${mark} -> 'signals' ELSE '[]'::jsonb END)`
  const kept = sql`(SELECT COALESCE(jsonb_agg(f.e ORDER BY f.ord), '[]'::jsonb) FROM jsonb_array_elements(${signals}) WITH ORDINALITY AS f(e, ord) WHERE (f.e ->> 'at') COLLATE "C" >= ${cutoff})`
  const stalePressure = sql`COALESCE((${mark} -> 'pressure' ->> 'since') COLLATE "C" < ${cutoff}, false)`
  const closed = sql`NOT COALESCE((${mark} ->> 'openUntil') COLLATE "C" > ${now}, false)`
  const next = sql`((CASE WHEN ${stalePressure} THEN ${mark} - 'pressure' ELSE ${mark} END) || jsonb_build_object('signals', ${kept}))`
  const set = sql`(CASE WHEN ${kept} = '[]'::jsonb AND ${closed} AND (${mark} -> 'pressure' IS NULL OR ${stalePressure})
    THEN ${sm} #- '{engine,surprise}'
    ELSE jsonb_set(${sm}, '{engine,surprise}', ${next}, true) END)`
  const due = sql`(jsonb_typeof(${mark}) = 'object' AND (
    EXISTS (SELECT 1 FROM jsonb_array_elements(${signals}) AS s(e) WHERE (s.e ->> 'at') COLLATE "C" < ${cutoff})
    OR ${stalePressure}))`
  return { set, due }
}

// Returns how many rows were pruned.
export async function pruneSurpriseMarks(userId: string, now: Date, windowMs: number): Promise<number> {
  const { set, due } = pruneMarkSql(new Date(now.getTime() - windowMs).toISOString(), now.toISOString())
  const rows = await db
    .update(memories)
    .set({ sourceMetadata: set })
    .where(and(eq(memories.userId, userId), due))
    .returning({ id: memories.id })
  return rows.length
}

// Held aligned beliefs whose pressure reached `min` within the window, not
// open now, and not defended by the operator (a reverted retire).
export async function listPressuredBeliefs(
  userId: string,
  now: Date,
  opts: { min: number; windowMs: number; limit: number },
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - opts.windowMs).toISOString()
  const n = sql`(CASE WHEN jsonb_typeof(${mark} -> 'pressure' -> 'n') = 'number' THEN (${mark} -> 'pressure' ->> 'n')::numeric ELSE 0 END)`
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(
      ...alignedHeld(userId),
      sql`${n} >= ${opts.min}`,
      sql`(${mark} -> 'pressure' ->> 'since') COLLATE "C" >= ${cutoff}`,
      sql`NOT COALESCE((${mark} ->> 'openUntil') COLLATE "C" > ${now.toISOString()}, false)`,
      sql`(${sm} -> 'engine' -> 'vetoes' -> 'retire') IS NULL`,
    ))
    .orderBy(desc(n), desc(memories.id))
    .limit(Math.min(Math.max(opts.limit, 1), 50))
  return rows.map((r) => r.id)
}

// Resets the pressure counter once the valve has opened the belief.
export async function clearSurprisePressure(userId: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0
  const rows = await db
    .update(memories)
    .set({ sourceMetadata: sql`${sm} #- '{engine,surprise,pressure}'` })
    .where(and(eq(memories.userId, userId), inArray(memories.id, [...ids])))
    .returning({ id: memories.id })
  return rows.length
}

// Held aligned beliefs citing any of `provenance` (an owner correction's
// shared-provenance neighbours), newest first.
export async function listProvenanceNeighbours(
  userId: string,
  provenance: readonly string[],
  exclude: readonly string[],
  limit = 5,
): Promise<string[]> {
  const ids = [...new Set(provenance)].filter((id) => id.length > 0)
  if (ids.length === 0) return []
  const conds: SQL[] = [
    ...alignedHeld(userId),
    sql`jsonb_typeof(${sm} -> 'belief' -> 'provenance') = 'array'`,
    sql`(${sm} -> 'belief' -> 'provenance') ?| ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`,
  ]
  if (exclude.length) conds.push(notInArray(memories.id, [...exclude]))
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(...conds))
    .orderBy(desc(memories.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 20))
  return rows.map((r) => r.id)
}

// Full-text match of held aligned beliefs against OR-ed `terms` (already
// sanitised to [a-z0-9]). No embedding call. Rank normalised to [0,1).
export async function matchHeldBeliefsByText(
  userId: string,
  terms: readonly string[],
  limit = 2,
): Promise<Array<{ id: string; rank: number }>> {
  const safe = terms.filter((t) => /^[a-z0-9]+$/.test(t))
  if (safe.length === 0) return []
  const q = sql`to_tsquery('english', ${safe.join(' | ')})`
  const rank = sql<number>`ts_rank_cd("memories"."fts", ${q}, 32)`
  const rows = await db
    .select({ id: memories.id, rank })
    .from(memories)
    .where(and(...alignedHeld(userId), sql`"memories"."fts" @@ ${q}`))
    .orderBy(desc(rank), desc(memories.id))
    .limit(Math.min(Math.max(limit, 1), 10))
  return rows.map((r) => ({ id: r.id, rank: Number(r.rank) || 0 }))
}
