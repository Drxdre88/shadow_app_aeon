import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { spawnSessionSchema, listSessionsSchema } from '@/lib/data/validators'
import { createAgentSession, listAgentSessions, findAgentSessionById, updateAgentSessionStatus, recordSessionEvent } from '@/lib/data/sessions'
import { dispatchSpawn } from '@/lib/kairos/spawn'

// Kairos Phase 3 (D16) — REST surface for agent_sessions.
// POST spawns a session (and asks the worker host to shell the CLI).
// GET lists sessions for the caller, with optional status / dominion / project
// filters and a liveOnly shortcut for the UI.

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = spawnSessionSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const session = await createAgentSession(auth.id, parsed.data)

    const callbackBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.AEON_BASE_URL || ''
    const callbackToken = process.env.AEON_API_KEY || ''

    const dispatch = await dispatchSpawn({
      sessionId: session.id,
      engine: session.engine,
      repo: session.repo,
      branch: session.branch,
      goal: session.goal,
      prompt: session.prompt,
      callbackToken,
      callbackBaseUrl,
    })

    if (dispatch.dispatched) {
      await updateAgentSessionStatus(session.id, auth.id, {
        status: 'running',
        workerHost: dispatch.workerHost,
        startedAt: new Date(),
      })
    } else {
      await recordSessionEvent(session.id, {
        seq: 0,
        kind: 'status',
        payload: { dispatched: false, reason: dispatch.reason },
      })
    }

    const final = await findAgentSessionById(session.id, auth.id)
    return jsonData({ session: final, dispatched: dispatch.dispatched }, 201)
  }),
  API_WRITE_LIMIT
)

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth

    const url = new URL(request.url)
    const liveOnly = url.searchParams.get('liveOnly') === 'true'
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const status = url.searchParams.get('status') ?? undefined
    const dominionId = url.searchParams.get('dominionId') ?? undefined
    const projectId = url.searchParams.get('projectId') ?? undefined

    const parsed = listSessionsSchema.safeParse({
      liveOnly,
      limit,
      offset,
      status,
      dominionId,
      projectId,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const rows = await listAgentSessions(auth.id, parsed.data)
    return jsonData({ sessions: rows })
  }),
  API_READ_LIMIT
)
