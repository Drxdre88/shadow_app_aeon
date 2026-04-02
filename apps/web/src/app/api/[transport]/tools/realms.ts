import { z } from 'zod'
import {
  createWorkspaceGroup,
  findGroupsForUser,
  findGroupMembers,
  findProjectsInGroup,
  addProjectToGroup,
  removeProjectFromGroup,
  removeGroupMember,
  updateGroupMemberRole,
  updateWorkspaceGroup,
  deleteWorkspaceGroup,
  getGroupRole,
  isPersonalWorkspace,
  canAccessProject,
  inviteOrAddRealmMember,
} from '@/lib/data/workspaces'
import type { RegisterFn } from './types'
import { getUserId, ok, fail, notFound } from './types'

async function requireEditor(groupId: string, userId: string) {
  const role = await getGroupRole(groupId, userId)
  if (!role || role === 'viewer') throw new Error('Insufficient permissions')
  return role
}

async function requireOwner(groupId: string, userId: string) {
  const role = await getGroupRole(groupId, userId)
  if (role !== 'owner') throw new Error('Only owner can perform this action')
  return role
}

export const registerRealmTools: RegisterFn = (server) => {
  server.tool(
    'list_realms',
    'List all realms (workspaces) the user belongs to',
    {},
    async (_args, extra) => ok(await findGroupsForUser(getUserId(extra)))
  )

  server.tool(
    'create_realm',
    'Create a new realm (workspace)',
    {
      name: z.string().min(1).max(255).describe('Realm name'),
      color: z.string().max(20).default('purple').describe('Accent color'),
      icon: z.string().max(50).optional().describe('Icon name'),
    },
    async ({ name, color, icon }, extra) => {
      const uid = getUserId(extra)
      const realm = await createWorkspaceGroup(uid, { name, color, icon })
      return ok(realm)
    }
  )

  server.tool(
    'update_realm',
    'Update realm name, color, or icon',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
      name: z.string().min(1).max(255).optional().describe('New name'),
      color: z.string().max(20).optional().describe('New color'),
      icon: z.string().max(50).nullable().optional().describe('New icon'),
    },
    async ({ realmId, ...data }, extra) => {
      const uid = getUserId(extra)
      await requireOwner(realmId, uid)
      const updated = await updateWorkspaceGroup(realmId, data)
      return ok(updated)
    }
  )

  server.tool(
    'delete_realm',
    'Delete a realm (cannot delete personal realm)',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
    },
    async ({ realmId }, extra) => {
      const uid = getUserId(extra)
      await requireOwner(realmId, uid)
      if (await isPersonalWorkspace(realmId)) return fail('Cannot delete personal realm')
      await deleteWorkspaceGroup(realmId)
      return ok({ deleted: realmId })
    }
  )

  server.tool(
    'list_realm_members',
    'List members of a realm',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
    },
    async ({ realmId }, extra) => {
      const uid = getUserId(extra)
      const role = await getGroupRole(realmId, uid)
      if (!role) return fail('Not a member of this realm')
      return ok(await findGroupMembers(realmId))
    }
  )

  server.tool(
    'invite_realm_member',
    'Invite a user to a realm by email',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
      email: z.string().email().describe('User email'),
      role: z.enum(['editor', 'viewer']).default('editor').describe('Member role'),
    },
    async ({ realmId, email, role }, extra) => {
      const uid = getUserId(extra)
      await requireOwner(realmId, uid)
      const result = await inviteOrAddRealmMember(realmId, email, role, uid)
      return ok(result)
    }
  )

  server.tool(
    'remove_realm_member',
    'Remove a member from a realm',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
      userId: z.string().uuid().describe('User UUID to remove'),
    },
    async ({ realmId, userId }, extra) => {
      const callerId = getUserId(extra)
      await requireOwner(realmId, callerId)
      if (callerId === userId) return fail('Cannot remove yourself as owner')
      const targetRole = await getGroupRole(realmId, userId)
      if (targetRole === 'owner') return fail('Cannot remove another owner')
      await removeGroupMember(realmId, userId)
      return ok({ removed: userId })
    }
  )

  server.tool(
    'update_realm_member_role',
    'Change a member role in a realm',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
      userId: z.string().uuid().describe('User UUID'),
      role: z.enum(['editor', 'viewer']).describe('New role'),
    },
    async ({ realmId, userId, role }, extra) => {
      const uid = getUserId(extra)
      await requireOwner(realmId, uid)
      const updated = await updateGroupMemberRole(realmId, userId, role)
      return ok(updated)
    }
  )

  server.tool(
    'list_realm_projects',
    'List projects in a realm',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
    },
    async ({ realmId }, extra) => {
      const uid = getUserId(extra)
      const role = await getGroupRole(realmId, uid)
      if (!role) return fail('Not a member of this realm')
      return ok(await findProjectsInGroup(realmId))
    }
  )

  server.tool(
    'add_project_to_realm',
    'Add a project to a realm',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
      projectId: z.string().uuid().describe('Project UUID'),
    },
    async ({ realmId, projectId }, extra) => {
      const uid = getUserId(extra)
      await requireEditor(realmId, uid)
      const hasAccess = await canAccessProject(uid, projectId)
      if (!hasAccess) return fail('Not authorized to add this project')
      const result = await addProjectToGroup(projectId, realmId, uid)
      return ok(result)
    }
  )

  server.tool(
    'remove_project_from_realm',
    'Remove a project from a realm',
    {
      realmId: z.string().uuid().describe('Realm UUID'),
      projectId: z.string().uuid().describe('Project UUID'),
    },
    async ({ realmId, projectId }, extra) => {
      const uid = getUserId(extra)
      await requireEditor(realmId, uid)
      await removeProjectFromGroup(projectId, realmId)
      return ok({ removed: projectId })
    }
  )

}
