import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { createGanttTasksBatch, verifyRowsOwnership } from '@/lib/data/gantt'
import { createGanttTaskSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

const batchGanttTasksSchema = z.object({
  tasks: z.array(createGanttTaskSchema).min(1).max(100),
})

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

    const parsed = batchGanttTasksSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const rowIds = parsed.data.tasks.map((t) => t.rowId)
    if (!await verifyRowsOwnership(rowIds, id)) {
      return jsonError('One or more rows not found in this project', 404)
    }

    const created = await createGanttTasksBatch(id, parsed.data.tasks)
    return jsonData(created, 201)
  }),
  API_WRITE_LIMIT
)
