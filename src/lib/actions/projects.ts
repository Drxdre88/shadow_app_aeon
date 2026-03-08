'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOwnership } from './helpers'
import {
  findProjects as _findProjects,
  createProject as _createProject,
  updateProject as _updateProject,
  deleteProject as _deleteProject,
} from '@/lib/data/projects'
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
  const project = await _createProject(userId, {
    name: data.name,
    description: data.description,
    startDate: data.startDate,
    endDate: data.endDate,
    timeScale: (data.timeScale as 'day' | 'week' | 'month') || 'week',
  })
  revalidatePath('/dashboard')
  return project
}

export async function updateProject(projectId: string, data: UpdateProjectInput) {
  await requireOwnership(projectId)
  const project = await _updateProject(projectId, data)
  revalidatePath('/dashboard')
  revalidatePath(`/project/${projectId}`)
  return project
}

export async function deleteProject(projectId: string) {
  await requireOwnership(projectId)
  await _deleteProject(projectId)
  revalidatePath('/dashboard')
}
