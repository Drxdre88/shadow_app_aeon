import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import {
  findGroupsForUser,
  updateWorkspaceGroup,
  deleteWorkspaceGroup,
  getGroupRole,
  isPersonalWorkspace,
} from '@/lib/data/workspaces'
import { updateRealmSchema } from '@/lib/data/validators'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId } = await (ctx as { params: Promise<{ realmId: string }> }).params
    const realms = await findGroupsForUser(result.id)
    const realm = realms.find((r) => r.id === realmId)
    if (!realm) return jsonError('Realm not found', 404)

    return jsonData(realm)
  }),
  API_READ_LIMIT
)

export const PUT = withRateLimit(
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

    const parsed = updateRealmSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const updated = await updateWorkspaceGroup(realmId, parsed.data)
    return jsonData(updated)
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId } = await (ctx as { params: Promise<{ realmId: string }> }).params

    const role = await getGroupRole(realmId, result.id)
    if (role !== 'owner') return jsonError('Only owner can perform this action', 403)

    if (await isPersonalWorkspace(realmId)) return jsonError('Cannot delete personal realm', 400)

    await deleteWorkspaceGroup(realmId)
    return jsonData({ deleted: realmId })
  }),
  API_WRITE_LIMIT
)
