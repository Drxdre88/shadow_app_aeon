import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

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
// ─────────────────────────────────────────────────────────────────────────

export interface ListTraceHistoryInput {
  dominionId?: string
  recipe?: string
  limit?: number
}

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
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100)

  const conditions = [
    eq(memories.userId, userId),
    eq(memories.streamClass, 'trace'),
    isNull(memories.archivedAt),
  ]
  if (input.dominionId) conditions.push(eq(memories.dominionId, input.dominionId))
  if (input.recipe) {
    conditions.push(sql`${memories.sourceMetadata}->>'recipe' = ${input.recipe}`)
  }

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
