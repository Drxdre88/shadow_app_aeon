import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById, updateTask, deleteTask } from '@/lib/data/tasks'
import { updateTaskSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string; taskId: string }> }

export const GET = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, taskId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const task = await findTaskById(taskId, id)
  if (!task) return jsonError('Task not found', 404)
  return jsonData(task)
})

export const PUT = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, taskId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const parsed = updateTaskSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const task = await updateTask(taskId, id, parsed.data)
  if (!task) return jsonError('Task not found', 404)
  return jsonData(task)
})

export const DELETE = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, taskId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const deleted = await deleteTask(taskId, id)
  if (!deleted) return jsonError('Task not found', 404)
  return jsonData({ deleted: true })
})
