import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { acceptProposal } from '@/lib/data/memories'
import { acceptProposalSchema } from '@/lib/data/validators'

// Mirrors the accept_proposal MCP tool through the same validator + data fn
// (parity test enforces this). Promote a staged introspection proposal into a
// committed, operator-endorsed memory. Reject = PATCH with archivedAt set.

type Params = { params: Promise<{ id: string }> }

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    // Body is optional — all fields default; tolerate an empty/absent body.
    let body: unknown = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const parsed = acceptProposalSchema.safeParse(body ?? {})
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const res = await acceptProposal(id, result.id, parsed.data)
    if (!res) return jsonError('Memory not found', 404)
    if (!res.ok) return jsonError('Memory is not a pending proposal', 400)
    return jsonData(res.memory)
  }),
  API_WRITE_LIMIT
)
