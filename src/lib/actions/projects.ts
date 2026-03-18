'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOwnership } from './helpers'
import {
  findProjects as _findProjects,
  createProject as _createProject,
  updateProject as _updateProject,
  deleteProject as _deleteProject,
} from '@/lib/data/projects'
import { createProjectSchema, updateProjectSchema } from '@/lib/data/validators'
import type { UpdateProjectInput } from '@/lib/data/validators'

export async function getProjects() {
  const userId = await requireAuth()
  return _findProjects(userId)
}

export async function createProject(data: {
  name: string
  description?: string
  startDate: string
  endDate: string
  timeScale?: string
}) {
  const userId = await requireAuth()

  const parsed = createProjectSchema.parse({
    name: data.name,
    description: data.description,
    startDate: data.startDate,
    endDate: data.endDate,
    timeScale: data.timeScale ?? 'week',
  })

  const project = await _createProject(userId, parsed)
  revalidatePath('/dashboard')
  return project
}

export async function updateProject(projectId: string, data: UpdateProjectInput) {
  const userId = await requireOwnership(projectId)
  const parsed = updateProjectSchema.parse(data)
  const project = await _updateProject(projectId, userId, parsed)
  revalidatePath('/dashboard')
  revalidatePath(`/project/${projectId}`)
  return project
}

export async function deleteProject(projectId: string) {
  const userId = await requireOwnership(projectId)
  await _deleteProject(projectId, userId)
  revalidatePath('/dashboard')
}
