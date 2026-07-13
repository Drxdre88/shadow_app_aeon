'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOwnership, requireEditor, requireMember } from './helpers'
import {
  findProjects as _findProjects,
  findProjectsWithStats as _findProjectsWithStats,
  findProjectsWithRealmName as _findProjectsWithRealmName,
  findSiblingProjects as _findSiblingProjects,
  findOwnProjects as _findOwn,
  findSharedProjects as _findShared,
  findWorkspaceProjects as _findWorkspace,
  createProject as _createProject,
  updateProject as _updateProject,
  deleteProject as _deleteProject,
  setProjectGroup as _setProjectGroup,
  renameGroup as _renameGroup,
  toggleProjectFavorite as _toggleProjectFavorite,
  findFavoriteProjectIds as _findFavoriteProjectIds,
} from '@/lib/data/projects'
import { createProjectSchema, updateProjectSchema } from '@/lib/data/validators'
import type { UpdateProjectInput } from '@/lib/data/validators'
import { createDefaultColumns } from '@/lib/data/columns'
import { captureProjectEvent } from '@/lib/kairos/auto-capture'

export async function getProjects() {
  const userId = await requireAuth()
  return _findProjects(userId)
}

export async function getProjectsWithRealmName() {
  const userId = await requireAuth()
  return _findProjectsWithRealmName(userId)
}

export async function getSiblingProjects(projectId: string) {
  const userId = await requireAuth()
  return _findSiblingProjects(projectId, userId)
}

export async function getProjectsWithStats() {
  const userId = await requireAuth()
  return _findProjectsWithStats(userId)
}

export async function getOwnProjects() {
  const userId = await requireAuth()
  return _findOwn(userId)
}

export async function getSharedProjects() {
  const userId = await requireAuth()
  return _findShared(userId)
}

export async function getWorkspaceProjects() {
  const userId = await requireAuth()
  return _findWorkspace(userId)
}

export async function setProjectGroup(projectId: string, group: string | null) {
  await requireEditor(projectId)
  return _setProjectGroup(projectId, group)
}

export async function renameProjectGroup(oldName: string, newName: string) {
  const userId = await requireAuth()
  const trimmed = newName.trim()
  if (!trimmed || trimmed.length > 100) throw new Error('Group name must be 1-100 characters')
  return _renameGroup(userId, oldName, trimmed)
}

export async function createProject(data: {
  name: string
  description?: string
  startDate: string
  endDate: string
  timeScale?: string
  template?: string
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
  await createDefaultColumns(project.id, data.template)
  captureProjectEvent({ userId, projectId: project.id, projectName: project.name, action: 'created' }).catch(() => {})
  revalidatePath('/dashboard')
  return project
}

export async function updateProject(projectId: string, data: UpdateProjectInput) {
  const userId = await requireEditor(projectId)
  const parsed = updateProjectSchema.parse(data)
  const project = await _updateProject(projectId, userId, parsed)
  if (project) {
    captureProjectEvent({
      userId, projectId, projectName: project.name, action: 'updated',
      metadata: Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)),
    }).catch(() => {})
  }
  revalidatePath('/dashboard')
  revalidatePath(`/project/${projectId}`)
  return project
}

export async function updateProjectSettings(projectId: string, settings: Record<string, unknown>) {
  const userId = await requireEditor(projectId)
  const project = await _updateProject(projectId, userId, { settings })
  revalidatePath(`/project/${projectId}`)
  return project
}

export async function toggleProjectFavorite(projectId: string, favorite: boolean) {
  const userId = await requireMember(projectId)
  await _toggleProjectFavorite(userId, projectId, favorite)
  revalidatePath('/dashboard')
  return { favorite }
}

export async function getFavoriteProjectIds() {
  const userId = await requireAuth()
  const ids = await _findFavoriteProjectIds(userId)
  return Array.from(ids)
}

export async function deleteProject(projectId: string) {
  const userId = await requireOwnership(projectId)
  const deleted = await _deleteProject(projectId, userId)
  if (!deleted) throw new Error('Only project owners can delete projects')
  revalidatePath('/dashboard')
}
