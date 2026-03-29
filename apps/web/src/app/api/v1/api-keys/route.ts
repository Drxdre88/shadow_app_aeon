import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { createApiKey, listApiKeys, countActiveKeys } from '@/lib/data/api-keys'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const keys = await listApiKeys(result.id)
    return jsonData(keys)
  }),
  API_READ_LIMIT
)

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

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

    const activeCount = await countActiveKeys(result.id)
    if (activeCount >= 10) {
      return jsonError('Maximum 10 active API keys allowed', 409)
    }

    const key = await createApiKey(result.id, name)
    return jsonData(key, 201)
  }),
  API_WRITE_LIMIT
)
