import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3B — recipe trace history.
//
// Every recipe run writes one `streamClass='trace'` memory whose
// sourceMetadata records the recipe name, mode, duration, and the primary
// memory it produced. listTraceHistory exposes that audit trail so
// lieutenants (Oracle/Cartographer) and the operator can reason over prior
// runs: "what did BRIEF emit last week?", "did Cartographer fire today?".
//
// Recipe name filter probes `sourceMetadata->>'recipe'` — recipes always
// write the canonical name, but the schema doesn't enforce it, so callers
// shouldn't expect 100% recall for older traces.
//
// `since` bounds the scan by time (internal callers only — not on the
// MCP/REST validator). A time-bounded read may ask for up to
// SINCE_LIMIT_MAX rows (the health scorecard reads ~15 crons × Dominions of
// success/failure rows per night); unbounded reads keep the 100-row cap.
// ─────────────────────────────────────────────────────────────────────────

export interface ListTraceHistoryInput {
  dominionId?: string
  recipe?: string
  limit?: number
  since?: Date
}

const DEFAULT_LIMIT_MAX = 100
const SINCE_LIMIT_MAX = 2000

export interface TraceHistoryRow {
  id: string
  title: string
  summary: string | null
  dominionId: string | null
  sourceMetadata: unknown
  createdAt: Date
}

export async function listTraceHistory(
  userId: string,
  input: ListTraceHistoryInput = {},
): Promise<TraceHistoryRow[]> {
  const maxLimit = input.since ? SINCE_LIMIT_MAX : DEFAULT_LIMIT_MAX
  const limit = Math.min(Math.max(input.limit ?? 25, 1), maxLimit)

  const conditions = [
    eq(memories.userId, userId),
    eq(memories.streamClass, 'trace'),
    isNull(memories.archivedAt),
  ]
  if (input.dominionId) conditions.push(eq(memories.dominionId, input.dominionId))
  if (input.recipe) {
    conditions.push(sql`${memories.sourceMetadata}->>'recipe' = ${input.recipe}`)
  }
  if (input.since) conditions.push(gte(memories.createdAt, input.since))

  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      dominionId: memories.dominionId,
      sourceMetadata: memories.sourceMetadata,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.createdAt))
    .limit(limit)

  return rows
}
