import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById } from '@/lib/data/tasks'
import { addLabelToTask, removeLabelFromTask } from '@/lib/data/labels'

type Params = { params: Promise<{ id: string; taskId: string; labelId: string }> }

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, taskId, labelId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const task = await findTaskById(taskId, id)
    if (!task) return jsonError('Task not found', 404)

    try {
      await addLabelToTask(taskId, labelId, id)
      return jsonData({ added: true }, 201)
    } catch (err) {
      return jsonError((err as Error).message, 400)
    }
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, taskId, labelId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const task = await findTaskById(taskId, id)
    if (!task) return jsonError('Task not found', 404)

    try {
      await removeLabelFromTask(taskId, labelId, id)
      return jsonData({ removed: true })
    } catch (err) {
      return jsonError((err as Error).message, 400)
    }
  }),
  API_WRITE_LIMIT
)
