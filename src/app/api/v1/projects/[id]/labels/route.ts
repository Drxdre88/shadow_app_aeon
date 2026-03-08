import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findLabels, createLabel } from '@/lib/data/labels'
import { createLabelSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const GET = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const data = await findLabels(id)
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

  const parsed = createLabelSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const label = await createLabel(id, parsed.data)
  return jsonData(label, 201)
})
