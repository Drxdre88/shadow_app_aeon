'use server'

import { requireAuth } from './helpers'
import { verifyProjectOwnerRole, verifyProjectOwnership } from '@/lib/data/projects'
import {
  findMembers,
  addMember,
  removeMember,
  updateMemberRole,
  createInvite,
  acceptInvite,
  findPendingInvites,
  findUserByEmail,
} from '@/lib/data/members'
import { sendInviteEmail } from '@/lib/email'

const ASSIGNABLE_ROLES = ['editor', 'viewer'] as const

function validateRole(role: string) {
  if (!ASSIGNABLE_ROLES.includes(role as typeof ASSIGNABLE_ROLES[number])) {
    throw new Error('Invalid role. Must be editor or viewer.')
  }
}

export async function getProjectMembers(projectId: string) {
  await requireAuth()
  return findMembers(projectId)
}

export async function inviteMember(projectId: string, email: string, role: string = 'editor') {
  validateRole(role)
  const userId = await requireAuth()
  const isOwner = await verifyProjectOwnerRole(projectId, userId)
  if (!isOwner) throw new Error('Only project owners can invite members')

  const existingUser = await findUserByEmail(email)
  if (existingUser) {
    const result = await addMember(projectId, existingUser.id, role, userId)
    if (!result) throw new Error('User is already a member')
    return { type: 'added' as const, email }
  }

  const invite = await createInvite(projectId, email, role, userId)
  const project = await verifyProjectOwnership(projectId, userId)
  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL
  if (baseUrl) {
    sendInviteEmail(email, project?.name || 'Untitled', 'A team member', `${baseUrl}/invite/${invite.token}`).catch(() => {})
  }
  return { type: 'invited' as const, email, token: invite.token }
}

export async function removeProjectMember(projectId: string, targetUserId: string) {
  const userId = await requireAuth()
  const isOwner = await verifyProjectOwnerRole(projectId, userId)
  if (!isOwner) throw new Error('Only project owners can remove members')
  if (targetUserId === userId) throw new Error('Cannot remove yourself')

  const removed = await removeMember(projectId, targetUserId)
  if (!removed) throw new Error('Member not found')
  return true
}

export async function updateProjectMemberRole(projectId: string, targetUserId: string, role: string) {
  validateRole(role)
  const userId = await requireAuth()
  const isOwner = await verifyProjectOwnerRole(projectId, userId)
  if (!isOwner) throw new Error('Only project owners can change roles')
  if (targetUserId === userId) throw new Error('Cannot change your own role')

  const updated = await updateMemberRole(projectId, targetUserId, role)
  if (!updated) throw new Error('Member not found')
  return updated
}

export async function acceptProjectInvite(token: string) {
  const userId = await requireAuth()
  const invite = await acceptInvite(token, userId)
  if (!invite) throw new Error('Invite expired or invalid')
  return invite.projectId
}

export async function getPendingInvites(projectId: string) {
  const userId = await requireAuth()
  const isOwner = await verifyProjectOwnerRole(projectId, userId)
  if (!isOwner) throw new Error('Only project owners can view invites')
  return findPendingInvites(projectId)
}
