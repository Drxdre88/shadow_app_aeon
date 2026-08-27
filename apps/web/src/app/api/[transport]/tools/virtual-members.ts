import { z } from 'zod'
import {
  listVirtualMembers,
  createVirtualMember,
  updateVirtualMember,
  deleteVirtualMember,
} from '@/lib/data/virtual-members'
import { getGroupRole } from '@/lib/data/workspaces'
import { createVirtualMemberSchema, updateVirtualMemberSchema } from '@/lib/data/validators'
import type { RegisterFn } from './types'
import { getUserId, ok, fail, notFound } from './types'

// Virtual team members — realm-scoped people without an Aeon account,
// assignable to board cards like real members. Mirrors the REST surface at
// /api/v1/realms/[realmId]/virtual-members (shared Zod validators +
// lib/data functions — parity invariant).

async function requireRealmMember(realmId: string, userId: string) {
  const role = await getGroupRole(realmId, userId)
  return role !== null
}

async function requireRealmEditor(realmId: string, userId: string) {
  const role = await getGroupRole(realmId, userId)
  return !!role && role !== 'viewer'
}

export const registerVirtualMemberTools: RegisterFn = (server) => {
  server.tool(
    'list_virtual_members',
    'List virtual team members of a realm (assignable people without an Aeon account)',
    {
      realmId: z.string().uuid().describe('The realm (workspace group) UUID'),
    },
    { title: 'List Virtual Members', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ realmId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireRealmMember(realmId, uid)) return notFound('Realm')
      return ok(await listVirtualMembers(realmId))
    }
  )

  server.tool(
    'create_virtual_member',
    'Create a virtual team member in a realm — a named assignable person without an Aeon account. Initials are derived from the name when not given.',
    {
      realmId: z.string().uuid().describe('The realm (workspace group) UUID'),
      ...createVirtualMemberSchema.shape,
    },
    { title: 'Create Virtual Member', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ realmId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireRealmEditor(realmId, uid)) return fail('Insufficient permissions')
      return ok(await createVirtualMember(realmId, createVirtualMemberSchema.parse(data), uid))
    }
  )

  server.tool(
    'update_virtual_member',
    'Rename or recolor a virtual team member',
    {
      realmId: z.string().uuid().describe('The realm (workspace group) UUID'),
      virtualMemberId: z.string().uuid().describe('The virtual member UUID'),
      ...updateVirtualMemberSchema.shape,
    },
    { title: 'Update Virtual Member', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ realmId, virtualMemberId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireRealmEditor(realmId, uid)) return fail('Insufficient permissions')
      const updated = await updateVirtualMember(virtualMemberId, realmId, updateVirtualMemberSchema.parse(data))
      return updated ? ok(updated) : notFound('Virtual member')
    }
  )

  server.tool(
    'delete_virtual_member',
    'Delete a virtual team member — their task assignments are removed in the same transaction',
    {
      realmId: z.string().uuid().describe('The realm (workspace group) UUID'),
      virtualMemberId: z.string().uuid().describe('The virtual member UUID'),
    },
    { title: 'Delete Virtual Member', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ realmId, virtualMemberId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireRealmEditor(realmId, uid)) return fail('Insufficient permissions')
      const deleted = await deleteVirtualMember(virtualMemberId, realmId)
      return deleted ? ok({ deleted: true }) : notFound('Virtual member')
    }
  )
}
