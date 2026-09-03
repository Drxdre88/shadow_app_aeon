import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { updateGroupMemberRole, removeGroupMember, getGroupRole } from '@/lib/data/workspaces'
import { updateRoleSchema } from '@/lib/data/validators'

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId, userId } = await (ctx as { params: Promise<{ realmId: string; userId: string }> }).params

    const role = await getGroupRole(realmId, result.id)
    if (role !== 'owner') return jsonError('Only owner can perform this action', 403)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = updateRoleSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const updated = await updateGroupMemberRole(realmId, userId, parsed.data.role)
    return jsonData(updated)
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId, userId } = await (ctx as { params: Promise<{ realmId: string; userId: string }> }).params

    const role = await getGroupRole(realmId, result.id)
    if (role !== 'owner') return jsonError('Only owner can perform this action', 403)

    if (result.id === userId) return jsonError('Cannot remove yourself as owner', 400)

    const targetRole = await getGroupRole(realmId, userId)
    if (targetRole === 'owner') return jsonError('Cannot remove another owner', 403)

    await removeGroupMember(realmId, userId)
    return jsonData({ removed: userId })
  }),
  API_WRITE_LIMIT
)
