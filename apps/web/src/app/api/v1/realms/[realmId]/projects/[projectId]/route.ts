import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { removeProjectFromGroup, getGroupRole } from '@/lib/data/workspaces'

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId, projectId } = await (ctx as { params: Promise<{ realmId: string; projectId: string }> }).params

    const role = await getGroupRole(realmId, result.id)
    if (!role || role === 'viewer') return jsonError('Insufficient permissions', 403)

    await removeProjectFromGroup(projectId, realmId)
    return jsonData({ removed: projectId })
  }),
  API_WRITE_LIMIT
)
