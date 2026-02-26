'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { checklistItems, boardTasks, projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

async function verifyTaskOwnership(taskId: string, userId: string) {
  const [task] = await db
    .select({ id: boardTasks.id, projectId: boardTasks.projectId })
    .from(boardTasks)
    .innerJoin(projects, eq(projects.id, boardTasks.projectId))
    .where(and(eq(boardTasks.id, taskId), eq(projects.userId, userId)))

  if (!task) throw new Error('Task not found or unauthorized')
  return task
}

export async function getChecklistItems(taskId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyTaskOwnership(taskId, session.user.id)

  return db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))
    .orderBy(checklistItems.orderIndex)
}

export async function createChecklistItem(data: {
  id: string
  taskId: string
  title: string
  orderIndex: number
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const task = await verifyTaskOwnership(data.taskId, session.user.id)

  const [item] = await db
    .insert(checklistItems)
    .values({
      id: data.id,
      taskId: data.taskId,
      title: data.title,
      completed: false,
      orderIndex: data.orderIndex,
    })
    .returning()

  revalidatePath(`/project/${task.projectId}`)
  return item
}

export async function updateChecklistItem(
  itemId: string,
  taskId: string,
  updates: { title?: string; completed?: boolean; startDate?: string; endDate?: string }
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const task = await verifyTaskOwnership(taskId, session.user.id)

  const dbUpdates: Record<string, unknown> = {}
  if (updates.title !== undefined) dbUpdates.title = updates.title
  if (updates.completed !== undefined) dbUpdates.completed = updates.completed
  if (updates.startDate !== undefined) dbUpdates.startDate = new Date(updates.startDate)
  if (updates.endDate !== undefined) dbUpdates.endDate = new Date(updates.endDate)

  await db
    .update(checklistItems)
    .set(dbUpdates)
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.taskId, taskId)))

  revalidatePath(`/project/${task.projectId}`)
}

export async function deleteChecklistItem(itemId: string, taskId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const task = await verifyTaskOwnership(taskId, session.user.id)

  await db
    .delete(checklistItems)
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.taskId, taskId)))

  revalidatePath(`/project/${task.projectId}`)
}
