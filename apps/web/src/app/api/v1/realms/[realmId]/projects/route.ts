import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { findProjectsInGroup, addProjectToGroup, getGroupRole, canAccessProject } from '@/lib/data/workspaces'
import { addProjectSchema } from '@/lib/data/validators'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId } = (ctx as { params: { realmId: string } }).params

    const role = await getGroupRole(realmId, result.id)
    if (!role) return jsonError('Not a member of this realm', 403)

    const projects = await findProjectsInGroup(realmId)
    return jsonData(projects)
  }),
  API_READ_LIMIT
)

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const { realmId } = (ctx as { params: { realmId: string } }).params

    const role = await getGroupRole(realmId, result.id)
    if (!role || role === 'viewer') return jsonError('Insufficient permissions', 403)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = addProjectSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const hasAccess = await canAccessProject(result.id, parsed.data.projectId)
    if (!hasAccess) return jsonError('Not authorized to add this project', 403)

    await addProjectToGroup(parsed.data.projectId, realmId, result.id)
    return jsonData({ success: true }, 201)
  }),
  API_WRITE_LIMIT
)
