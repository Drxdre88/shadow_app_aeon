import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { answerNumberedKairosAsks } from '@/lib/kairos/ask'
import { formatNumberedAck } from '@/lib/kairos/ask-numbered'
import { answerAsksFromMessageSchema } from '@/lib/data/validators/kairos-asks'

// Mirrors the answer_asks_from_message MCP tool through the same validator +
// fn (kairos-asks-parity.test.ts). A bearer caller relays the owner's message
// (agent origin); a session caller is the owner typing (operator origin).

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }
    const parsed = answerAsksFromMessageSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const isBearer = request.headers.get('authorization')?.startsWith('Bearer ') ?? false
    const origin = isBearer ? { kind: 'agent' as const, via: 'rest' } : { kind: 'operator' as const, via: 'rest-session' }
    const { message, repliedToText } = parsed.data
    const outcome = await answerNumberedKairosAsks(result.id, message, new Date(), repliedToText, origin)
    if (!outcome.matched) return jsonData({ matched: false })
    return jsonData({ ...outcome, ack: formatNumberedAck(outcome) })
  }),
  API_WRITE_LIMIT
)
