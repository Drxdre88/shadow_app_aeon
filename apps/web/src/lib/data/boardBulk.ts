import { db } from '@/lib/db'
import { boardTasks } from '@/lib/db/schema'
import { eq, and, asc, sql, isNull } from 'drizzle-orm'
import { touchProject } from './projects'
import { planMoveAllToColumn } from '@/lib/utils/bulkMovePlan'

export type MovedTask = { id: string; name: string; orderIndex: number }

/**
 * Moves every live task in `fromColumnId` to the END of `toColumnId`,
 * preserving their relative order. The target's current max index is read
 * inside the same transaction as the writes so a concurrent create in the
 * target cannot hand two cards the same slot.
 */
export async function moveAllTasksToColumn(
  projectId: string,
  fromColumnId: string,
  toColumnId: string,
): Promise<MovedTask[]> {
  const moved = await db.transaction(async (tx) => {
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
