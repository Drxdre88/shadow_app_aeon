import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listOpenKairosAsks, toOpenKairosAskView } from '@/lib/data/ask'
import { listOpenKairosAsksSchema } from '@/lib/data/validators/kairos-asks'

// Mirrors the list_open_kairos_asks MCP tool through the same validator + data
// fn (kairos-asks-parity.test.ts enforces this). Every open Kairos question,
// oldest first, with its stable Q number.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const parsed = listOpenKairosAsksSchema.safeParse({})
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const asks = (await listOpenKairosAsks(result.id)).map(toOpenKairosAskView)
    return jsonData({ count: asks.length, asks })
  }),
  API_READ_LIMIT
)
