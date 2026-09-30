import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Mission envelope → memory (Kairos 2909 §C injection 1). The events route
// must turn a freshly settled kind:'result' into ONE session_summary memory
// and link it from agent_sessions.memoryId — without ever failing the POST.

const mocks = vi.hoisted(() => ({
  findAgentSessionById: vi.fn(),
  recordSessionEvent: vi.fn(),
  recordSessionEventWithAutoSeq: vi.fn(),
  recordSessionEvents: vi.fn(),
  listSessionEvents: vi.fn(),
  getNextEventSeq: vi.fn(),
  recordSessionResult: vi.fn(),
  findMissionCardContext: vi.fn(),
  countFlightDeckSignals: vi.fn(),
  attachSessionMemory: vi.fn(),
  captureMemory: vi.fn(),
  pending: [] as Promise<unknown>[],
}))

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => { mocks.pending.push(Promise.resolve().then(fn)) },
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

vi.mock('@/lib/data/sessions', () => ({
  findAgentSessionById: mocks.findAgentSessionById,
  recordSessionEvent: mocks.recordSessionEvent,
  recordSessionEventWithAutoSeq: mocks.recordSessionEventWithAutoSeq,
  recordSessionEvents: mocks.recordSessionEvents,
  listSessionEvents: mocks.listSessionEvents,
  getNextEventSeq: mocks.getNextEventSeq,
  recordSessionResult: mocks.recordSessionResult,
  findMissionCardContext: mocks.findMissionCardContext,
  countFlightDeckSignals: mocks.countFlightDeckSignals,
  attachSessionMemory: mocks.attachSessionMemory,
}))

vi.mock('@/lib/data/memories', () => ({ captureMemory: mocks.captureMemory }))

import { POST } from '../[id]/events/route'

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response>

const SESSION_ID = '20000000-0000-4000-8000-000000000001'
const TASK_ID = '30000000-0000-4000-8000-000000000002'
const PROJECT_ID = '40000000-0000-4000-8000-000000000003'
const DOMINION_ID = '50000000-0000-4000-8000-000000000004'
const MEMORY_ID = '60000000-0000-4000-8000-000000000005'

const ENVELOPE = {
  status: 'completed',
  outcome: 'shipped',
  summary: 'Added the mission memory bridge. Tests pass.\nSecond line.',
  branch: 'hangar/mission-memory',
  commit: 'abc1234def5678',
  artifacts: ['apps/web/src/lib/kairos/mission-memory.ts'],
  tests: { status: 'passed', summary: '12 passed' },
  questions: ['Ship it?'],
  recommended_tasks: [{ title: 'Follow-up', objective: 'implement', instruction: 'do it' }],
  stats: { totalCostUsd: 0.42, inputTokens: 1000, outputTokens: 200, numTurns: 7, durationMs: 90_000, toolCalls: 12, model: 'claude-sonnet-4-6' },
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    engine: 'claude',
    repo: 'aeon',
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    dominionId: null,
    status: 'running',
    startedAt: new Date('2026-09-30T10:00:00Z'),
    spawnedAt: new Date('2026-09-30T09:59:00Z'),
    metadata: { hangar: { objective: 'implement', repo: 'aeon' } },
    ...overrides,
  }
}

async function post(body: unknown) {
  const request = new NextRequest(`https://aeon.shadow-lab.ai/api/v1/sessions/${SESSION_ID}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const response = await (POST as unknown as Handler)(request, { params: Promise.resolve({ id: SESSION_ID }) })
  await Promise.all(mocks.pending)
  return { status: response.status, body: await response.json() as { data: Record<string, unknown> } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pending.length = 0
  mocks.findAgentSessionById.mockResolvedValue(session())
  mocks.recordSessionEvent.mockImplementation(async (_id: string, input: { seq: number; kind: string }) => ({ id: 'ev', ...input }))
  mocks.recordSessionEventWithAutoSeq.mockImplementation(async (_id: string, input: { seq: number; kind: string }) => ({ id: 'ev', ...input }))
  mocks.getNextEventSeq.mockResolvedValue(5)
  mocks.recordSessionResult.mockResolvedValue({ session: session({ status: 'succeeded' }), task: { id: TASK_ID } })
  mocks.findMissionCardContext.mockResolvedValue({ taskId: TASK_ID, name: 'Mission memory bridge', projectId: PROJECT_ID, dominionId: DOMINION_ID })
  mocks.countFlightDeckSignals.mockResolvedValue({ errors: 1, warnings: 2, downgrades: 0 })
  mocks.captureMemory.mockResolvedValue({ memory: { id: MEMORY_ID }, created: true })
  mocks.attachSessionMemory.mockResolvedValue({ id: SESSION_ID, memoryId: MEMORY_ID })
})

describe('POST /sessions/:id/events — mission memory', () => {
  it('captures one session_summary memory for a result envelope and links it', async () => {
    const res = await post({ seq: 9, kind: 'result', payload: ENVELOPE })

    expect(res.status).toBe(201)
    expect(res.body.data.resultProcessed).toBe(true)
    expect(mocks.captureMemory).toHaveBeenCalledTimes(1)

    const [userId, input] = mocks.captureMemory.mock.calls[0]
    expect(userId).toBe('user-1')
    // The card owner's Dominion must not leak onto a launcher's memory; only
    // the session's own (launcher-owned) Dominion may be set explicitly.
    expect(input.dominionId).toBeUndefined()
    expect(input).toMatchObject({
      type: 'session_summary',
      source: 'system',
      streamClass: 'agentic',
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      title: 'aeon: Mission memory bridge',
      summary: 'Added the mission memory bridge.',
    })
    expect(input.sourceMetadata).toMatchObject({
      kind: 'hangar_mission',
      externalId: `hangar:${SESSION_ID}`,
      flightDeck: { errors: 1, warnings: 2, downgrades: 0 },
      session: {
        v: 1,
        client: 'claude',
        sessionId: SESSION_ID,
        hangarSessionId: SESSION_ID,
        taskId: TASK_ID,
        projectId: PROJECT_ID,
        repo: 'aeon',
        registrySlug: 'aeon',
        worktree: true,
        cardName: 'Mission memory bridge',
        objective: 'implement',
        status: 'completed',
        outcome: 'shipped',
        branch: 'hangar/mission-memory',
        commits: [{ sha: 'abc1234def5678' }],
        tests: { status: 'passed', summary: '12 passed' },
        questions: ['Ship it?'],
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.42,
        durationMin: 1.5,
        toolCalls: { total: 12 },
        errorCount: 1,
        files: ['apps/web/src/lib/kairos/mission-memory.ts'],
      },
    })
    expect(typeof input.sourceMetadata.session.endedAt).toBe('string')
    expect(input.bodyMd).toContain('**Status:** completed — shipped')
    expect(input.bodyMd).toContain('hangar/mission-memory @ abc1234def56')
    expect(input.bodyMd).toContain('**Tests:** passed — 12 passed')
    expect(input.bodyMd).toContain('- Ship it?')
    expect(input.bodyMd).toContain('- Follow-up (implement)')
    expect(input.bodyMd).toContain('7 turns')

    expect(mocks.attachSessionMemory).toHaveBeenCalledWith(SESSION_ID, 'user-1', MEMORY_ID)
  })

  it('captures the enforced (downgraded) envelope, not the agent claim', async () => {
    const noDelivery = { ...ENVELOPE, branch: null, commit: null, artifacts: [] }
    const res = await post({ seq: 9, kind: 'result', payload: noDelivery })

    expect(res.status).toBe(201)
    expect(res.body.data.resultDowngraded).toBeTruthy()
    const [, input] = mocks.captureMemory.mock.calls[0]
    expect(input.sourceMetadata.session.status).toBe('needs_input')
    expect(input.sourceMetadata.session.questions[0]).toMatch(/claimed completed/)
  })

  it('does not capture for non-result events', async () => {
    const res = await post({ seq: 3, kind: 'tool_use', toolName: 'Bash', payload: { cmd: 'ls' } })

    expect(res.status).toBe(201)
    expect(mocks.captureMemory).not.toHaveBeenCalled()
    expect(mocks.attachSessionMemory).not.toHaveBeenCalled()
  })

  it('does not capture when the result was not applied', async () => {
    mocks.recordSessionResult.mockResolvedValue(null)
    const res = await post({ seq: 9, kind: 'result', payload: ENVELOPE })

    expect(res.status).toBe(201)
    expect(mocks.captureMemory).not.toHaveBeenCalled()
  })

  it('does not capture a replayed result event (seq conflict)', async () => {
    mocks.recordSessionEvent.mockResolvedValue(null)
    const res = await post({ seq: 9, kind: 'result', payload: ENVELOPE })

    expect(res.status).toBe(200)
    expect(mocks.recordSessionResult).not.toHaveBeenCalled()
    expect(mocks.captureMemory).not.toHaveBeenCalled()
  })

  it('a capture failure never fails the POST', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.captureMemory.mockRejectedValue(new Error('neon down'))
    const res = await post({ seq: 9, kind: 'result', payload: ENVELOPE })

    expect(res.status).toBe(201)
    expect(res.body.data.resultProcessed).toBe(true)
    expect(mocks.attachSessionMemory).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('[hangar] mission memory capture failed', expect.objectContaining({ sessionId: SESSION_ID }))
    error.mockRestore()
  })

  it('a flight deck count failure still captures the memory', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.countFlightDeckSignals.mockRejectedValue(new Error('timeout'))
    await post({ seq: 9, kind: 'result', payload: ENVELOPE })

    const [, input] = mocks.captureMemory.mock.calls[0]
    expect(input.sourceMetadata.flightDeck).toBeUndefined()
    expect(input.sourceMetadata.session.errorCount).toBeUndefined()
    expect(mocks.attachSessionMemory).toHaveBeenCalledWith(SESSION_ID, 'user-1', MEMORY_ID)
    warn.mockRestore()
  })

  it('duplicate result → dedup path still links the existing memory', async () => {
    mocks.captureMemory.mockResolvedValue({ memory: { id: MEMORY_ID }, created: false })
    await post({ seq: 9, kind: 'result', payload: ENVELOPE })
    await post({ seq: 10, kind: 'result', payload: ENVELOPE })

    expect(mocks.captureMemory).toHaveBeenCalledTimes(2)
    const externalIds = mocks.captureMemory.mock.calls.map(([, input]) => input.sourceMetadata.externalId)
    expect(new Set(externalIds)).toEqual(new Set([`hangar:${SESSION_ID}`]))
    expect(mocks.attachSessionMemory).toHaveBeenCalledTimes(2)
    expect(mocks.attachSessionMemory).toHaveBeenLastCalledWith(SESSION_ID, 'user-1', MEMORY_ID)
  })

  it('skips kairos-chat sessions', async () => {
    mocks.findAgentSessionById.mockResolvedValue(session({ engine: 'kairos-chat' }))
    await post({ seq: 9, kind: 'result', payload: ENVELOPE })

    expect(mocks.captureMemory).not.toHaveBeenCalled()
  })

  it('falls back to the envelope summary line when the card has no name', async () => {
    mocks.findMissionCardContext.mockResolvedValue({ taskId: TASK_ID, name: '', projectId: PROJECT_ID, dominionId: null })
    await post({ seq: 9, kind: 'result', payload: ENVELOPE })

    const [, input] = mocks.captureMemory.mock.calls[0]
    expect(input.title).toBe('Added the mission memory bridge. Tests pass.')
    expect(input.dominionId).toBeUndefined()
  })
})
