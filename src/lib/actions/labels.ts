'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { labels, taskLabels, projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

async function verifyProjectOwnership(projectId: string, userId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))

  if (!project) throw new Error('Project not found or unauthorized')
  return project
}

export async function getLabels(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  return db
    .select()
    .from(labels)
    .where(eq(labels.projectId, projectId))
}

export async function getTaskLabels(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  return db
    .select()
    .from(taskLabels)
}

export async function createLabel(data: {
  id: string
  projectId: string
  name: string
  color: string
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(data.projectId, session.user.id)

  const [label] = await db
    .insert(labels)
    .values({
      id: data.id,
      projectId: data.projectId,
      name: data.name,
      color: data.color,
    })
    .returning()

  revalidatePath(`/project/${data.projectId}`)
  return label
}

export async function deleteLabel(labelId: string, projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  await db
    .delete(labels)
    .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))

  revalidatePath(`/project/${projectId}`)
}

export async function addLabelToTask(taskId: string, labelId: string, projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  await db
    .insert(taskLabels)
    .values({ taskId, labelId })
    .onConflictDoNothing()

  revalidatePath(`/project/${projectId}`)
}

export async function removeLabelFromTask(taskId: string, labelId: string, projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await verifyProjectOwnership(projectId, session.user.id)

  await db
    .delete(taskLabels)
    .where(and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, labelId)))

  revalidatePath(`/project/${projectId}`)
}
