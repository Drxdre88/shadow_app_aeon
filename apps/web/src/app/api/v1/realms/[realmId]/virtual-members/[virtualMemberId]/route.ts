import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { getGroupRole } from '@/lib/data/workspaces'
import { updateVirtualMember, deleteVirtualMember } from '@/lib/data/virtual-members'
import { updateVirtualMemberSchema } from '@/lib/data/validators'

type Params = { params: { realmId: string; virtualMemberId: string } }

export const PATCH = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId, virtualMemberId } = (ctx as Params).params

    const role = await getGroupRole(realmId, result.id)
    if (!role || role === 'viewer') return jsonError('Insufficient permissions', 403)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = updateVirtualMemberSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    // realm-scoped update — a member id from another realm 404s.
    const updated = await updateVirtualMember(virtualMemberId, realmId, parsed.data)
    if (!updated) return jsonError('Virtual member not found', 404)
    return jsonData(updated)
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId, virtualMemberId } = (ctx as Params).params

    const role = await getGroupRole(realmId, result.id)
    if (!role || role === 'viewer') return jsonError('Insufficient permissions', 403)

    // Cleans the member's task assignments in the same transaction.
    const deleted = await deleteVirtualMember(virtualMemberId, realmId)
    if (!deleted) return jsonError('Virtual member not found', 404)
    return jsonData({ deleted: true })
  }),
  API_WRITE_LIMIT
)
