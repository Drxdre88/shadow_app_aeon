import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { listCredentials, upsertCredential } from '@/lib/data/ai-credentials'
import { isValidProvider } from '@/lib/ai/providers'

function requireAdmin(result: { id: string; role: string }) {
  return result.role === 'admin' ? null : jsonError('AI features restricted to administrators', 403)
}

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const forbidden = requireAdmin(result)
    if (forbidden) return forbidden

    const rows = await listCredentials(result.id)
    return jsonData(rows)
  }),
  API_READ_LIMIT,
)

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const forbidden = requireAdmin(result)
    if (forbidden) return forbidden

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }
    const { provider, label, apiKey } = body as { provider?: string; label?: string; apiKey?: string }
    if (!provider || !isValidProvider(provider)) return jsonError('Invalid provider', 400)
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
      return jsonError('apiKey required (min 8 chars)', 400)
    }
    const safeLabel = (label?.trim() || `${provider} key`).slice(0, 100)

    const row = await upsertCredential(result.id, provider, safeLabel, apiKey.trim())
    return jsonData(row, 201)
  }),
  API_WRITE_LIMIT,
)
