import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { addDependenciesBatch } from '@/lib/data/dependencies'

type Params = { params: Promise<{ id: string }> }

const batchDependenciesSchema = z.object({
  pairs: z.array(z.object({
    blockerTaskId: z.string().uuid(),
    blockedTaskId: z.string().uuid(),
  })).min(1).max(100),
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

  const parsed = batchDependenciesSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const batchResult = await addDependenciesBatch(parsed.data.pairs, id)
  return jsonData(batchResult, 201)
})
