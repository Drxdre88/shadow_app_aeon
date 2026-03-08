import { db } from '@/lib/db'
import { ganttTasks, rows } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import type { CreateGanttTaskInput, UpdateGanttTaskInput } from './validators'

export async function findGanttTasksWithRows(projectId: string) {
  const [tasks, projectRows] = await Promise.all([
    db.select().from(ganttTasks).where(eq(ganttTasks.projectId, projectId)),
    db
      .select()
      .from(rows)
      .where(eq(rows.projectId, projectId))
      .orderBy(asc(rows.orderIndex)),
  ])

  return { tasks, rows: projectRows }
}

export async function findGanttTasks(projectId: string) {
  return db
    .select()
    .from(ganttTasks)
    .where(eq(ganttTasks.projectId, projectId))
}

export async function verifyRowOwnership(rowId: string, projectId: string) {
  const [row] = await db
    .select({ id: rows.id })
    .from(rows)
    .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))

  return !!row
}

export async function createGanttTask(
  projectId: string,
  data: CreateGanttTaskInput,
  clientId?: string
) {
  const [task] = await db
    .insert(ganttTasks)
    .values({
      ...(clientId ? { id: clientId } : {}),
      projectId,
      rowId: data.rowId,
      name: data.name,
      description: data.description || null,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      color: data.color,
      progress: data.progress,
    })
    .returning()

  return task
}

export async function updateGanttTask(
  taskId: string,
  projectId: string,
  data: UpdateGanttTaskInput
) {
  const updates: Partial<typeof ganttTasks.$inferInsert> = { updatedAt: new Date() }
  if (data.rowId !== undefined) updates.rowId = data.rowId
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description ?? null
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.color !== undefined) updates.color = data.color
  if (data.progress !== undefined) updates.progress = data.progress

  const [task] = await db
    .update(ganttTasks)
    .set(updates)
    .where(and(eq(ganttTasks.id, taskId), eq(ganttTasks.projectId, projectId)))
    .returning()

  return task || null
}

export async function deleteGanttTask(taskId: string, projectId: string) {
  const [deleted] = await db
    .delete(ganttTasks)
    .where(and(eq(ganttTasks.id, taskId), eq(ganttTasks.projectId, projectId)))
    .returning({ id: ganttTasks.id })

  return !!deleted
}

export async function findRows(projectId: string) {
  return db
    .select()
    .from(rows)
    .where(eq(rows.projectId, projectId))
    .orderBy(asc(rows.orderIndex))
}

export async function createRow(
  projectId: string,
  data: { name: string; color: string; orderIndex: number },
  clientId?: string
) {
  const [row] = await db
    .insert(rows)
    .values({
      ...(clientId ? { id: clientId } : {}),
      projectId,
      name: data.name,
      color: data.color,
      orderIndex: data.orderIndex,
    })
    .returning()

  return row
}

export async function updateRow(
  rowId: string,
  projectId: string,
  data: { name?: string; color?: string; orderIndex?: number }
) {
  const updates: Partial<typeof rows.$inferInsert> = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.color !== undefined) updates.color = data.color
  if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex

  const [row] = await db
    .update(rows)
    .set(updates)
    .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))
    .returning()

  return row || null
}

export async function deleteRow(rowId: string, projectId: string) {
  const [deleted] = await db
    .delete(rows)
    .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))
    .returning({ id: rows.id })

  return !!deleted
}
