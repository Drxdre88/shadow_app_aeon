import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { isBelief, liveHeld } from './beliefs'

// Replay candidates (spec_surprise Lane 3) — pure DB reads, no policy. The
// scoring lives in lib/kairos/surprise/replay; the orchestration in
// lib/kairos/surprise/replay-reader.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuids = (ids: readonly string[]) => [...new Set(ids.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase()))]

export const REPLAY_ROW_CAP = 200
export const REPLAY_CITER_CAP = 200

// The live (not archived, superseded or invalidated) memories among `ids`.
export async function listReplayRows(userId: string, ids: readonly string[], now: Date) {
  const wanted = uuids(ids).slice(0, REPLAY_ROW_CAP)
  if (wanted.length === 0) return []
  return db
    .select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      dominionId: memories.dominionId,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      inArray(memories.id, wanted),
      isNull(memories.archivedAt),
      isNull(memories.supersededAt),
      sql`(${memories.invalidAt} IS NULL OR ${memories.invalidAt} > ${now.toISOString()}::timestamptz)`,
    ))
    .limit(REPLAY_ROW_CAP)
}

const provenance = sql`${memories.sourceMetadata}->'belief'->'provenance'`

// Live held beliefs (both minds) whose provenance cites any of `ids`.
export async function listReplayCiters(
  userId: string,
  ids: readonly string[],
): Promise<Array<{ id: string; dominionId: string | null; provenance: string[] }>> {
  const wanted = [...new Set(ids.filter((id) => id.length > 0 && id.length <= 100))].slice(0, REPLAY_ROW_CAP)
  if (wanted.length === 0) return []
  const rows = await db
    .select({ id: memories.id, dominionId: memories.dominionId, provenance: sql<unknown>`${provenance}` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isBelief,
      liveHeld,
      sql`jsonb_typeof(${provenance}) = 'array'`,
      sql`jsonb_exists_any(${provenance}, ARRAY[${sql.join(wanted.map((id) => sql`${id}`), sql`, `)}]::text[])`,
    ))
    .limit(REPLAY_CITER_CAP)
  return rows.map((r) => ({
    id: r.id,
    dominionId: r.dominionId,
    provenance: Array.isArray(r.provenance) ? r.provenance.filter((p): p is string => typeof p === 'string') : [],
  }))
}

// The replay sets stored on the most recent aether rows since `since`
// (sourceMetadata.surpriseReplay.ids), newest first. Archived rows count.
export async function listRecentReplaySets(userId: string, since: Date, limit = 2): Promise<string[][]> {
  const rows = await db
    .select({ ids: sql<unknown>`${memories.sourceMetadata}->'surpriseReplay'->'ids'` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'aether'),
      gte(memories.createdAt, since),
      sql`jsonb_typeof(${memories.sourceMetadata}->'surpriseReplay'->'ids') = 'array'`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
  return rows.map((r) => (Array.isArray(r.ids) ? r.ids.filter((x): x is string => typeof x === 'string') : []))
}
