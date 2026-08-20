import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { claimSessionSchema } from '@/lib/data/validators'
import { claimNextSession } from '@/lib/data/sessions'

// AI Hangar (Sprint 1) — pull dispatch. The runner polls this endpoint and
// atomically claims the oldest queued session it can execute. An empty queue
// is the normal case, not an error: 200 with session:null so the poller can
// back off without treating it as a failure.

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

    const parsed = claimSessionSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const session = await claimNextSession(auth.id, parsed.data.workerId, parsed.data.engines)
    return jsonData({ session: session ?? null })
  }),
  API_WRITE_LIMIT
)
