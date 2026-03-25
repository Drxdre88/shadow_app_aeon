import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { reorderColumns } from '@/lib/data/columns'

type Params = { params: Promise<{ id: string }> }

const reorderColumnsSchema = z.object({
  updates: z.array(z.object({
    id: z.string().uuid(),
    orderIndex: z.number().int().min(0),
  })).min(1),
})

export const PUT = apiHandler(async (request: NextRequest, ctx: unknown) => {
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

  const parsed = reorderColumnsSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  await reorderColumns(id, parsed.data.updates)
  return jsonData({ reordered: true })
})
