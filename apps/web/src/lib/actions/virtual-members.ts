'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireEditor, requireMember } from './helpers'
import { getGroupRole } from '@/lib/data/workspaces'
import { createVirtualMemberSchema, updateVirtualMemberSchema } from '@/lib/data/validators'
import { findAssignableMembers } from '@/lib/data/members'
import {
  findVirtualMembersForProject as _findVirtualMembersForProject,
  findVirtualMemberById as _findVirtualMemberById,
  findRealmIdsForProject as _findRealmIdsForProject,
  isVirtualMemberAssignable as _isVirtualMemberAssignable,
  createVirtualMember as _createVirtualMember,
  updateVirtualMember as _updateVirtualMember,
  deleteVirtualMember as _deleteVirtualMember,
} from '@/lib/data/virtual-members'

const idSchema = z.string().uuid()

// Virtual team members — board-facing actions. All project-scoped: the caller
// proves access to the project, the member's realm is resolved server-side.

// One round trip for everything the assignee overlay / filter bar needs:
// real assignable members + virtual members of the project's realms.
export async function getAssignablePeople(projectId: string) {
  await requireMember(projectId)
  const [members, virtual] = await Promise.all([
    findAssignableMembers(projectId),
    _findVirtualMembersForProject(projectId),
  ])
  return { members, virtualMembers: virtual }
}

export async function listVirtualMembersForProject(projectId: string) {
  await requireMember(projectId)
  return _findVirtualMembersForProject(projectId)
}

export async function createVirtualMemberAction(projectId: string, input: unknown) {
  const userId = await requireEditor(projectId)
  const data = createVirtualMemberSchema.parse(input)

  const realmIds = await _findRealmIdsForProject(projectId)
  if (realmIds.length === 0) {
    throw new Error('This project is not in a realm — virtual members live at realm level')
  }

  const member = await _createVirtualMember(realmIds[0], data, userId)
  revalidatePath(`/project/${projectId}`)
  return member
}

export async function updateVirtualMemberAction(projectId: string, virtualMemberId: string, updates: unknown) {
  await requireEditor(projectId)
  idSchema.parse(virtualMemberId)
  const data = updateVirtualMemberSchema.parse(updates)

  // The member must be reachable from this project (same realm) — a project
  // editor cannot touch members of unrelated realms by guessing ids.
  if (!await _isVirtualMemberAssignable(virtualMemberId, projectId)) {
    throw new Error('Virtual member not found on this project')
  }
  const member = await _findVirtualMemberById(virtualMemberId)
  if (!member) throw new Error('Virtual member not found')

  const updated = await _updateVirtualMember(virtualMemberId, member.realmId, data)
  revalidatePath(`/project/${projectId}`)
  return updated
}

export async function deleteVirtualMemberAction(projectId: string, virtualMemberId: string) {
  const userId = await requireEditor(projectId)
  idSchema.parse(virtualMemberId)

  if (!await _isVirtualMemberAssignable(virtualMemberId, projectId)) {
    throw new Error('Virtual member not found on this project')
  }
  const member = await _findVirtualMemberById(virtualMemberId)
  if (!member) throw new Error('Virtual member not found')

  // Delete strips the member's assignments across every project in the realm,
  // so it demands realm-level editor rights — same gate as REST/MCP.
  const role = await getGroupRole(member.realmId, userId)
  if (!role || role === 'viewer') {
    throw new Error('Deleting a virtual member requires realm editor access')
  }

  const deleted = await _deleteVirtualMember(virtualMemberId, member.realmId)
  revalidatePath(`/project/${projectId}`)
  return deleted
}
