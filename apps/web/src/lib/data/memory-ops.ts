import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memoryOps } from '@/lib/db/schema'
import type { MemoryOpInput } from '@/lib/kairos/engine/types'

// Memory engine change log (docs/kairos/32 §2). Append-only data access —
// no business logic. Parent-owned shared surface for every engine lane.

export type MemoryOpRow = typeof memoryOps.$inferSelect

// A drizzle transaction handle, so a caller can log its ops in the same
// transaction as the memory write they describe.
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

// The ops a write must log atomically with itself: data-layer writers that
// take an OpLog insert it in the SAME transaction, so a failed op insert rolls
// the write back and a killed function never leaves a write without its op.
export interface OpLog {
  runId: string | null
  ops: readonly MemoryOpInput[]
}

const INSERT_CHUNK = 500

export async function insertMemoryOps(
  userId: string,
  runId: string | null,
  ops: readonly MemoryOpInput[],
  tx: DbExecutor = db,
): Promise<number> {
  let written = 0
  for (let i = 0; i < ops.length; i += INSERT_CHUNK) {
    const rows = ops.slice(i, i + INSERT_CHUNK).map((op) => ({
      userId,
      runId,
      memoryId: op.memoryId,
      step: op.step,
      op: op.op,
      before: op.before ?? null,
      after: op.after ?? null,
      reason: op.reason,
    }))
    const inserted = await tx.insert(memoryOps).values(rows).returning({ id: memoryOps.id })
    written += inserted.length
  }
  return written
}

export async function listMemoryOps(
  userId: string,
  opts: { memoryId?: string; runId?: string; ops?: string[]; steps?: string[]; includeReverted?: boolean; limit?: number } = {},
): Promise<MemoryOpRow[]> {
  const conditions = [eq(memoryOps.userId, userId)]
  if (opts.memoryId) conditions.push(eq(memoryOps.memoryId, opts.memoryId))
  if (opts.runId) conditions.push(eq(memoryOps.runId, opts.runId))
  if (opts.ops?.length) conditions.push(inArray(memoryOps.op, opts.ops))
  if (opts.steps?.length) conditions.push(inArray(memoryOps.step, opts.steps))
  if (!opts.includeReverted) conditions.push(isNull(memoryOps.revertedAt))
  return db
    .select()
    .from(memoryOps)
    .where(and(...conditions))
    .orderBy(desc(memoryOps.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 500))
}

export async function findMemoryOp(userId: string, opId: string): Promise<MemoryOpRow | null> {
  const [row] = await db
    .select()
    .from(memoryOps)
    .where(and(eq(memoryOps.id, opId), eq(memoryOps.userId, userId)))
    .limit(1)
  return row ?? null
}

// Marks an op reverted. Returns false when it was already reverted (lost race).
export async function markMemoryOpReverted(userId: string, opId: string, revertedByOpId: string | null): Promise<boolean> {
  const updated = await db
    .update(memoryOps)
    .set({ revertedAt: new Date(), revertedByOpId })
    .where(and(eq(memoryOps.id, opId), eq(memoryOps.userId, userId), isNull(memoryOps.revertedAt)))
    .returning({ id: memoryOps.id })
  return updated.length > 0
}
