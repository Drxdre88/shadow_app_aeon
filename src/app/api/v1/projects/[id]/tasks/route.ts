import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTasks, createTask } from '@/lib/data/tasks'
import { createTaskSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const GET = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || undefined
  const priority = url.searchParams.get('priority') || undefined
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200') || 200, 500)
  const offset = parseInt(url.searchParams.get('offset') || '0') || 0

  const data = await findTasks(id, { status, priority }, limit, offset)
  return jsonData(data)
})

export const POST = apiHandler(async (request: NextRequest, ctx: unknown) => {
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
})
