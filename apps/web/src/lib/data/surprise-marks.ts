import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import type { DbExecutor } from '@/lib/data/memory-ops'
import { isBelief, liveHeld } from './beliefs'
import { SURPRISE_MAX_SIGNALS, surpriseSignalSchema, type SurpriseSignal } from './validators/kairos-surprise'

// Surprise marks (spec_surprise Wave 0): memories.source_metadata.engine.surprise
// = { openUntil, signals[≤5], pressure? }. One atomic jsonb_set per write (no
// read-modify-write), modelled on outcomeAdjustSql. NEVER bumps updatedAt —
// that column drives confidence decay. No memory_ops row: the surprise ledger
// is the audit trail. Lives under engine.*, never inside sourceMetadata.belief
// (beliefV1Schema is strict).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const obj = (expr: SQL) => sql`(CASE WHEN jsonb_typeof(${expr}) = 'object' THEN ${expr} ELSE '{}'::jsonb END)`

// The new engine.surprise: keeps unknown keys (pressure …), sets openUntil to
// the later of stored/new (ISO-Z strings compare bytewise), drops any stored
// signal with the same (kind, ref), appends the new one, keeps the last 5.
export function surpriseMarkSql(signal: SurpriseSignal, openUntil: string) {
  const sm = obj(sql`${memories.sourceMetadata}`)
  const engine = obj(sql`${sm} -> 'engine'`)
  const mark = obj(sql`${engine} -> 'surprise'`)
  const stored = sql`(CASE WHEN jsonb_typeof(${mark} -> 'signals') = 'array' THEN ${mark} -> 'signals' ELSE '[]'::jsonb END)`
  const kept = sql`(SELECT COALESCE(jsonb_agg(f.e ORDER BY f.ord), '[]'::jsonb) FROM jsonb_array_elements(${stored}) WITH ORDINALITY AS f(e, ord) WHERE jsonb_typeof(f.e) = 'object' AND NOT (COALESCE(f.e ->> 'kind', '') = ${signal.kind} AND COALESCE(f.e ->> 'ref', '') = ${signal.ref}))`
  const merged = sql`(${kept} || jsonb_build_array(${JSON.stringify(signal)}::jsonb))`
  const capped = sql`(SELECT COALESCE(jsonb_agg(x.e ORDER BY x.ord), '[]'::jsonb) FROM (SELECT t.e, t.ord FROM jsonb_array_elements(${merged}) WITH ORDINALITY AS t(e, ord) ORDER BY t.ord DESC LIMIT ${sql.raw(String(SURPRISE_MAX_SIGNALS))}) x)`
  const until = sql`(CASE WHEN jsonb_typeof(${mark} -> 'openUntil') = 'string' AND (${mark} ->> 'openUntil') COLLATE "C" > ${openUntil} THEN ${mark} -> 'openUntil' ELSE to_jsonb(${openUntil}::text) END)`
  return sql`jsonb_set(
    jsonb_set(${sm}, '{engine}', ${engine}, true),
    '{engine,surprise}',
    ${mark} || jsonb_build_object('openUntil', ${until}, 'signals', ${capped}),
    true
  )`
}

// Opens (or keeps open) the given memories for update until `openUntil`,
// merging `signal`. Non-uuid ids are skipped. Returns the ids touched.
// Throws on DB failure — best-effort wrappers live in lib/kairos/surprise.
export async function openForUpdate(
  userId: string,
  ids: readonly string[],
  signal: SurpriseSignal,
  openUntil: Date | string,
  tx: DbExecutor = db,
): Promise<string[]> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase()))]
  if (unique.length === 0) return []
  const parsed = surpriseSignalSchema.parse(signal)
  const until = typeof openUntil === 'string' ? new Date(openUntil).toISOString() : openUntil.toISOString()
  const rows = await tx
    .update(memories)
    .set({ sourceMetadata: surpriseMarkSql(parsed, until) })
    .where(and(eq(memories.userId, userId), inArray(memories.id, unique)))
    .returning({ id: memories.id })
  return rows.map((r) => r.id)
}

const openUntilText = sql`(${memories.sourceMetadata} #>> '{engine,surprise,openUntil}')`

// Memories whose mark is open at `now` (openUntil > now), latest-closing
// first. beliefsOnly → live held beliefs only.
export async function listOpenMemoryIds(
  userId: string,
  now: Date,
  opts: { beliefsOnly?: boolean; limit?: number } = {},
): Promise<string[]> {
  const conds = [eq(memories.userId, userId), sql`${openUntilText} COLLATE "C" > ${now.toISOString()}`]
  if (opts.beliefsOnly) conds.push(isBelief, liveHeld)
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(...conds))
    .orderBy(desc(openUntilText))
    .limit(opts.limit ?? 50)
  return rows.map((r) => r.id)
}
