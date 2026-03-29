import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTasks, createTask } from '@/lib/data/tasks'
import { createTaskSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

const statusSchema = z.enum(['todo', 'in-progress', 'done']).optional()
const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent']).optional()

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const url = new URL(request.url)

    const statusResult = statusSchema.safeParse(url.searchParams.get('status') || undefined)
    if (!statusResult.success) return jsonError('Invalid status value', 400)

    const priorityResult = prioritySchema.safeParse(url.searchParams.get('priority') || undefined)
    if (!priorityResult.success) return jsonError('Invalid priority value', 400)

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200') || 200, 500)
    const offset = parseInt(url.searchParams.get('offset') || '0') || 0

    const data = await findTasks(id, { status: statusResult.data, priority: priorityResult.data }, limit, offset)
    return jsonData(data)
  }),
  API_READ_LIMIT
)

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const task = await createTask(id, parsed.data)
    return jsonData(task, 201)
  }),
  API_WRITE_LIMIT
)
