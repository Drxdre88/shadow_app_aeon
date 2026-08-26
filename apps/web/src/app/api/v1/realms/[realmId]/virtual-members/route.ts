import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { getGroupRole } from '@/lib/data/workspaces'
import { listVirtualMembers, createVirtualMember } from '@/lib/data/virtual-members'
import { createVirtualMemberSchema } from '@/lib/data/validators'

// Virtual team members — realm-scoped CRUD. Mirrored 1:1 by the
// virtual-member MCP tools (shared Zod validators + lib/data functions).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId } = await (ctx as { params: Promise<{ realmId: string }> }).params

    const role = await getGroupRole(realmId, result.id)
    if (!role) return jsonError('Not a member of this realm', 403)

    const members = await listVirtualMembers(realmId)
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
    if (!role || role === 'viewer') return jsonError('Insufficient permissions', 403)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = createVirtualMemberSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const member = await createVirtualMember(realmId, parsed.data, result.id)
    return jsonData(member, 201)
  }),
  API_WRITE_LIMIT
)
