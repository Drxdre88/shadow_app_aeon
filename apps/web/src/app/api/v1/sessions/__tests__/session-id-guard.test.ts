import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The session id is a path segment, and Postgres answers a malformed uuid
// literal with a 22P02 cast error that can only surface as a 500. The events
// and heartbeat routes already guarded it; the read/patch and kill routes did
// not, so they carried the same defect the projects route was caught with in
// production acceptance (11 September, check 4).

const { findAgentSessionById, updateAgentSessionStatus } = vi.hoisted(() => ({
  findAgentSessionById: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
}))

vi.mock('@/lib/api/rateLimit', () => ({
  withRateLimit: (handler: unknown) => handler,
  API_READ_LIMIT: {},
  API_WRITE_LIMIT: {},
}))

vi.mock('@/lib/api/auth', async () => {
  const { jsonResponse } = await vi.importActual<typeof import('@/lib/api/response')>('@/lib/api/response')
  return {
    authenticateRequest: vi.fn(async () => ({ id: 'user-1', role: 'user' })),
    isApiUser: (result: unknown) => typeof (result as { id?: unknown })?.id === 'string',
    apiHandler: (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
      async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx)
        } catch {
          return jsonResponse({ error: 'Internal server error' }, { status: 500 })
        }
      },
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
    jsonData: (data: unknown, status = 200) => jsonResponse({ data }, { status }),
  }
})

vi.mock('@/lib/data/sessions', () => ({ findAgentSessionById, updateAgentSessionStatus }))

import { GET, PATCH } from '../[id]/route'
import { POST as KILL } from '../[id]/kill/route'

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response>

const SESSION_ID = '20000000-0000-4000-8000-000000000001'

async function call(handler: unknown, id: string, body?: unknown) {
  const request = new NextRequest(`https://aeon.shadow-lab.ai/api/v1/sessions/${encodeURIComponent(id)}`, {
    method: body === undefined ? 'GET' : 'PATCH',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const response = await (handler as Handler)(request, { params: Promise.resolve({ id }) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  findAgentSessionById.mockResolvedValue({ id: SESSION_ID, status: 'queued' })
  updateAgentSessionStatus.mockResolvedValue({ id: SESSION_ID, status: 'killed' })
})

describe('session routes reject a malformed id before any query', () => {
  it.each(['not-a-uuid', '../../etc', ''])('GET answers 404 for %j', async (id) => {
    const { status, body } = await call(GET, id)

    expect(status).toBe(404)
    expect(body.error).toBe('Session not found')
    expect(findAgentSessionById).not.toHaveBeenCalled()
  })

  it('PATCH answers 404 without writing', async () => {
    const { status } = await call(PATCH, 'not-a-uuid', { status: 'killed' })

    expect(status).toBe(404)
    expect(updateAgentSessionStatus).not.toHaveBeenCalled()
  })

  it('kill answers 404 without writing', async () => {
    const { status } = await call(KILL, 'not-a-uuid')

    expect(status).toBe(404)
    expect(updateAgentSessionStatus).not.toHaveBeenCalled()
  })

  it('still serves a well-formed id', async () => {
    const { status } = await call(GET, SESSION_ID)

    expect(status).toBe(200)
    expect(findAgentSessionById).toHaveBeenCalledWith(SESSION_ID, 'user-1')
  })
})
