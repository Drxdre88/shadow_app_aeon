'use server'

import { auth } from '@/lib/auth'
import { verifyProjectAccess } from '@/lib/data/projects'
import { AiForbiddenError } from './errors'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session.user.id
}

export async function requireOwnership(projectId: string) {
  const userId = await requireAuth()
  const access = await verifyProjectAccess(projectId, userId)
  if (!access) throw new Error('Project not found or unauthorized')
  return userId
}

export async function requireMember(projectId: string) {
  const userId = await requireAuth()
  const access = await verifyProjectAccess(projectId, userId)
  if (!access) throw new Error('Project not found or unauthorized')
  return userId
}

export async function requireEditor(projectId: string) {
  const userId = await requireAuth()
  const access = await verifyProjectAccess(projectId, userId)
  if (!access) throw new Error('Project not found or unauthorized')
  if (access.role === 'viewer') throw new Error('Viewers cannot modify this project')
  return userId
}

export async function requireAiAccess() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin') throw new AiForbiddenError()
  return session.user.id
}
