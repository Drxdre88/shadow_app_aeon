import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { updateGanttTask, deleteGanttTask, verifyRowOwnership } from '@/lib/data/gantt'
import { updateGanttTaskSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string; taskId: string }> }

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

  const parsed = updateGanttTaskSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  if (parsed.data.rowId && !await verifyRowOwnership(parsed.data.rowId, id)) {
    return jsonError('Row not found in this project', 404)
  }

  const task = await updateGanttTask(taskId, id, parsed.data)
  if (!task) return jsonError('Gantt task not found', 404)
  return jsonData(task)
})

export const DELETE = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, taskId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const deleted = await deleteGanttTask(taskId, id)
  if (!deleted) return jsonError('Gantt task not found', 404)
  return jsonData({ deleted: true })
})
