import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listKairosPromises, toKairosPromiseView } from '@/lib/data/kairos-promises'
import { listKairosPromisesSchema } from '@/lib/data/validators/kairos-promises'

// Mirrors the list_kairos_promises MCP tool through the same validator + data
// fn (kairos-promises-parity.test.ts enforces this). Read-only: no REST route
// can keep, drop or re-date a promise.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const scope = request.nextUrl.searchParams.get('scope') ?? undefined
    const parsed = listKairosPromisesSchema.safeParse({ scope })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const promises = (await listKairosPromises(result.id, parsed.data)).map(toKairosPromiseView)
    return jsonData({ count: promises.length, promises })
  }),
  API_READ_LIMIT
)
