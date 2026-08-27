'use server'

import { auth } from '@/lib/auth'
import { verifyProjectAccess } from '@/lib/data/projects'
import { AiForbiddenError } from './errors'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session.user.id
}

// Non-throwing variant for actions that surface a structured failure
// envelope to the client (e.g. chat actions where the UI shows a
// friendly error string, not a stack trace).
export async function safeAuth(): Promise<{ ok: true; userId: string } | { ok: false; reason: 'unauthorized' }> {
  try {
    const userId = await requireAuth()
    return { ok: true, userId }
  } catch {
    return { ok: false, reason: 'unauthorized' }
  }
}

/**
 * NOTE: despite the name this only proves ACCESS, not ownership — it is the
 * historical alias of requireMember and several callers depend on that. For a
 * real owner-only gate use requireOwner below.
 */
export async function requireOwnership(projectId: string) {
  const userId = await requireAuth()
  const access = await verifyProjectAccess(projectId, userId)
  if (!access) throw new Error('Project not found or unauthorized')
  return userId
}

/**
 * A genuine owner gate: the project's owner (direct member role, legacy
 * owner column, or realm owner). For switches whose blast radius exceeds
 * editing content — e.g. whether dropping a card may start an agent.
 */
export async function requireOwner(projectId: string) {
  const userId = await requireAuth()
  const access = await verifyProjectAccess(projectId, userId)
  if (!access) throw new Error('Project not found or unauthorized')
  if (access.role !== 'owner') throw new Error('Only the project owner can change this')
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
