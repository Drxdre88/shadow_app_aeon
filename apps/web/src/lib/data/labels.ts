import { db } from '@/lib/db'
import { labels, taskLabels, boardTasks } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import type { CreateLabelInput } from './validators'
import { touchProject } from './projects'

export async function findLabels(projectId: string, limit = 100, offset = 0) {
  return db
    .select()
    .from(labels)
    .where(eq(labels.projectId, projectId))
    .limit(limit)
    .offset(offset)
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

export async function findLabelsForTask(taskId: string, projectId: string) {
  return db
    .select({ labelId: taskLabels.labelId })
    .from(taskLabels)
    .innerJoin(boardTasks, and(eq(boardTasks.id, taskLabels.taskId), eq(boardTasks.projectId, projectId)))
    .where(eq(taskLabels.taskId, taskId))
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

  await touchProject(projectId, { type: 'label:changed' })
  return label
}

export async function updateLabel(
  labelId: string,
  projectId: string,
  data: { name?: string; color?: string }
) {
  const [updated] = await db
    .update(labels)
    .set(data)
    .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
    .returning()

  await touchProject(projectId, { type: 'label:changed' })
  return updated
}

export async function deleteLabel(labelId: string, projectId: string) {
  const [deleted] = await db
    .delete(labels)
    .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
    .returning({ id: labels.id })

  await touchProject(projectId, { type: 'label:changed' })
  return !!deleted
}

export async function addLabelToTask(taskId: string, labelId: string, projectId: string) {
  const [task] = await db.select({ id: boardTasks.id }).from(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
  if (!task) throw new Error('Task not found in project')

  const [label] = await db.select({ id: labels.id }).from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
  if (!label) throw new Error('Label not found in project')

  await db
    .insert(taskLabels)
    .values({ taskId, labelId })
    .onConflictDoNothing()
  await touchProject(projectId, { type: 'label:changed' })
}

export async function setTaskLabels(taskId: string, labelIds: string[], projectId: string) {
  const [task] = await db.select({ id: boardTasks.id }).from(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
  if (!task) throw new Error('Task not found in project')

  if (labelIds.length > 0) {
    const validLabels = await db.select({ id: labels.id }).from(labels)
      .where(and(eq(labels.projectId, projectId), inArray(labels.id, labelIds)))
    if (validLabels.length !== labelIds.length) throw new Error('Some labels not found in project')
  }

  await db.transaction(async (tx) => {
    await tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId))
    if (labelIds.length > 0) {
      await tx.insert(taskLabels).values(
        labelIds.map((labelId) => ({ taskId, labelId }))
      ).onConflictDoNothing()
    }
  })
  await touchProject(projectId, { type: 'label:changed' })
}

export async function removeLabelFromTask(taskId: string, labelId: string, projectId: string) {
  const [task] = await db.select({ id: boardTasks.id }).from(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
  if (!task) throw new Error('Task not found in project')

  const [label] = await db.select({ id: labels.id }).from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
  if (!label) throw new Error('Label not found in project')

  await db
    .delete(taskLabels)
    .where(and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, labelId)))
  await touchProject(projectId, { type: 'label:changed' })
}
