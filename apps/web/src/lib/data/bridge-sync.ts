import { db } from '@/lib/db'
import { boardTasks, ganttTasks, checklistItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

/** The card a timeline write re-dated, and the version it now carries. */
export type BoardTaskStamp = { boardTaskId: string; updatedAt: string }

export async function syncBoardStatusToGantt(boardTaskId: string, newStatus: string) {
  const [boardTask] = await db
    .select({ ganttTaskId: boardTasks.ganttTaskId })
    .from(boardTasks)
    .where(eq(boardTasks.id, boardTaskId))

  if (!boardTask?.ganttTaskId) return

  if (newStatus === 'done') {
    await db
      .update(ganttTasks)
      .set({ progress: 100, updatedAt: new Date() })
      .where(eq(ganttTasks.id, boardTask.ganttTaskId))
  } else {
    const summary = await getChecklistProgress(boardTaskId)
    await db
      .update(ganttTasks)
      .set({ progress: summary, updatedAt: new Date() })
      .where(eq(ganttTasks.id, boardTask.ganttTaskId))
  }
}

/**
 * Copies a bar's dates onto its linked card, scoped to the project, and
 * returns the card's new updatedAt so the client can keep its version current.
 */
export async function syncGanttDatesToBoard(
  ganttTaskId: string,
  projectId: string,
  startDate: Date,
  endDate: Date,
): Promise<BoardTaskStamp | null> {
  const [ganttTask] = await db
    .select({ boardTaskId: ganttTasks.boardTaskId })
    .from(ganttTasks)
    .where(and(eq(ganttTasks.id, ganttTaskId), eq(ganttTasks.projectId, projectId)))

  if (!ganttTask?.boardTaskId) return null

  const updatedAt = new Date()
  await db
    .update(boardTasks)
    .set({ startDate, endDate, updatedAt })
    .where(and(eq(boardTasks.id, ganttTask.boardTaskId), eq(boardTasks.projectId, projectId)))
  return { boardTaskId: ganttTask.boardTaskId, updatedAt: updatedAt.toISOString() }
}

export async function syncChecklistToGanttProgress(taskId: string) {
  const [boardTask] = await db
    .select({ ganttTaskId: boardTasks.ganttTaskId, status: boardTasks.status })
    .from(boardTasks)
    .where(eq(boardTasks.id, taskId))

  if (!boardTask?.ganttTaskId) return
  if (boardTask.status === 'done') return

  const progress = await getChecklistProgress(taskId)
  await db
    .update(ganttTasks)
    .set({ progress, updatedAt: new Date() })
    .where(eq(ganttTasks.id, boardTask.ganttTaskId))
}

async function getChecklistProgress(taskId: string): Promise<number> {
  const items = await db
    .select({ state: checklistItems.state })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))

  if (items.length === 0) return 0
  const checked = items.filter((i) => i.state === 'checked').length
  return Math.round((checked / items.length) * 100)
}
