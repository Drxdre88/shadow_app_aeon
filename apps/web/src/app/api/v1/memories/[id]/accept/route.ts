import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { findMemoryById } from '@/lib/data/memories'
import { acceptKairosProposal } from '@/lib/kairos/proposal-accept'
import {
  isConstitutionAmendmentProposal,
  OPERATOR_ONLY_AMENDMENT_ERROR,
} from '@/lib/kairos/constitution/amendment'
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

    // A Bearer caller (API key / OAuth / mobile / master key) is not the
    // operator's signed-in session: it may not accept a constitution amendment
    // (docs/kairos/34 §2). Session-cookie callers fall through.
    const isBearer = request.headers.get('authorization')?.startsWith('Bearer ') ?? false
    if (isBearer && isConstitutionAmendmentProposal(await findMemoryById(id, result.id))) {
      return jsonError(OPERATOR_ONLY_AMENDMENT_ERROR, 403)
    }

    const res = await acceptKairosProposal(id, result.id, parsed.data,
      isBearer ? { origin: { kind: 'agent', via: 'rest' } } : { origin: { kind: 'operator', via: 'rest-session' } })
    if (!res) return jsonError('Memory not found', 404)
    if (!res.ok) return jsonError('Memory is not a pending proposal', 400)
    return jsonData(res.memory)
  }),
  API_WRITE_LIMIT
)
