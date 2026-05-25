import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { findAgentSessionById, updateAgentSessionStatus } from '@/lib/data/sessions'

type Params = { params: Promise<{ id: string }> }

// Terminate a live session. Asks the worker host to SIGTERM the CLI if it
// can; updates the row to status='killed' regardless so the UI reflects the
// operator's intent even when the worker is unreachable.

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params

    const session = await findAgentSessionById(id, auth.id)
    if (!session) return jsonError('Session not found', 404)

    const workerUrl = process.env.KAIROS_WORKER_URL
    const workerSecret = process.env.KAIROS_WORKER_SECRET
    let workerAck = false
    if (workerUrl) {
      try {
        const res = await fetch(`${workerUrl.replace(/\/$/, '')}/kill/${session.id}`, {
          method: 'POST',
          headers: workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {},
          signal: AbortSignal.timeout(5_000),
        })
        workerAck = res.ok
      } catch {
        workerAck = false
      }
    }

    const row = await updateAgentSessionStatus(id, auth.id, {
      status: 'killed',
      endedAt: new Date(),
    })
    return jsonData({ session: row, workerAck })
  }),
  API_WRITE_LIMIT
)
