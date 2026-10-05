import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { dismissKairosAsk } from '@/lib/kairos/ask'
import { dismissKairosAskSchema } from '@/lib/data/validators/kairos-asks'

// Mirrors the dismiss_kairos_ask MCP tool through the same validator + fn
// (kairos-asks-parity.test.ts enforces this). The operator's "skip Q12":
// status 'dismissed', archived, no negative outcome.

type Params = { params: Promise<{ id: string }> }

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const parsed = dismissKairosAskSchema.safeParse({ askId: id })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const res = await dismissKairosAsk(result.id, parsed.data.askId)
    if ('error' in res) return jsonError('Open Vorath question not found', 404)
    return jsonData({ dismissed: true, id: res.id })
  }),
  API_WRITE_LIMIT
)
