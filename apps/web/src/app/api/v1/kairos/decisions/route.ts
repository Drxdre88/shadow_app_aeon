import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { listKairosDecisions, logKairosDecision } from '@/lib/data/kairos-decisions'
import { listDecisionsSchema, logDecisionSchema } from '@/lib/data/validators/kairos-decisions'
import { renderDecisionsMarkdown } from '@/lib/kairos/decisions/render'

// Mirrors the list_decisions / log_decision MCP tools through the same
// validators + data fns (kairos-decisions-parity.test.ts). A REST log is
// relayed: it waits for the owner to confirm it in the app. No REST route can
// settle a decision.

const LOG_REFUSAL_STATUS: Record<string, number> = { past_check_by: 400, full: 409 }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const q = request.nextUrl.searchParams
    const parsed = listDecisionsSchema.safeParse({ scope: q.get('scope') ?? undefined, format: q.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const list = await listKairosDecisions(result.id, parsed.data)
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderDecisionsMarkdown(list) })
    return jsonData({ count: list.decisions.length, ...list })
  }),
  API_READ_LIMIT
)

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
    const parsed = logDecisionSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const res = await logKairosDecision(result.id, parsed.data, { kind: 'relayed', via: 'rest' })
    if (!res.ok) return jsonError(`Could not log the decision: ${res.reason}`, LOG_REFUSAL_STATUS[res.reason] ?? 400)
    return jsonData({ decision: res.decision, note: 'Relayed — the owner confirms it in the app before it counts.' }, 201)
  }),
  API_WRITE_LIMIT
)
