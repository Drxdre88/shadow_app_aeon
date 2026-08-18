import { db } from '@/lib/db'
import { checklistItems, boardTasks } from '@/lib/db/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
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
    .orderBy(checklistItems.orderIndex, checklistItems.createdAt, checklistItems.id)
}

export async function findChecklistItemsBatch(taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, { title: string; groupName: string }[]>()
  const rows = await db
    .select({ taskId: checklistItems.taskId, title: checklistItems.title, groupName: checklistItems.groupName })
    .from(checklistItems)
    .where(inArray(checklistItems.taskId, taskIds))
    .orderBy(checklistItems.orderIndex, checklistItems.createdAt, checklistItems.id)

  const result = new Map<string, { title: string; groupName: string }[]>()
  for (const row of rows) {
    if (!result.has(row.taskId)) result.set(row.taskId, [])
    result.get(row.taskId)!.push({ title: row.title, groupName: row.groupName })
  }
  return result
}

export async function createChecklistItem(
  taskId: string,
  data: { id?: string; title: string; groupName?: string; orderIndex?: number }
) {
  // onConflictDoNothing makes offline-queue replays idempotent server-side:
  // production masks Server Action error messages, so the client cannot
  // classify a duplicate-key rejection — the replay must simply succeed and
  // hand back the row that already landed.
  const [item] = await db.transaction(async (tx) => {
    if (data.orderIndex !== undefined) {
      return tx
        .insert(checklistItems)
        .values({
          ...(data.id ? { id: data.id } : {}),
          taskId,
          title: data.title,
          completed: false,
          state: 'unchecked',
          groupName: data.groupName ?? 'Checklist',
          orderIndex: data.orderIndex,
        })
        .onConflictDoNothing()
        .returning()
    }

    const [maxResult] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${checklistItems.orderIndex}), -1)` })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId))

    return tx
      .insert(checklistItems)
      .values({
        ...(data.id ? { id: data.id } : {}),
        taskId,
        title: data.title,
        completed: false,
        state: 'unchecked',
        groupName: data.groupName ?? 'Checklist',
        orderIndex: (maxResult?.max ?? -1) + 1,
      })
      .onConflictDoNothing()
      .returning()
  })

  if (!item && data.id) {
    // Conflict: this id already landed on a prior attempt — return that row.
    const [existing] = await db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.id, data.id), eq(checklistItems.taskId, taskId)))
    if (!existing) {
      // The id exists but belongs to a different task — only a malicious or
      // corrupted client can produce this; fail loudly rather than resolving
      // undefined and letting the queue record a success that never landed.
      throw new Error('Checklist item id conflict')
    }
    syncChecklistToGanttProgress(taskId).catch(() => {})
    return existing
  }

  syncChecklistToGanttProgress(taskId).catch(() => {})
  return item
}

export async function createChecklistItemsBatch(
  taskId: string,
  items: { title: string; groupName?: string }[]
) {
  if (items.length === 0) return []

  const created = await db.transaction(async (tx) => {
    const [maxResult] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${checklistItems.orderIndex}), -1)` })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId))

    let nextIndex = (maxResult?.max ?? -1) + 1

    const values = items.map((item) => ({
      taskId,
      title: item.title,
      completed: false,
      state: 'unchecked',
      groupName: item.groupName ?? 'Checklist',
      orderIndex: nextIndex++,
    }))

    return tx.insert(checklistItems).values(values).returning()
  })

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
    groupName?: string
  }
) {
  const dbUpdates: Record<string, unknown> = {}
  if (updates.title !== undefined) dbUpdates.title = updates.title
  if (updates.state !== undefined) {
    dbUpdates.state = updates.state
    dbUpdates.completed = updates.state === 'checked'
  }
  if (updates.status !== undefined) dbUpdates.status = updates.status
  if (updates.groupName !== undefined) dbUpdates.groupName = updates.groupName

  const [item] = await db
    .update(checklistItems)
    .set(dbUpdates)
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.taskId, taskId)))
    .returning()

  syncChecklistToGanttProgress(taskId).catch(() => {})
  return item ?? null
}

export async function renameChecklistGroup(
  taskId: string,
  oldName: string,
  newName: string
) {
  const items = await db
    .select({ id: checklistItems.id })
    .from(checklistItems)
    .where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.groupName, oldName)))

  if (items.length === 0) return 0

  await db
    .update(checklistItems)
    .set({ groupName: newName })
    .where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.groupName, oldName)))

  return items.length
}

export async function updateChecklistItemsBatch(
  taskId: string,
  items: { itemId: string; state?: 'unchecked' | 'checked' | 'crossed'; title?: string; status?: string | null }[]
) {
  if (items.length === 0) return []

  const results: Array<{ id: string; title: string; state: string }> = []

  const byState = new Map<string, string[]>()
  const customUpdates: typeof items = []

  for (const item of items) {
    const hasTitle = item.title !== undefined
    const hasStatus = item.status !== undefined
    if ((hasTitle || hasStatus) && item.state) {
      customUpdates.push(item)
    } else if (item.state && !hasTitle && !hasStatus) {
      const ids = byState.get(item.state) ?? []
      ids.push(item.itemId)
      byState.set(item.state, ids)
    } else {
      customUpdates.push(item)
    }
  }

  for (const [state, ids] of byState) {
    const updated = await db
      .update(checklistItems)
      .set({ state, completed: state === 'checked' })
      .where(and(eq(checklistItems.taskId, taskId), inArray(checklistItems.id, ids)))
      .returning({ id: checklistItems.id, title: checklistItems.title, state: checklistItems.state })
    results.push(...updated)
  }

  if (customUpdates.length > 0) {
    await db.transaction(async (tx) => {
      for (const item of customUpdates) {
        const dbUpdates: Record<string, unknown> = {}
        if (item.state !== undefined) { dbUpdates.state = item.state; dbUpdates.completed = item.state === 'checked' }
        if (item.title !== undefined) dbUpdates.title = item.title
        if (item.status !== undefined) dbUpdates.status = item.status
        const [updated] = await tx
          .update(checklistItems)
          .set(dbUpdates)
          .where(and(eq(checklistItems.id, item.itemId), eq(checklistItems.taskId, taskId)))
          .returning({ id: checklistItems.id, title: checklistItems.title, state: checklistItems.state })
        if (updated) results.push(updated)
      }
    })
  }

  syncChecklistToGanttProgress(taskId).catch(() => {})
  return results
}

export async function reorderChecklistItems(
  taskId: string,
  updates: { id: string; orderIndex: number; groupName?: string }[]
) {
  if (updates.length === 0) return
  await db.transaction(async (tx) => {
    for (const u of updates) {
      const set: Record<string, unknown> = { orderIndex: u.orderIndex }
      // Cross-group drags carry a new groupName; persist it in the same pass.
      if (u.groupName !== undefined) set.groupName = u.groupName
      await tx.update(checklistItems)
        .set(set)
        .where(and(eq(checklistItems.id, u.id), eq(checklistItems.taskId, taskId)))
    }
  })
}

export async function deleteChecklistGroup(taskId: string, groupName: string) {
  const deleted = await db
    .delete(checklistItems)
    .where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.groupName, groupName)))
    .returning({ id: checklistItems.id })

  syncChecklistToGanttProgress(taskId).catch(() => {})
  return deleted.length
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

  const { findLabelsForTask } = await import('./labels')
  const { findDependenciesForTask } = await import('./dependencies')

  const [items, taskLabelRows, taskDeps] = await Promise.all([
    findChecklistItems(taskId, projectId),
    findLabelsForTask(taskId, projectId),
    findDependenciesForTask(taskId),
  ])

  return {
    ...task,
    labels: taskLabelRows.map((tl) => tl.labelId),
    checklist: items,
    blocks: taskDeps.filter((d) => d.blockerTaskId === taskId).map((d) => d.blockedTaskId),
    blockedBy: taskDeps.filter((d) => d.blockedTaskId === taskId).map((d) => d.blockerTaskId),
  }
}

export async function findChecklistSummariesAndPreviews(projectId: string) {
  const items = await db
    .select({
      taskId: checklistItems.taskId,
      title: checklistItems.title,
      state: checklistItems.state,
      groupName: checklistItems.groupName,
      orderIndex: checklistItems.orderIndex,
    })
    .from(checklistItems)
    .innerJoin(boardTasks, eq(boardTasks.id, checklistItems.taskId))
    .where(eq(boardTasks.projectId, projectId))
    .orderBy(checklistItems.orderIndex, checklistItems.createdAt, checklistItems.id)

  const summaries: Record<string, { checked: number; crossed: number; total: number }> = {}
  const previews: Record<string, { title: string; state: string; groupName: string }[]> = {}
  for (const item of items) {
    if (!summaries[item.taskId]) summaries[item.taskId] = { checked: 0, crossed: 0, total: 0 }
    summaries[item.taskId].total++
    if (item.state === 'checked') summaries[item.taskId].checked++
    if (item.state === 'crossed') summaries[item.taskId].crossed++

    if (!previews[item.taskId]) previews[item.taskId] = []
    previews[item.taskId].push({
      title: item.title,
      state: item.state,
      groupName: item.groupName,
    })
  }
  return { summaries, previews }
}

