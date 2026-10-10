import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { requestCardTree, type RequestCardTreeResult } from '@/lib/data/card-tree'
import { requestCardTreeSchema } from '@/lib/data/validators/kairos-card-tree'

// Mirrors the request_card_tree MCP tool through the same validator + data fn
// (kairos-card-tree-parity.test.ts). Queues a draft only — no card is created
// until the owner approves the proposal.

// 'no_brain': the caller's brain routine is not connected, so nothing would draft the goal.
const CARD_TREE_REFUSAL_STATUS: Record<Extract<RequestCardTreeResult, { ok: false }>['reason'], number> = {
  off: 409,
  no_brain: 409,
  busy: 429,
  forbidden: 403,
}

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
    const parsed = requestCardTreeSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const res = await requestCardTree(result.id, parsed.data)
    if (!res.ok) return jsonError(res.message, CARD_TREE_REFUSAL_STATUS[res.reason])
    return jsonData(res, res.alreadyRequested ? 200 : 202)
  }),
  API_WRITE_LIMIT
)
