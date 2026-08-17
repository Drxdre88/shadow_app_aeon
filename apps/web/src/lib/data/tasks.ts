import { db } from '@/lib/db'
import { boardTasks, memories } from '@/lib/db/schema'
import { eq, and, asc, sql, isNull, isNotNull, inArray } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { CreateTaskInput, UpdateTaskInput } from './validators'
import { touchProject } from './projects'

export async function findTasks(
  projectId: string,
  filters?: { status?: string; priority?: string },
  limit = 200,
  offset = 0
) {
  const conditions = [eq(boardTasks.projectId, projectId), isNull(boardTasks.archivedAt)]
  if (filters?.status) conditions.push(eq(boardTasks.status, filters.status))
  if (filters?.priority) conditions.push(eq(boardTasks.priority, filters.priority))

  return db
    .select()
    .from(boardTasks)
    .where(and(...conditions))
    .orderBy(asc(boardTasks.orderIndex))
    .limit(limit)
    .offset(offset)
}

export async function findTasksByColumn(projectId: string, columnId: string) {
  return db
    .select()
    .from(boardTasks)
    .where(and(eq(boardTasks.projectId, projectId), eq(boardTasks.columnId, columnId), isNull(boardTasks.archivedAt)))
    .orderBy(asc(boardTasks.orderIndex))
}

export async function findTaskById(taskId: string, projectId: string) {
  const [task] = await db
    .select()
    .from(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))

  return task || null
}

export async function createTask(
  projectId: string,
  data: CreateTaskInput,
  clientId?: string
) {
  const baseValues = {
    ...(clientId ? { id: clientId } : {}),
    projectId,
    name: data.name,
    description: data.description || null,
    columnId: data.columnId || null,
    status: data.status,
    priority: data.priority,
    color: data.color,
    onTimeline: data.onTimeline,
    size: data.size ?? null,
    startDate: data.startDate ? new Date(data.startDate) : null,
    endDate: data.endDate ? new Date(data.endDate) : null,
  }

  if (data.orderIndex !== undefined) {
    const [task] = await db
      .insert(boardTasks)
      .values({ ...baseValues, orderIndex: data.orderIndex })
      .returning()
    await touchProject(projectId, { type: 'task:created' })
    return task
  }

  const [task] = await db.transaction(async (tx) => {
    const filterCol = data.columnId
      ? eq(boardTasks.columnId, data.columnId)
      : eq(boardTasks.status, data.status)

    const [result] = await tx
      .select({ max: sql<number>`coalesce(max(${boardTasks.orderIndex}), -1)` })
      .from(boardTasks)
      .where(and(eq(boardTasks.projectId, projectId), filterCol))

    return tx
      .insert(boardTasks)
      .values({ ...baseValues, orderIndex: result.max + 1 })
      .returning()
  })

  await touchProject(projectId, { type: 'task:created' })
  return task
}

export async function updateTask(
  taskId: string,
  projectId: string,
  data: UpdateTaskInput
) {
  const updates: Partial<typeof boardTasks.$inferInsert> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description ?? null
  if (data.columnId !== undefined) updates.columnId = data.columnId
  if (data.status !== undefined) {
    updates.status = data.status
    if (data.status === 'done') {
      updates.completedAt = new Date()
    } else {
      updates.completedAt = null
    }
  }
  if (data.priority !== undefined) updates.priority = data.priority
  if (data.color !== undefined) updates.color = data.color
  if (data.onTimeline !== undefined) updates.onTimeline = data.onTimeline
  if (data.size !== undefined) updates.size = data.size
  if (data.progress !== undefined) updates.progress = data.progress
  if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex
  if (data.startDate !== undefined) updates.startDate = data.startDate ? new Date(data.startDate) : null
  if (data.endDate !== undefined) updates.endDate = data.endDate ? new Date(data.endDate) : null

  const [task] = await db
    .update(boardTasks)
    .set(updates)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
    .returning()

  await touchProject(projectId, { type: 'task:updated' })
  return task || null
}

export async function createTasksBatch(
  projectId: string,
  tasks: { name: string; description?: string; status?: string; priority?: string; color?: string; size?: number | null; startDate?: string; endDate?: string; columnId?: string }[]
) {
  if (tasks.length === 0) return []

  const result = await db.transaction(async (tx) => {
    const [maxResult] = await tx
      .select({ max: sql<number>`coalesce(max(${boardTasks.orderIndex}), -1)` })
      .from(boardTasks)
      .where(eq(boardTasks.projectId, projectId))

    let nextIndex = maxResult.max + 1

    const values = tasks.map((t) => ({
      projectId,
      name: t.name,
      description: t.description || null,
      columnId: t.columnId || null,
      status: t.status || 'todo',
      priority: t.priority || 'medium',
      color: t.color || 'purple',
      size: t.size ?? null,
      startDate: t.startDate ? new Date(t.startDate) : null,
      endDate: t.endDate ? new Date(t.endDate) : null,
      onTimeline: false,
      orderIndex: nextIndex++,
    }))

    return tx.insert(boardTasks).values(values).returning()
  })

  await touchProject(projectId, { type: 'task:created' })
  return result
}

// memories.taskId is ON DELETE SET NULL, so fact-memories anchored to a task
// must be stamped invalidAt BEFORE the task row is deleted — afterwards the
// anchor is nulled and the nightly reconcileDerivedMemories sweep
// (lib/kairos/project-snapshot.ts) can no longer see which task they described.
// Pinned facts are operator-protected and never auto-invalidated.
async function invalidateFactsForTasks(
  tx: Pick<typeof db, 'update' | 'select'>,
  taskFilter: SQL | undefined,
) {
  await tx
    .update(memories)
    .set({ invalidAt: new Date() })
    .where(and(
      eq(memories.type, 'fact'),
      eq(memories.pinned, false),
      isNull(memories.invalidAt),
      inArray(
        memories.taskId,
        tx.select({ id: boardTasks.id }).from(boardTasks).where(taskFilter),
      ),
    ))
}

export async function deleteTask(taskId: string, projectId: string) {
  const deleted = await db.transaction(async (tx) => {
    const filter = and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId))
    await invalidateFactsForTasks(tx, filter)
    const [row] = await tx
      .delete(boardTasks)
      .where(filter)
      .returning({ id: boardTasks.id })
    return row
  })

  await touchProject(projectId, { type: 'task:deleted' })
  return !!deleted
}

export async function deleteTasksByColumn(columnId: string, projectId: string) {
  await db.transaction(async (tx) => {
    const filter = and(eq(boardTasks.columnId, columnId), eq(boardTasks.projectId, projectId))
    await invalidateFactsForTasks(tx, filter)
    await tx.delete(boardTasks).where(filter)
  })
  await touchProject(projectId, { type: 'task:deleted' })
}

export async function reorderTasks(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string; columnId?: string }[]
) {
  await db.transaction(async (tx) => {
    for (const { id, orderIndex, status, columnId } of updates) {
      const values: Partial<typeof boardTasks.$inferInsert> = {
        orderIndex,
        updatedAt: new Date(),
      }
      if (status !== undefined) {
        values.status = status
        if (status === 'done') {
          values.completedAt = new Date()
        } else {
          values.completedAt = null
        }
      }
      if (columnId !== undefined) values.columnId = columnId
      await tx
        .update(boardTasks)
        .set(values)
        .where(and(eq(boardTasks.id, id), eq(boardTasks.projectId, projectId)))
    }
  })
  await touchProject(projectId, { type: 'task:moved' })
}

export async function findArchivedTasks(projectId: string) {
  return db
    .select()
    .from(boardTasks)
    .where(and(eq(boardTasks.projectId, projectId), isNotNull(boardTasks.archivedAt)))
    .orderBy(asc(boardTasks.archivedAt))
}

export async function archiveTask(taskId: string, projectId: string) {
  const [task] = await db
    .update(boardTasks)
    .set({ archivedAt: new Date() })
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
    .returning()
  await touchProject(projectId, { type: 'task:updated' })
  return task || null
}

export async function restoreTask(taskId: string, projectId: string) {
  const [task] = await db
    .update(boardTasks)
    .set({ archivedAt: null })
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
    .returning()
  await touchProject(projectId, { type: 'task:updated' })
  return task || null
}

export async function archiveTasksBatch(projectId: string, taskIds: string[]) {
  if (taskIds.length === 0) return []
  const results = await db
    .update(boardTasks)
    .set({ archivedAt: new Date() })
    .where(and(inArray(boardTasks.id, taskIds), eq(boardTasks.projectId, projectId)))
    .returning()
  await touchProject(projectId, { type: 'task:updated' })
  return results
}
