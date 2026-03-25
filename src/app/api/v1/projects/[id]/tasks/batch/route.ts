import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { createTasksBatch } from '@/lib/data/tasks'
import { createTaskSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

const batchTasksSchema = z.object({
  tasks: z.array(createTaskSchema).min(1).max(100),
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

  const parsed = batchTasksSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const tasks = parsed.data.tasks.map(t => ({
    ...t,
    startDate: t.startDate ?? undefined,
    endDate: t.endDate ?? undefined,
  }))
  const created = await createTasksBatch(id, tasks)
  return jsonData(created, 201)
})
