import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectAccess, setProjectKairosFeed } from '@/lib/data/projects'
import { setProjectKairosFeedSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

const projectIdSchema = z.string().uuid()

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params
    if (!projectIdSchema.safeParse(id).success) return jsonError('Project not found', 404)

    const access = await verifyProjectAccess(id, result.id)
    if (!access) return jsonError('Project not found', 404)
    if (access.role !== 'owner') return jsonError('Only the project owner can change what Kairos watches', 403)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = setProjectKairosFeedSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const project = await setProjectKairosFeed(id, parsed.data.feed)
    if (!project) return jsonError('Project not found', 404)
    return jsonData({ projectId: id, feed: parsed.data.feed })
  }),
  API_WRITE_LIMIT
)
