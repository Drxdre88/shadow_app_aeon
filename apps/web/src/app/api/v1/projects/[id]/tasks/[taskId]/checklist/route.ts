import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById } from '@/lib/data/tasks'
import { findChecklistItems, createChecklistItem } from '@/lib/data/checklist'
import { createChecklistItemSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string; taskId: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, taskId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const task = await findTaskById(taskId, id)
    if (!task) return jsonError('Task not found', 404)

    const data = await findChecklistItems(taskId, id)
    return jsonData(data)
  }),
  API_READ_LIMIT
)

export const POST = withRateLimit(
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

    // `id` in the shared schema exists for the web client's offline-replay
    // idempotency only — not part of the public REST contract, so strip it.
    const parsed = createChecklistItemSchema.omit({ id: true }).safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const item = await createChecklistItem(taskId, parsed.data)
    return jsonData(item, 201)
  }),
  API_WRITE_LIMIT
)
