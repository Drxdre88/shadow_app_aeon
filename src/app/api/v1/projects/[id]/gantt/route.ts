import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findGanttTasksWithRows, createGanttTask, verifyRowOwnership } from '@/lib/data/gantt'
import { createGanttTaskSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const GET = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const data = await findGanttTasksWithRows(id)
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

  const parsed = createGanttTaskSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  if (!await verifyRowOwnership(parsed.data.rowId, id)) {
    return jsonError('Row not found in this project', 404)
  }

  const task = await createGanttTask(id, parsed.data)
  return jsonData(task, 201)
})
