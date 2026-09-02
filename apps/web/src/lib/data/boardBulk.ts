import { db } from '@/lib/db'
import { boardTasks } from '@/lib/db/schema'
import { eq, and, asc, sql, isNull } from 'drizzle-orm'
import { touchProject } from './projects'
import { planMoveAllToColumn } from '@/lib/utils/bulkMovePlan'

export type MovedTask = { id: string; name: string; orderIndex: number }

/**
 * Moves every live task in `fromColumnId` to the END of `toColumnId`,
 * preserving their relative order. The target column is advisory-locked for
 * the whole transaction before anything is read, so a concurrent bulk move
 * or create into the same column waits and then sees these indexes — a bare
 * read of the max inside the transaction would not stop two writers from
 * handing out the same slots.
 */
export async function moveAllTasksToColumn(
  projectId: string,
  fromColumnId: string,
  toColumnId: string,
): Promise<MovedTask[]> {
  const moved = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${toColumnId}))`)
    const source = await tx
      .select({ id: boardTasks.id, name: boardTasks.name, orderIndex: boardTasks.orderIndex })
      .from(boardTasks)
      .where(and(
        eq(boardTasks.projectId, projectId),
        eq(boardTasks.columnId, fromColumnId),
        isNull(boardTasks.archivedAt),
      ))
      .orderBy(asc(boardTasks.orderIndex))
    if (source.length === 0) return []

    const [target] = await tx
      .select({ max: sql<number>`coalesce(max(${boardTasks.orderIndex}), -1)` })
      .from(boardTasks)
      .where(and(eq(boardTasks.projectId, projectId), eq(boardTasks.columnId, toColumnId)))

    const plan = planMoveAllToColumn(source, Number(target?.max ?? -1))
    const now = new Date()
    for (const { id, orderIndex } of plan) {
      await tx
        .update(boardTasks)
        .set({ columnId: toColumnId, orderIndex, updatedAt: now })
        .where(and(eq(boardTasks.id, id), eq(boardTasks.projectId, projectId)))
    }
    const names = new Map(source.map((t) => [t.id, t.name]))
    return plan.map((p) => ({ ...p, name: names.get(p.id) ?? '' }))
  })

  if (moved.length > 0) await touchProject(projectId, { type: 'task:moved' })
  return moved
}
