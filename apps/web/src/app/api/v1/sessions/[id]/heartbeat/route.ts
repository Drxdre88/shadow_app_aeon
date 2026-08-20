import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { heartbeatSessionSchema } from '@/lib/data/validators'
import { heartbeatSession } from '@/lib/data/sessions'

// A non-uuid path param would raise Postgres 22P02 and surface as a 500.
const sessionIdSchema = z.string().uuid()

type Params = { params: Promise<{ id: string }> }

// AI Hangar (Sprint 1) — liveness ping from the runner that holds the claim.
// Only the claiming worker can beat: a mismatch means the session was
// re-claimed elsewhere, so the caller should stop working on it. Staleness is
// never auto-failed here — it only makes the session look unresponsive.

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params
    if (!sessionIdSchema.safeParse(id).success) return jsonError('Session not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = heartbeatSessionSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const session = await heartbeatSession(id, parsed.data.workerId)
    if (!session) return jsonError('Session not found for this worker', 404)

    return jsonData({ session })
  }),
  API_WRITE_LIMIT
)
