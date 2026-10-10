import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { findMemoryById } from '@/lib/data/memories'
import { acceptKairosProposal } from '@/lib/kairos/proposal-accept'
import {
  isConstitutionAmendmentProposal,
  isConstitutionRow,
  OPERATOR_ONLY_AMENDMENT_ERROR,
  OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR,
} from '@/lib/kairos/constitution/amendment'
import { isGoalRow, OPERATOR_ONLY_GOAL_ERROR } from '@/lib/kairos/goals/guards'
import { acceptProposalSchema } from '@/lib/data/validators'

// Mirrors the accept_proposal MCP tool through the same validator + data fn
// (parity test enforces this). Promote a staged introspection proposal into a
// committed, operator-endorsed memory. Reject = PATCH with archivedAt set.

type Params = { params: Promise<{ id: string }> }

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied
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
    const proposalRow = isBearer ? await findMemoryById(id, result.id) : null
    if (isBearer && isConstitutionAmendmentProposal(proposalRow)) {
      return jsonError(OPERATOR_ONLY_AMENDMENT_ERROR, 403)
    }
    // Kairos goals are approved or vetoed by the owner only (Phase 2): a
    // bearer caller is refused; the session goes through the decision function.
    if (isBearer && isGoalRow(proposalRow)) return jsonError(OPERATOR_ONLY_GOAL_ERROR, 403)
    // Nor may a bearer caller retire a constitution version via `supersedes`.
    // (A session caller can't either: acceptProposal's supersede UPDATE skips
    // constitution rows.)
    if (isBearer && parsed.data.supersedes?.length) {
      const rows = await Promise.all(parsed.data.supersedes.map((sid) => findMemoryById(sid, result.id)))
      if (rows.some(isConstitutionRow)) return jsonError(OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR, 403)
    }

    const res = await acceptKairosProposal(id, result.id, parsed.data,
      isBearer ? { origin: { kind: 'agent', via: 'rest' } } : { origin: { kind: 'operator', via: 'rest-session' } })
    if (!res) return jsonError('Memory not found', 404)
    if (!res.ok) {
      if (res.reason === 'forbidden_actor') return jsonError(OPERATOR_ONLY_GOAL_ERROR, 403)
      if (res.reason === 'already_decided') return jsonError('Proposal already decided', 409)
      if (res.reason === 'expired') return jsonError('Proposal expired', 409)
      if (res.reason === 'cap_reached') return jsonError('Two goals are already open', 409)
      return jsonError('Memory is not a pending proposal', 400)
    }
    return jsonData(res.memory)
  }),
  API_WRITE_LIMIT
)
