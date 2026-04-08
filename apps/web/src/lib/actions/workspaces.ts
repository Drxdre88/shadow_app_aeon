'use server'

import { auth } from '@/lib/auth'
import {
  createWorkspaceGroup as _create,
  findGroupsForUser as _findGroups,
  findGroupMembers as _findMembers,
  findProjectsInGroup as _findProjects,
  addProjectToGroup as _addProject,
  removeProjectFromGroup as _removeProject,
  removeGroupMember as _removeMember,
  updateGroupMemberRole as _updateRole,
  updateWorkspaceGroup as _update,
  deleteWorkspaceGroup as _delete,
  getGroupRole,
  canAccessProject,
  isPersonalWorkspace as _isPersonal,
  findOrCreatePersonalWorkspace as _findOrCreatePersonal,
  ensureOrphanProjectsInPersonalWorkspace as _ensureOrphans,
  consolidateSoloWorkspaces as _consolidateSolo,
  acceptRealmInvite as _acceptRealmInvite,
  findPendingRealmInvites as _findPendingRealmInvites,
  inviteOrAddRealmMember as _inviteOrAdd,
  findProjectAccessList as _findAccessList,
  setProjectAccessList as _setAccessList,
} from '@/lib/data/workspaces'
import { db } from '@/lib/db'
import { projectGroups } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const ASSIGNABLE_ROLES = ['editor', 'viewer'] as const
type AssignableRole = typeof ASSIGNABLE_ROLES[number]

function validateRole(role: string): AssignableRole {
  if (!ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
    throw new Error(`Invalid role: ${role}. Must be editor or viewer`)
  }
  return role as AssignableRole
}

async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  return session.user.id
}

async function requireGroupMember(groupId: string) {
  const userId = await requireAuth()
  const role = await getGroupRole(groupId, userId)
  if (!role) throw new Error('Not a member of this workspace')
  return userId
}

async function requireGroupOwner(groupId: string) {
  const userId = await requireAuth()
  const role = await getGroupRole(groupId, userId)
  if (role !== 'owner') throw new Error('Only group owner can perform this action')
  return userId
}

async function requireGroupEditor(groupId: string) {
  const userId = await requireAuth()
  const role = await getGroupRole(groupId, userId)
  if (!role || role === 'viewer') throw new Error('Insufficient permissions')
  return userId
}

export async function createGroup(data: { name: string; icon?: string; color?: string }) {
  const userId = await requireAuth()
  return _create(userId, data)
}

export async function listMyGroups() {
  const userId = await requireAuth()
  return _findGroups(userId)
}

export async function getGroupMembers(groupId: string) {
  await requireGroupMember(groupId)
  return _findMembers(groupId)
}

export async function getGroupProjects(groupId: string) {
  const userId = await requireAuth()
  const role = await getGroupRole(groupId, userId)
  if (!role) throw new Error('Not a member of this workspace')
  return _findProjects(groupId, role, userId)
}

export async function addProjectToGroup(projectId: string, groupId: string) {
  const userId = await requireGroupEditor(groupId)
  const hasAccess = await canAccessProject(userId, projectId)
  if (!hasAccess) throw new Error('No access to this project')
  return _addProject(projectId, groupId, userId)
}

export async function removeProjectFromGroup(projectId: string, groupId: string) {
  await requireGroupEditor(groupId)
  return _removeProject(projectId, groupId)
}

export async function inviteGroupMember(groupId: string, email: string, role: string = 'editor') {
  const callerId = await requireGroupOwner(groupId)
  const validRole = validateRole(role)
  return _inviteOrAdd(groupId, email, validRole, callerId)
}

export async function removeGroupMember(groupId: string, targetUserId: string) {
  const callerId = await requireGroupOwner(groupId)
  if (callerId === targetUserId) throw new Error('Cannot remove yourself as owner')
  return _removeMember(groupId, targetUserId)
}

export async function updateMemberRole(groupId: string, userId: string, role: string) {
  await requireGroupOwner(groupId)
  const validRole = validateRole(role)
  return _updateRole(groupId, userId, validRole)
}

export async function updateGroup(groupId: string, data: { name?: string; icon?: string | null; color?: string }) {
  await requireGroupOwner(groupId)
  return _update(groupId, data)
}

export async function deleteGroup(groupId: string) {
  await requireGroupOwner(groupId)
  if (await _isPersonal(groupId)) throw new Error('Cannot delete personal workspace')
  return _delete(groupId)
}

export async function setProjectVisibility(projectId: string, groupId: string, visibility: 'all' | 'members_only') {
  await requireGroupOwner(groupId)
  await db.update(projectGroups)
    .set({ visibility })
    .where(and(eq(projectGroups.projectId, projectId), eq(projectGroups.groupId, groupId)))
}

export async function getProjectAccessList(projectId: string, groupId: string) {
  await requireGroupOwner(groupId)
  return _findAccessList(projectId)
}

export async function updateProjectAccessList(projectId: string, groupId: string, userIds: string[]) {
  const ownerId = await requireGroupOwner(groupId)
  await _setAccessList(projectId, groupId, userIds, ownerId)
}

export async function ensurePersonalWorkspace() {
  const userId = await requireAuth()
  const personalId = await _findOrCreatePersonal(userId)
  const orphans = await _ensureOrphans(userId, personalId)
  const consolidated = await _consolidateSolo(userId, personalId)
  return orphans + consolidated
}

export async function acceptRealmInvite(token: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  const email = session.user.email
  if (!email) throw new Error('No email on session')
  const invite = await _acceptRealmInvite(token, session.user.id, email)
  if (!invite) throw new Error('Invite expired or invalid')
  return invite.groupId
}

export async function getPendingRealmInvites(groupId: string) {
  await requireGroupOwner(groupId)
  return _findPendingRealmInvites(groupId)
}
