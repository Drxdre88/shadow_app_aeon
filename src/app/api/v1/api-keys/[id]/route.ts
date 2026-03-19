import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { renameApiKey, revokeApiKey } from '@/lib/data/api-keys'

type Params = { params: Promise<{ id: string }> }

export const PATCH = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result

  const { id } = await (ctx as Params).params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const { name } = body as { name?: string }
  if (!name || typeof name !== 'string' || name.length < 1 || name.length > 100) {
    return jsonError('name is required (1-100 chars)', 400)
  }

  const updated = await renameApiKey(id, result.id, name)
  if (!updated) return jsonError('API key not found', 404)
  return jsonData(updated)
})

export const DELETE = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result

  const { id } = await (ctx as Params).params

  const revoked = await revokeApiKey(id, result.id)
  if (!revoked) return jsonError('API key not found', 404)
  return jsonData({ revoked: true })
})
