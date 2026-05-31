import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { recordSessionEventSchema } from '@/lib/data/validators'
import { findAgentSessionById, listSessionEvents, recordSessionEvent, getNextEventSeq } from '@/lib/data/sessions'

type Params = { params: Promise<{ id: string }> }

// Kairos Phase 3 (D16/D17) — session events ingestion + replay.
// POST is called by the worker host AND by Claude Code PostToolUse / Stop
// hooks; seq may be passed explicitly (worker has the source of truth) or
// auto-assigned server-side (hooks that don't track sequence).
// GET lets the UI tail events with ?afterSeq= for incremental polling.

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params

    const session = await findAgentSessionById(id, auth.id)
    if (!session) return jsonError('Session not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    // Allow seq to be omitted — server assigns the next slot.
    const raw = (body ?? {}) as Record<string, unknown>
    if (raw.seq === undefined || raw.seq === null) {
      raw.seq = await getNextEventSeq(id)
    }

    const parsed = recordSessionEventSchema.safeParse(raw)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const row = await recordSessionEvent(id, parsed.data)
    // Conflict on (session_id, seq) returns null — treat as already-recorded.
    return jsonData({ event: row, accepted: row !== null }, row ? 201 : 200)
  }),
  API_WRITE_LIMIT
)

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params

    const session = await findAgentSessionById(id, auth.id)
    if (!session) return jsonError('Session not found', 404)

    const url = new URL(request.url)
    const afterSeq = url.searchParams.get('afterSeq')
    const limit = Number(url.searchParams.get('limit') ?? '500')

    const events = await listSessionEvents(id, {
      afterSeq: afterSeq !== null ? Number(afterSeq) : undefined,
      limit,
    })
    return jsonData({ events })
  }),
  API_READ_LIMIT
)
