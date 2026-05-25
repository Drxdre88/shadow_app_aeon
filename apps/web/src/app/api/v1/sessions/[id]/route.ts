import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { updateSessionStatusSchema } from '@/lib/data/validators'
import { findAgentSessionById, updateAgentSessionStatus } from '@/lib/data/sessions'

type Params = { params: Promise<{ id: string }> }

// GET — fetch a session by id (caller must own it).
// PATCH — update status / worker fields. Used by the worker host as the CLI
// transitions through queued → running → succeeded/failed.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params

    const row = await findAgentSessionById(id, auth.id)
    if (!row) return jsonError('Session not found', 404)
    return jsonData(row)
  }),
  API_READ_LIMIT
)

export const PATCH = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = updateSessionStatusSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const row = await updateAgentSessionStatus(id, auth.id, parsed.data)
    if (!row) return jsonError('Session not found', 404)
    return jsonData(row)
  }),
  API_WRITE_LIMIT
)
