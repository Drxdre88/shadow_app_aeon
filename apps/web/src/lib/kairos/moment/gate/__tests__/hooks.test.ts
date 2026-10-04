import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Gate event hooks + promise nudge. Flag unset: auto-capture, the memories
// route and the nudge behave exactly as before (no after(), no release).

const h = vi.hoisted(() => ({
  after: vi.fn(),
  releaseHeldSpeaks: vi.fn(),
  captureMemory: vi.fn(),
  createMemory: vi.fn(),
  recordTodayAfter: vi.fn(),
  deliverKairosSpeak: vi.fn(),
  promises: null as unknown as { open: Array<Record<string, unknown>> },
}))
vi.mock('next/server', () => ({ after: h.after }))
vi.mock('@/lib/kairos/moment/gate/release', () => ({ releaseHeldSpeaks: h.releaseHeldSpeaks }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: h.captureMemory, createMemory: h.createMemory, listMemories: vi.fn(), getGraphForUser: vi.fn() }))
vi.mock('@/lib/data/tasks', () => ({ findTaskById: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findProjectFeedInfo: vi.fn(async () => null) }))
vi.mock('@/lib/data/board-feed', () => ({ listChecklistForTasks: vi.fn(async () => []), listBoardColumnsForFeed: vi.fn(async () => []) }))
vi.mock('@/lib/kairos/today', () => ({ recordTodayAfter: h.recordTodayAfter }))
vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: vi.fn(async () => ({ id: 'op' })),
  isApiUser: () => true,
  apiHandler: (fn: unknown) => fn,
  jsonData: (data: unknown, status = 200) => ({ data, status }),
  jsonError: (error: string, status: number) => ({ error, status }),
}))
vi.mock('@/lib/api/rateLimit', () => ({ withRateLimit: (fn: unknown) => fn, API_READ_LIMIT: 1, API_WRITE_LIMIT: 1 }))
vi.mock('@/lib/kairos/speak', () => ({ deliverKairosSpeak: h.deliverKairosSpeak }))
vi.mock('@/lib/kairos/initiative', () => ({ initiativeEnabled: () => true }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronFailureTrace: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({
  mutateKairosPromises: vi.fn(async (_u: string, fn: (s: unknown) => { state: unknown; result: unknown }) => {
    const { state, result } = fn(h.promises)
    if (state) h.promises = state as typeof h.promises
    return result
  }),
}))

import { captureBoardEvent } from '@/lib/kairos/auto-capture'
import { POST } from '@/app/api/v1/memories/route'
import { runPromiseNudges } from '@/lib/kairos/promises/nudge'

const BOARD = { userId: 'op', projectId: 'p', taskId: 't', taskName: 'Ship' }
const SESSION_BODY = { title: 'Session', bodyMd: 'did things', type: 'session_summary', source: 'claude' }
const postSession = () => POST({ json: async () => SESSION_BODY, headers: { get: () => null }, nextUrl: new URL('https://x.test') } as never, undefined as never)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_OPERATOR_USER_ID = 'op'
  h.releaseHeldSpeaks.mockResolvedValue(null)
  h.captureMemory.mockResolvedValue({ memory: { id: 'mem' }, created: true })
  h.createMemory.mockResolvedValue({ id: 'mem-1' })
})

afterEach(() => {
  delete process.env.KAIROS_GATE
  delete process.env.KAIROS_OPERATOR_USER_ID
})

describe('card close (auto-capture)', () => {
  it('flag unset: capture unchanged, no break noted', async () => {
    await captureBoardEvent({ ...BOARD, action: 'completed' })
    expect(h.captureMemory).toHaveBeenCalledOnce()
    expect(h.captureMemory.mock.calls[0][1]).toMatchObject({ title: 'completed · Ship', type: 'achievement' })
    expect(h.after).not.toHaveBeenCalled()
  })

  it('flag on: a web close notes a break; other actions do not', async () => {
    process.env.KAIROS_GATE = '1'
    await captureBoardEvent({ ...BOARD, action: 'updated' })
    expect(h.after).not.toHaveBeenCalled()
    await captureBoardEvent({ ...BOARD, action: 'completed' })
    expect(h.after).toHaveBeenCalledOnce()
    await h.after.mock.calls[0][0]()
    expect(h.releaseHeldSpeaks).toHaveBeenCalledWith('op', expect.any(Date), 'card_closed')
  })
})

describe('session ended (POST /api/v1/memories)', () => {
  it('flag unset: same 201 and today entry, no break noted', async () => {
    const res = await postSession()
    expect(res).toEqual({ data: { id: 'mem-1' }, status: 201 })
    expect(h.recordTodayAfter).toHaveBeenCalledOnce()
    expect(h.after).not.toHaveBeenCalled()
  })

  it('flag on: a session summary notes session_ended', async () => {
    process.env.KAIROS_GATE = '1'
    await postSession()
    expect(h.after).toHaveBeenCalledOnce()
    await h.after.mock.calls[0][0]()
    expect(h.releaseHeldSpeaks).toHaveBeenCalledWith('op', expect.any(Date), 'session_ended')
  })
})

describe('promise nudge (opts.gate)', () => {
  const NOON = new Date('2026-10-01T11:00:00.000Z')
  const seed = () => {
    h.promises = { open: [{ id: 'p1', seq: 1, outcome: 'Ship', dueDate: '2026-09-20', status: 'open' }] }
  }

  it('passes gate:true; a normal delivery is unchanged', async () => {
    seed()
    h.deliverKairosSpeak.mockResolvedValue({ status: 200, body: { id: 's1', delivered: { inbox: true, telegram: true } } })
    expect(await runPromiseNudges('op', NOON)).toEqual({ status: 'sent', promiseIds: ['p1'] })
    expect(h.deliverKairosSpeak.mock.calls[0][2]).toEqual({ gate: true })
    expect(h.promises.open[0]!.nudge).toEqual({ claimedAt: NOON.toISOString(), delivered: true, memoryId: 's1' })
  })

  it('a held nudge is recorded (not blocked) and released later', async () => {
    seed()
    h.deliverKairosSpeak.mockResolvedValue({ status: 200, body: { id: 's1', delivered: { inbox: false, telegram: false }, held: { until: 'x' } } })
    expect(await runPromiseNudges('op', NOON)).toEqual({ status: 'held', promiseIds: ['p1'] })
    expect(h.promises.open[0]!.nudge).toEqual({ claimedAt: NOON.toISOString(), delivered: false, memoryId: 's1' })
  })
})
