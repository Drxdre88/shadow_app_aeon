import { db } from '@/lib/db'
import { labels, taskLabels, boardTasks } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { CreateLabelInput } from './validators'

export async function findLabels(projectId: string) {
  return db
    .select()
    .from(labels)
    .where(eq(labels.projectId, projectId))
}

export async function findTaskLabels(projectId: string) {
  return db
    .select({
      taskId: taskLabels.taskId,
      labelId: taskLabels.labelId,
    })
    .from(taskLabels)
    .innerJoin(boardTasks, eq(boardTasks.id, taskLabels.taskId))
    .where(eq(boardTasks.projectId, projectId))
}

export async function createLabel(
  projectId: string,
  data: CreateLabelInput,
  clientId?: string
) {
  const [label] = await db
    .insert(labels)
    .values({
      ...(clientId ? { id: clientId } : {}),
      projectId,
      name: data.name,
      color: data.color,
    })
    .returning()

  return label
}

export async function deleteLabel(labelId: string, projectId: string) {
  const [deleted] = await db
    .delete(labels)
    .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
    .returning({ id: labels.id })

  return !!deleted
}

export async function addLabelToTask(taskId: string, labelId: string) {
  await db
    .insert(taskLabels)
    .values({ taskId, labelId })
    .onConflictDoNothing()
}

export async function removeLabelFromTask(taskId: string, labelId: string) {
  await db
    .delete(taskLabels)
    .where(and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, labelId)))
}
