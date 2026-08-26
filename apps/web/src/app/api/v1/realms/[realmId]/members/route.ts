import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { findGroupMembers, getGroupRole, inviteOrAddRealmMember } from '@/lib/data/workspaces'
import { inviteMemberSchema } from '@/lib/data/validators'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId } = await (ctx as { params: Promise<{ realmId: string }> }).params

    const role = await getGroupRole(realmId, result.id)
    if (!role) return jsonError('Not a member of this realm', 403)

    const members = await findGroupMembers(realmId)
    return jsonData(members)
  }),
  API_READ_LIMIT
)

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId } = await (ctx as { params: Promise<{ realmId: string }> }).params

    const role = await getGroupRole(realmId, result.id)
    if (role !== 'owner') return jsonError('Only owner can perform this action', 403)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = inviteMemberSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const inviteResult = await inviteOrAddRealmMember(realmId, parsed.data.email, parsed.data.role, result.id)
    return jsonData(inviteResult, 201)
  }),
  API_WRITE_LIMIT
)
