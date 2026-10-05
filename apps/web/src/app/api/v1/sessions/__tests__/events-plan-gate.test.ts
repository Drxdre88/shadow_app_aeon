import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Plan-then-approve: a completed planning run's result becomes the card's
// Plan checklist; build runs and non-completed plans are left alone.

const mocks = vi.hoisted(() => ({
  findAgentSessionById: vi.fn(),
  recordSessionEvent: vi.fn(),
  recordSessionEventWithAutoSeq: vi.fn(),
  recordSessionEvents: vi.fn(),
  listSessionEvents: vi.fn(),
  getNextEventSeq: vi.fn(),
  recordSessionResult: vi.fn(),
  applyPlanResult: vi.fn(),
}))

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))
vi.mock('@/lib/api/rateLimit', () => ({ withRateLimit: (handler: unknown) => handler, API_READ_LIMIT: {}, API_WRITE_LIMIT: {} }))
vi.mock('@/lib/api/auth', async () => {
  const { jsonResponse } = await vi.importActual<typeof import('@/lib/api/response')>('@/lib/api/response')
  return {
    authenticateRequest: vi.fn(async () => ({ id: 'user-1', role: 'user' })),
    isApiUser: (result: unknown) => typeof (result as { id?: unknown })?.id === 'string',
    apiHandler: (handler: (req: unknown, ctx: unknown) => Promise<Response>) => handler,
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
    jsonData: (data: unknown, status = 200) => jsonResponse({ data }, { status }),
  }
})
vi.mock('@/lib/data/sessions', () => ({
  findAgentSessionById: mocks.findAgentSessionById,
  recordSessionEvent: mocks.recordSessionEvent,
  recordSessionEventWithAutoSeq: mocks.recordSessionEventWithAutoSeq,
  recordSessionEvents: mocks.recordSessionEvents,
  listSessionEvents: mocks.listSessionEvents,
  getNextEventSeq: mocks.getNextEventSeq,
  recordSessionResult: mocks.recordSessionResult,
}))
vi.mock('@/lib/kairos/mission-memory', () => ({ captureMissionMemory: vi.fn() }))
vi.mock('@/lib/data/hangar-autopilot', () => ({ applyPlanResult: mocks.applyPlanResult }))

import { POST } from '../[id]/events/route'

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response>
const SESSION_ID = '20000000-0000-4000-8000-000000000001'
const TASK_ID = '30000000-0000-4000-8000-000000000002'
const PLAN = { status: 'completed', outcome: 'planned', summary: '1. First\n2. Second' }

function session(phase: string | undefined) {
  return { id: SESSION_ID, engine: 'copilot', taskId: TASK_ID, metadata: { hangar: { objective: phase === 'plan' ? 'plan' : 'implement', ...(phase ? { phase } : {}) } } }
}

async function postResult(payload: unknown) {
  const request = new NextRequest(`https://aeon.test/api/v1/sessions/${SESSION_ID}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seq: 9, kind: 'result', payload }),
  })
  return (POST as unknown as Handler)(request, { params: Promise.resolve({ id: SESSION_ID }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.recordSessionEvent.mockResolvedValue({ id: 'ev' })
  mocks.recordSessionResult.mockResolvedValue({ session: { id: SESSION_ID }, task: { id: TASK_ID } })
})

describe('POST /sessions/:id/events — plan gate', () => {
  it('writes a completed planning result to the card plan', async () => {
    mocks.findAgentSessionById.mockResolvedValue(session('plan'))
    const res = await postResult(PLAN)
    expect(res.status).toBe(201)
    expect(mocks.applyPlanResult).toHaveBeenCalledWith(SESSION_ID, TASK_ID, expect.objectContaining({ outcome: 'planned' }))
  })

  it('ignores build runs and plans that need input', async () => {
    mocks.findAgentSessionById.mockResolvedValue(session('build'))
    await postResult({ ...PLAN, outcome: 'implemented', artifacts: ['a.ts'] })
    mocks.findAgentSessionById.mockResolvedValue(session('plan'))
    await postResult({ ...PLAN, status: 'needs_input', questions: ['Which repo?'] })
    expect(mocks.applyPlanResult).not.toHaveBeenCalled()
  })

  it('keeps the result accepted when the plan write fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.findAgentSessionById.mockResolvedValue(session('plan'))
    mocks.applyPlanResult.mockRejectedValue(new Error('neon blip'))
    const res = await postResult(PLAN)
    expect(res.status).toBe(201)
    expect(error).toHaveBeenCalledWith('[sessions/events] plan checklist write failed', expect.objectContaining({ sessionId: SESSION_ID }))
    error.mockRestore()
  })
})
