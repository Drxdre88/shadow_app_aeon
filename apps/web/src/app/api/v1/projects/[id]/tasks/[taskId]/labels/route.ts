import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById } from '@/lib/data/tasks'
import { findLabelsForTask, setTaskLabels } from '@/lib/data/labels'

type Params = { params: Promise<{ id: string; taskId: string }> }

const setLabelsSchema = z.object({
  labelIds: z.array(z.string().uuid()).max(50),
})

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, taskId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const task = await findTaskById(taskId, id)
    if (!task) return jsonError('Task not found', 404)

    const data = await findLabelsForTask(taskId, id)
    return jsonData(data.map(r => r.labelId))
  }),
  API_READ_LIMIT
)

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, taskId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const task = await findTaskById(taskId, id)
    if (!task) return jsonError('Task not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = setLabelsSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    try {
      await setTaskLabels(taskId, parsed.data.labelIds, id)
      return jsonData({ updated: true })
    } catch (err) {
      return jsonError((err as Error).message, 400)
    }
  }),
  API_WRITE_LIMIT
)
