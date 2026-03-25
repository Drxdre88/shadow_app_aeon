import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById } from '@/lib/data/tasks'
import { createChecklistItemsBatch } from '@/lib/data/checklist'

type Params = { params: Promise<{ id: string; taskId: string }> }

const batchChecklistSchema = z.object({
  items: z.array(z.object({
    title: z.string().trim().min(1).max(2000),
    groupName: z.string().trim().max(255).optional(),
  })).min(1).max(200),
})

export const POST = apiHandler(async (request: NextRequest, ctx: unknown) => {
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

  const parsed = batchChecklistSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const created = await createChecklistItemsBatch(taskId, parsed.data.items)
  return jsonData(created, 201)
})
