'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { projects, rows } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function getProjects() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.createdAt))
}

export async function createProject(data: {
  name: string
  description?: string
  startDate: string
  endDate: string
  timeScale?: string
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const [project] = await db
    .insert(projects)
    .values({
      userId: session.user.id,
      name: data.name,
      description: data.description || null,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      timeScale: data.timeScale || 'week',
    })
    .returning()

  await db.insert(rows).values([
    { projectId: project.id, name: 'Planning', color: 'purple', orderIndex: 0 },
    { projectId: project.id, name: 'Development', color: 'cyan', orderIndex: 1 },
    { projectId: project.id, name: 'Testing', color: 'green', orderIndex: 2 },
  ])

  revalidatePath('/dashboard')
  return project
}

export async function updateProject(
  projectId: string,
  data: { name?: string; description?: string; startDate?: string; endDate?: string; timeScale?: string }
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.timeScale !== undefined) updates.timeScale = data.timeScale

  const [project] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, projectId))
    .returning()

  revalidatePath('/dashboard')
  revalidatePath(`/project/${projectId}`)
  return project
}

export async function deleteProject(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db.delete(projects).where(eq(projects.id, projectId))
  revalidatePath('/dashboard')
}
