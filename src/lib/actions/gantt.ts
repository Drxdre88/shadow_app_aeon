'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { ganttTasks, rows, projects } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

async function verifyProjectOwnership(projectId: string, userId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))

  if (!project) throw new Error('Project not found or unauthorized')
  return project
}

export async function getRows(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  return db
    .select()
    .from(rows)
    .where(eq(rows.projectId, projectId))
    .orderBy(asc(rows.orderIndex))
}

export async function getGanttTasks(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  return db
    .select()
    .from(ganttTasks)
    .where(eq(ganttTasks.projectId, projectId))
}

export async function createGanttTask(data: {
  id: string
  projectId: string
  rowId: string
  name: string
  description?: string
  startDate: string
  endDate: string
  color: string
  progress?: number
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(data.projectId, session.user.id)

  const [task] = await db
    .insert(ganttTasks)
    .values({
      id: data.id,
      projectId: data.projectId,
      rowId: data.rowId,
      name: data.name,
      description: data.description || null,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      color: data.color,
      progress: data.progress ?? 0,
    })
    .returning()

  revalidatePath(`/project/${data.projectId}`)
  return task
}

export async function updateGanttTask(
  taskId: string,
  projectId: string,
  data: {
    rowId?: string
    name?: string
    description?: string | null
    startDate?: string
    endDate?: string
    color?: string
    progress?: number
  }
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (data.rowId !== undefined) updates.rowId = data.rowId
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.color !== undefined) updates.color = data.color
  if (data.progress !== undefined) updates.progress = data.progress

  const [task] = await db
    .update(ganttTasks)
    .set(updates)
    .where(and(eq(ganttTasks.id, taskId), eq(ganttTasks.projectId, projectId)))
    .returning()

  revalidatePath(`/project/${projectId}`)
  return task
}

export async function deleteGanttTask(taskId: string, projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  await db
    .delete(ganttTasks)
    .where(and(eq(ganttTasks.id, taskId), eq(ganttTasks.projectId, projectId)))

  revalidatePath(`/project/${projectId}`)
}

export async function createRow(data: {
  id: string
  projectId: string
  name: string
  color: string
  orderIndex: number
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(data.projectId, session.user.id)

  const [row] = await db
    .insert(rows)
    .values({
      id: data.id,
      projectId: data.projectId,
      name: data.name,
      color: data.color,
      orderIndex: data.orderIndex,
    })
    .returning()

  revalidatePath(`/project/${data.projectId}`)
  return row
}

export async function updateRow(
  rowId: string,
  projectId: string,
  data: { name?: string; color?: string; orderIndex?: number }
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  const updates: Record<string, unknown> = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.color !== undefined) updates.color = data.color
  if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex

  const [row] = await db
    .update(rows)
    .set(updates)
    .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))
    .returning()

  revalidatePath(`/project/${projectId}`)
  return row
}

export async function deleteRow(rowId: string, projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  await db
    .delete(rows)
    .where(and(eq(rows.id, rowId), eq(rows.projectId, projectId)))

  revalidatePath(`/project/${projectId}`)
}
