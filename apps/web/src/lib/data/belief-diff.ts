import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, memoryOps } from '@/lib/db/schema'

// Belief-ledger change rows for the weekly review's belief diff (docs/kairos/34
// §4, research/kairos_0110 G13). Pure read: the memory_ops rows written by the
// belief ledger (step 'beliefs', lib/data/beliefs.ts), the re-check cascade
// (step 'recheck', engine/steps/recheck.ts) and the own-mind step ('own_mind'),
// joined to their belief row for domain / mind / claim. Reverted ops are
// excluded. Classification lives with the caller (weekly-review/inputs.ts).

export const BELIEF_DIFF_STEPS = ['beliefs', 'recheck', 'own_mind'] as const
export const BELIEF_DIFF_ROW_CAP = 500

export interface BeliefDiffOpRow {
  opId: string
  memoryId: string | null
  step: string
  op: string
  reason: string
  after: Record<string, unknown> | null
  createdAt: Date
  // From the belief row (null when the op has no memory or it is gone).
  domain: string | null
  mind: string | null
  claim: string | null
}

export async function listBeliefDiffOps(
  userId: string,
  since: Date,
  until: Date,
  limit: number = BELIEF_DIFF_ROW_CAP,
): Promise<BeliefDiffOpRow[]> {
  const rows = await db
    .select({
      opId: memoryOps.id,
      memoryId: memoryOps.memoryId,
      step: memoryOps.step,
      op: memoryOps.op,
      reason: memoryOps.reason,
      after: memoryOps.after,
      createdAt: memoryOps.createdAt,
      domain: sql<string | null>`${memories.sourceMetadata}->'belief'->>'domain'`,
      mind: sql<string | null>`${memories.sourceMetadata}->'belief'->>'mind'`,
      claim: sql<string | null>`coalesce(${memories.sourceMetadata}->'belief'->>'claim', ${memories.title})`,
    })
    .from(memoryOps)
    .leftJoin(memories, and(eq(memories.id, memoryOps.memoryId), eq(memories.userId, userId)))
    .where(and(
      eq(memoryOps.userId, userId),
      inArray(memoryOps.step, [...BELIEF_DIFF_STEPS]),
      isNull(memoryOps.revertedAt),
      gte(memoryOps.createdAt, since),
      lt(memoryOps.createdAt, until),
    ))
    .orderBy(desc(memoryOps.createdAt))
    .limit(Math.min(Math.max(limit, 1), BELIEF_DIFF_ROW_CAP))
  return rows.map((r) => ({
    ...r,
    after: r.after && typeof r.after === 'object' && !Array.isArray(r.after) ? (r.after as Record<string, unknown>) : null,
  }))
}
