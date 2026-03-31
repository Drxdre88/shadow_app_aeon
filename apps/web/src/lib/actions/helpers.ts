'use server'

import { auth } from '@/lib/auth'
import { verifyProjectOwnership, getMemberRole } from '@/lib/data/projects'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session.user.id
}

export async function requireOwnership(projectId: string) {
  const userId = await requireAuth()
  const project = await verifyProjectOwnership(projectId, userId)
  if (!project) throw new Error('Project not found or unauthorized')
  return userId
}

export async function requireMember(projectId: string) {
  const userId = await requireAuth()
  const project = await verifyProjectOwnership(projectId, userId)
  if (!project) throw new Error('Project not found or unauthorized')
  if (project.userId === userId) return userId
  const role = await getMemberRole(projectId, userId)
  if (role) return userId
  throw new Error('Not a member of this project')
}

export async function requireEditor(projectId: string) {
  const userId = await requireAuth()
  const project = await verifyProjectOwnership(projectId, userId)
  if (!project) throw new Error('Project not found or unauthorized')
  const role = await getMemberRole(projectId, userId)
  if (role === 'viewer') throw new Error('Viewers cannot modify this project')
  if (role === null && project.userId !== userId) throw new Error('Not a member of this project')
  return userId
}
