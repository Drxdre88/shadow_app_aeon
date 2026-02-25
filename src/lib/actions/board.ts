'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { boardTasks, projects } from '@/lib/db/schema'
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

export async function getBoardTasks(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  return db
    .select()
    .from(boardTasks)
    .where(eq(boardTasks.projectId, projectId))
    .orderBy(asc(boardTasks.orderIndex))
}

export async function createBoardTask(data: {
  id: string
  projectId: string
  name: string
  description?: string
  status: string
  priority: string
  color: string
  onTimeline: boolean
  orderIndex: number
  startDate?: string
  endDate?: string
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(data.projectId, session.user.id)

  const [task] = await db
    .insert(boardTasks)
    .values({
      id: data.id,
      projectId: data.projectId,
      name: data.name,
      description: data.description || null,
      status: data.status,
      priority: data.priority,
      color: data.color,
      onTimeline: data.onTimeline,
      orderIndex: data.orderIndex,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
    })
    .returning()

  revalidatePath(`/project/${data.projectId}`)
  return task
}

export async function updateBoardTask(
  taskId: string,
  projectId: string,
  data: {
    name?: string
    description?: string | null
    status?: string
    priority?: string
    color?: string
    onTimeline?: boolean
    orderIndex?: number
    startDate?: string | null
    endDate?: string | null
  }
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description
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

  revalidatePath(`/project/${projectId}`)
  return task
}

export async function deleteBoardTask(taskId: string, projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  await db
    .delete(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))

  revalidatePath(`/project/${projectId}`)
}

export async function reorderBoardTasks(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string }[]
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  await Promise.all(
    updates.map(({ id, orderIndex, status }) => {
      const values: Record<string, unknown> = { orderIndex, updatedAt: new Date() }
      if (status !== undefined) values.status = status
      return db
        .update(boardTasks)
        .set(values)
        .where(and(eq(boardTasks.id, id), eq(boardTasks.projectId, projectId)))
    })
  )

  revalidatePath(`/project/${projectId}`)
}
