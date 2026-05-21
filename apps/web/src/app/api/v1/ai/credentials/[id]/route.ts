import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { renameCredential, revokeCredential } from '@/lib/data/ai-credentials'

type Params = { params: Promise<{ id: string }> }

function requireAdmin(result: { id: string; role: string }) {
  return result.role === 'admin' ? null : jsonError('AI features restricted to administrators', 403)
}

export const PATCH = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const forbidden = requireAdmin(result)
    if (forbidden) return forbidden

    const { id } = await (ctx as Params).params
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }
    const { label } = body as { label?: string }
    if (!label || typeof label !== 'string' || label.trim().length < 1 || label.length > 100) {
      return jsonError('label required (1-100 chars)', 400)
    }

    const row = await renameCredential(id, result.id, label.trim())
    if (!row) return jsonError('Credential not found', 404)
    return jsonData(row)
  }),
  API_WRITE_LIMIT,
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const forbidden = requireAdmin(result)
    if (forbidden) return forbidden

    const { id } = await (ctx as Params).params
    const ok = await revokeCredential(id, result.id)
    if (!ok) return jsonError('Credential not found', 404)
    return jsonData({ revoked: true })
  }),
  API_WRITE_LIMIT,
)
