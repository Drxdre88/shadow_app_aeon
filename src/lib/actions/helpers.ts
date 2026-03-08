'use server'

import { auth } from '@/lib/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'

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
