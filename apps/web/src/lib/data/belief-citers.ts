import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { isBelief, liveHeld } from './beliefs'

// Who cites what (spec_surprise lane 2, backward credit). Pure DB reads, no
// policy: lib/kairos/surprise/credit decides shares, caps and directions.

export const BELIEF_CITERS_CAP = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface BeliefCiter {
  id: string
  dominionId: string | null
  provenance: string[]
}

const provenance = sql`${memories.sourceMetadata}->'belief'->'provenance'`

// Live held beliefs (either mind) among `ids`.
export async function listHeldBeliefIdsAmong(userId: string, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))]
  if (unique.length === 0) return []
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, unique), isBelief, liveHeld))
  return rows.map((r) => r.id)
}

// Live held beliefs whose belief.provenance contains at least one of `ids`
// (≤ BELIEF_CITERS_CAP, oldest first for a stable order).
export async function listBeliefCiters(userId: string, ids: readonly string[], limit = BELIEF_CITERS_CAP): Promise<BeliefCiter[]> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))]
  if (unique.length === 0) return []
  const wanted = sql`ARRAY[${sql.join(unique.map((id) => sql`${id}`), sql`, `)}]::text[]`
  const rows = await db
    .select({ id: memories.id, dominionId: memories.dominionId, provenance: sql<unknown>`${provenance}` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isBelief,
      liveHeld,
      sql`jsonb_typeof(${provenance}) = 'array'`,
      sql`${provenance} ?| ${wanted}`,
    ))
    .orderBy(asc(memories.createdAt), asc(memories.id))
    .limit(Math.min(Math.max(limit, 1), BELIEF_CITERS_CAP))
  return rows.map((r) => ({
    id: r.id,
    dominionId: r.dominionId,
    provenance: Array.isArray(r.provenance) ? r.provenance.filter((p): p is string => typeof p === 'string') : [],
  }))
}
