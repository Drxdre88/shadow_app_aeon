import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { findAgentSessionById } from '@/lib/data/sessions'
import { killSessionByOwner } from '@/lib/data/session-kill'

type Params = { params: Promise<{ id: string }> }

// A non-uuid path param would raise Postgres 22P02 and surface as a 500.
const sessionIdSchema = z.string().uuid()

// Terminate a live session. Asks the worker host to SIGTERM the CLI if it
// can; updates the row to status='killed' regardless so the UI reflects the
// operator's intent even when the worker is unreachable.

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params
    if (!sessionIdSchema.safeParse(id).success) return jsonError('Session not found', 404)

    const session = await findAgentSessionById(id, auth.id)
    if (!session) return jsonError('Session not found', 404)

    const { row, workerAck } = await killSessionByOwner(session, auth.id, 'rest')
    return jsonData({ session: row, workerAck })
  }),
  API_WRITE_LIMIT
)
