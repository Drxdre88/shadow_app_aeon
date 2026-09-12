import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Contract tests for POST /api/v1/sessions, written against the two defects
// the 11 September production acceptance run found on this route:
//   check 7  — metadata.hangar.objective 'launch_the_moon' was accepted at 201
//   check 10 — three concurrent losers of the one-live-mission race got 500
// The data layer and dispatch are mocked; what is under test is the route's
// own contract: which status each outcome earns and what the body says.

const USER_ID = '10000000-0000-4000-8000-000000000001'
const TASK_ID = '30000000-0000-4000-8000-000000000001'
const LIVE_SESSION_ID = '20000000-0000-4000-8000-0000000000aa'

// Hoisted with the vi.mock factories that close over them.
const { LiveMissionExistsError, createAgentSession, findLiveSessionForTask } = vi.hoisted(() => {
  class LiveMissionExistsError extends Error {
    constructor() {
      super('This card already has a live mission — kill it before launching again')
      this.name = 'LiveMissionExistsError'
    }
  }
  return { LiveMissionExistsError, createAgentSession: vi.fn(), findLiveSessionForTask: vi.fn() }
})

vi.mock('@/lib/api/rateLimit', () => ({
  withRateLimit: (handler: unknown) => handler,
  API_READ_LIMIT: {},
  API_WRITE_LIMIT: {},
}))

vi.mock('@/lib/api/auth', async () => {
  const { jsonResponse } = await vi.importActual<typeof import('@/lib/api/response')>('@/lib/api/response')
  return {
    authenticateRequest: vi.fn(async () => ({ id: USER_ID, role: 'user' })),
    isApiUser: (result: unknown) => typeof (result as { id?: unknown })?.id === 'string',
    // Mirrors the real wrapper: an uncaught throw becomes an opaque 500, which
    // is exactly what a duplicate launch used to produce.
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

vi.mock('@/lib/data/sessions', () => ({
  LiveMissionExistsError,
  createAgentSession,
  findLiveSessionForTask,
  listAgentSessions: vi.fn(async () => []),
  findAgentSessionById: vi.fn(async (id: string) => ({ id, status: 'queued' })),
  updateAgentSessionStatus: vi.fn(async () => null),
  recordSessionEvent: vi.fn(async () => null),
}))

vi.mock('@/lib/kairos/spawn', () => ({
  dispatchSpawn: vi.fn(async () => ({ dispatched: false, reason: 'pull-mode' })),
}))

import { POST } from '../route'

function spawnRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://aeon.shadow-lab.ai/api/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BODY = {
  engine: 'copilot',
  goal: 'Contract probe',
  prompt: 'Do not execute.',
  repo: 'aeon-os-test',
  projectId: '40000000-0000-4000-8000-000000000001',
}

async function post(body: Record<string, unknown>) {
  const response = await (POST as unknown as (req: NextRequest, ctx: unknown) => Promise<Response>)(
    spawnRequest(body),
    {},
  )
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  createAgentSession.mockResolvedValue({
    id: 'session-1',
    engine: 'copilot',
    repo: 'aeon-os-test',
    branch: null,
    goal: BODY.goal,
    prompt: BODY.prompt,
  })
  findLiveSessionForTask.mockResolvedValue(null)
})

describe('POST /api/v1/sessions — Hangar metadata contract', () => {
  it('refuses an objective outside the Hangar contract with a 400 that names the field', async () => {
    const { status, body } = await post({ ...BODY, metadata: { hangar: { objective: 'launch_the_moon' } } })

    expect(status).toBe(400)
    expect(String(body.error)).toContain('metadata.hangar.objective')
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('accepts a valid objective', async () => {
    const { status } = await post({ ...BODY, metadata: { hangar: { objective: 'analysis' } } })

    expect(status).toBe(201)
    expect(createAgentSession).toHaveBeenCalledOnce()
  })

  it('leaves session metadata free-form when there is no hangar slice', async () => {
    const { status } = await post({ ...BODY, metadata: { anything: { at: 'all' } } })

    expect(status).toBe(201)
  })
})

describe('POST /api/v1/sessions — duplicate launch contract', () => {
  it('answers a lost one-live-mission race with 409, not 500', async () => {
    createAgentSession.mockRejectedValue(new LiveMissionExistsError())

    const { status, body } = await post({ ...BODY, taskId: TASK_ID })

    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/already has a live mission/i)
  })

  it('names the session that won the race when it belongs to the caller', async () => {
    createAgentSession.mockRejectedValue(new LiveMissionExistsError())
    findLiveSessionForTask.mockResolvedValue({ id: LIVE_SESSION_ID, userId: USER_ID })

    const { status, body } = await post({ ...BODY, taskId: TASK_ID })

    expect(status).toBe(409)
    expect(body.sessionId).toBe(LIVE_SESSION_ID)
  })

  it('never hands back a session id belonging to another user', async () => {
    createAgentSession.mockRejectedValue(new LiveMissionExistsError())
    findLiveSessionForTask.mockResolvedValue({ id: LIVE_SESSION_ID, userId: 'someone-else' })

    const { status, body } = await post({ ...BODY, taskId: TASK_ID })

    expect(status).toBe(409)
    expect(body.sessionId).toBeUndefined()
  })

  it('still reports an unrelated failure as a 500', async () => {
    createAgentSession.mockRejectedValue(new Error('connection terminated'))

    const { status } = await post({ ...BODY, taskId: TASK_ID })

    expect(status).toBe(500)
  })
})
