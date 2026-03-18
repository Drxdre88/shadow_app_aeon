import { db } from '@/lib/db'
import { checklistItems, boardTasks } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { syncChecklistToGanttProgress } from './bridge'

export async function findChecklistItems(taskId: string, projectId: string) {
  return db
    .select({
      id: checklistItems.id,
      taskId: checklistItems.taskId,
      title: checklistItems.title,
      completed: checklistItems.completed,
      state: checklistItems.state,
      status: checklistItems.status,
      groupName: checklistItems.groupName,
      startDate: checklistItems.startDate,
      endDate: checklistItems.endDate,
      orderIndex: checklistItems.orderIndex,
      createdAt: checklistItems.createdAt,
    })
    .from(checklistItems)
    .innerJoin(boardTasks, eq(boardTasks.id, checklistItems.taskId))
    .where(and(eq(checklistItems.taskId, taskId), eq(boardTasks.projectId, projectId)))
    .orderBy(checklistItems.orderIndex)
}

export async function createChecklistItem(
  taskId: string,
  data: { title: string; groupName?: string; orderIndex?: number }
) {
  const existing = await db
    .select({ orderIndex: checklistItems.orderIndex })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))

  const [item] = await db
    .insert(checklistItems)
    .values({
      taskId,
      title: data.title,
      completed: false,
      state: 'unchecked',
      groupName: data.groupName ?? 'Checklist',
      orderIndex: data.orderIndex ?? existing.length,
    })
    .returning()

  syncChecklistToGanttProgress(taskId).catch(() => {})
  return item
}

export async function createChecklistItemsBatch(
  taskId: string,
  items: { title: string; groupName?: string }[]
) {
  if (items.length === 0) return []

  const existing = await db
    .select({ orderIndex: checklistItems.orderIndex })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))

  let nextIndex = existing.length

  const values = items.map((item) => ({
    taskId,
    title: item.title,
    completed: false,
    state: 'unchecked',
    groupName: item.groupName ?? 'Checklist',
    orderIndex: nextIndex++,
  }))

  const created = await db.insert(checklistItems).values(values).returning()
  syncChecklistToGanttProgress(taskId).catch(() => {})
  return created
}

export async function updateChecklistItem(
  itemId: string,
  taskId: string,
  updates: {
    title?: string
    state?: 'unchecked' | 'checked' | 'crossed'
    status?: string | null
  }
) {
  const dbUpdates: Record<string, unknown> = {}
  if (updates.title !== undefined) dbUpdates.title = updates.title
  if (updates.state !== undefined) {
    dbUpdates.state = updates.state
    dbUpdates.completed = updates.state === 'checked'
  }
  if (updates.status !== undefined) dbUpdates.status = updates.status

  const [item] = await db
    .update(checklistItems)
    .set(dbUpdates)
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.taskId, taskId)))
    .returning()

  syncChecklistToGanttProgress(taskId).catch(() => {})
  return item ?? null
}

export async function deleteChecklistItem(itemId: string, taskId: string) {
  const [deleted] = await db
    .delete(checklistItems)
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.taskId, taskId)))
    .returning()

  syncChecklistToGanttProgress(taskId).catch(() => {})
  return !!deleted
}

export async function findTaskWithDetails(taskId: string, projectId: string) {
  const [task] = await db
    .select()
    .from(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))

  if (!task) return null

  const items = await findChecklistItems(taskId, projectId)

  const { findTaskLabels } = await import('./labels')
  const taskLabels = await findTaskLabels(task.projectId)
  const assignedLabels = taskLabels
    .filter((tl) => tl.taskId === taskId)
    .map((tl) => tl.labelId)

  const { findDependencies } = await import('./dependencies')
  const allDeps = await findDependencies(task.projectId)
  const blocks = allDeps
    .filter((d) => d.blockerTaskId === taskId)
    .map((d) => d.blockedTaskId)
  const blockedBy = allDeps
    .filter((d) => d.blockedTaskId === taskId)
    .map((d) => d.blockerTaskId)

  return {
    ...task,
    labels: assignedLabels,
    checklist: items,
    blocks,
    blockedBy,
  }
}

export async function findChecklistSummaries(projectId: string) {
  const items = await db
    .select({ taskId: checklistItems.taskId, state: checklistItems.state })
    .from(checklistItems)
    .innerJoin(boardTasks, eq(checklistItems.taskId, boardTasks.id))
    .where(eq(boardTasks.projectId, projectId))

  const summaries: Record<string, { checked: number; crossed: number; total: number }> = {}
  for (const item of items) {
    if (!summaries[item.taskId]) summaries[item.taskId] = { checked: 0, crossed: 0, total: 0 }
    summaries[item.taskId].total++
    if (item.state === 'checked') summaries[item.taskId].checked++
    if (item.state === 'crossed') summaries[item.taskId].crossed++
  }
  return summaries
}
