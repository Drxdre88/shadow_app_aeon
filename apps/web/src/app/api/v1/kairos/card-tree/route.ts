import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { requestCardTree } from '@/lib/data/card-tree'
import { requestCardTreeSchema } from '@/lib/data/validators/kairos-card-tree'

// Mirrors the request_card_tree MCP tool through the same validator + data fn
// (kairos-card-tree-parity.test.ts). Queues a draft only — no card is created
// until the owner approves the proposal.

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
    const parsed = requestCardTreeSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const res = await requestCardTree(result.id, parsed.data)
    if (!res.ok) return jsonError(res.message, res.reason === 'off' ? 409 : res.reason === 'busy' ? 429 : 403)
    return jsonData(res, res.alreadyRequested ? 200 : 202)
  }),
  API_WRITE_LIMIT
)
