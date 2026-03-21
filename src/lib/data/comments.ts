import { db } from '@/lib/db'
import { taskComments, boardTasks, users } from '@/lib/db/schema'
import { eq, and, asc, desc } from 'drizzle-orm'

export async function findComments(taskId: string, projectId: string) {
  const task = await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
    .limit(1)

  if (task.length === 0) return []

  return db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
      userName: users.name,
      userImage: users.image,
    })
    .from(taskComments)
    .innerJoin(users, eq(taskComments.userId, users.id))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt))
}

export async function createComment(
  taskId: string,
  userId: string,
  content: string
) {
  const [comment] = await db
    .insert(taskComments)
    .values({ taskId, userId, content })
    .returning()
  return comment
}

export async function updateComment(
  commentId: string,
  taskId: string,
  userId: string,
  content: string
) {
  const [comment] = await db
    .update(taskComments)
    .set({ content, updatedAt: new Date() })
    .where(
      and(
        eq(taskComments.id, commentId),
        eq(taskComments.taskId, taskId),
        eq(taskComments.userId, userId)
      )
    )
    .returning()
  return comment || null
}

export async function deleteComment(
  commentId: string,
  taskId: string,
  userId: string
) {
  const [deleted] = await db
    .delete(taskComments)
    .where(
      and(
        eq(taskComments.id, commentId),
        eq(taskComments.taskId, taskId),
        eq(taskComments.userId, userId)
      )
    )
    .returning({ id: taskComments.id })
  return !!deleted
}

export async function countComments(taskId: string) {
  const comments = await db
    .select({ id: taskComments.id })
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
  return comments.length
}
