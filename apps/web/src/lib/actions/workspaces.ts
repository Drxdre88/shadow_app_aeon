'use server'

import { auth } from '@/lib/auth'
import {
  createWorkspaceGroup as _create,
  findGroupsForUser as _findGroups,
  findGroupMembers as _findMembers,
  findProjectsInGroup as _findProjects,
  addProjectToGroup as _addProject,
  removeProjectFromGroup as _removeProject,
  addGroupMember as _addMember,
  removeGroupMember as _removeMember,
  updateGroupMemberRole as _updateRole,
  updateWorkspaceGroup as _update,
  deleteWorkspaceGroup as _delete,
  getGroupRole,
} from '@/lib/data/workspaces'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  return session.user.id
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
  await requireAuth()
  return _findMembers(groupId)
}

export async function getGroupProjects(groupId: string) {
  await requireAuth()
  return _findProjects(groupId)
}

export async function addProjectToGroup(projectId: string, groupId: string) {
  const userId = await requireGroupEditor(groupId)
  return _addProject(projectId, groupId, userId)
}

export async function removeProjectFromGroup(projectId: string, groupId: string) {
  await requireGroupEditor(groupId)
  return _removeProject(projectId, groupId)
}

export async function inviteGroupMember(groupId: string, emailOrUserId: string, role: string = 'editor') {
  await requireGroupOwner(groupId)
  let targetUserId = emailOrUserId
  if (emailOrUserId.includes('@')) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, emailOrUserId))
    if (!user) throw new Error('User not found — they must sign up first')
    targetUserId = user.id
  }
  return _addMember(groupId, targetUserId, role)
}

export async function removeGroupMember(groupId: string, userId: string) {
  await requireGroupOwner(groupId)
  return _removeMember(groupId, userId)
}

export async function updateMemberRole(groupId: string, userId: string, role: string) {
  await requireGroupOwner(groupId)
  return _updateRole(groupId, userId, role)
}

export async function updateGroup(groupId: string, data: { name?: string; icon?: string | null; color?: string }) {
  await requireGroupOwner(groupId)
  return _update(groupId, data)
}

export async function deleteGroup(groupId: string) {
  await requireGroupOwner(groupId)
  return _delete(groupId)
}
