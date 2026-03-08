import { db } from '@/lib/db'
import { boardTasks } from '@/lib/db/schema'
import { eq, and, asc, sql } from 'drizzle-orm'
import type { CreateTaskInput, UpdateTaskInput } from './validators'

export async function findTasks(
  projectId: string,
  filters?: { status?: string; priority?: string },
  limit = 200,
  offset = 0
) {
  const conditions = [eq(boardTasks.projectId, projectId)]
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
    startDate: data.startDate ? new Date(data.startDate) : null,
    endDate: data.endDate ? new Date(data.endDate) : null,
  }

  if (data.orderIndex !== undefined) {
    const [task] = await db
      .insert(boardTasks)
      .values({ ...baseValues, orderIndex: data.orderIndex })
      .returning()
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
  if (data.status !== undefined) updates.status = data.status
  if (data.priority !== undefined) updates.priority = data.priority
  if (data.color !== undefined) updates.color = data.color
  if (data.onTimeline !== undefined) updates.onTimeline = data.onTimeline
  if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex
  if (data.startDate !== undefined) updates.startDate = data.startDate ? new Date(data.startDate) : null
  if (data.endDate !== undefined) updates.endDate = data.endDate ? new Date(data.endDate) : null

  const [task] = await db
    .update(boardTasks)
    .set(updates)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
    .returning()

  return task || null
}

export async function deleteTask(taskId: string, projectId: string) {
  const [deleted] = await db
    .delete(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
    .returning({ id: boardTasks.id })

  return !!deleted
}

export async function reorderTasks(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string; columnId?: string }[]
) {
  await Promise.all(
    updates.map(({ id, orderIndex, status, columnId }) => {
      const values: Partial<typeof boardTasks.$inferInsert> = {
        orderIndex,
        updatedAt: new Date(),
      }
      if (status !== undefined) values.status = status
      if (columnId !== undefined) values.columnId = columnId
      return db
        .update(boardTasks)
        .set(values)
        .where(and(eq(boardTasks.id, id), eq(boardTasks.projectId, projectId)))
    })
  )
}
