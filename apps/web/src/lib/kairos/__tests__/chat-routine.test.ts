import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/thinking-jobs', () => ({
  failJob: vi.fn(),
  findJobById: vi.fn(),
  listJobs: vi.fn(),
}))

import { failJob, findJobById, listJobs } from '@/lib/data/thinking-jobs'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import {
  CHAT_CLAIMED_GRACE_MS,
  CHAT_JOB_DEADLINE_SLACK_MS,
  CHAT_JOB_KIND,
  CHAT_JOB_OWNERSHIP_WINDOW_MS,
  CHAT_SUPERSEDED_PREFIX,
  CHAT_WATCHDOG_PREFIX,
  chatJobOwnsMessage,
  chatRoutineConfig,
  chatRoutinePollMs,
  chatRoutineTimeoutMs,
  chatWatchdogMaxWaitMs,
  fireChatRoutine,
  MAX_CHAT_ROUTINE_TIMEOUT_MS,
  runChatWatchdog,
  telegramRoutineEnabled,
} from '../chat-routine'

const USER = 'user-1'
const JOB_ID = 'job-1'
const T0 = 1_000_000

function row(status: ThinkingJobRow['status'], over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: JOB_ID, userId: USER, kind: CHAT_JOB_KIND, dominionId: null,
    externalKey: 'chat:thread-1:msg-1', status, input: { system: 's', prompt: 'p' }, output: null,
    claimedBy: null, claimToken: null, claimedAt: null, deadlineAt: new Date(T0 + 90_000),
    completedAt: null, attempts: 0, error: null, createdAt: new Date(T0), updatedAt: new Date(T0),
    ...over,
  }
}

// Virtual clock: sleep advances time, so polling is deterministic.
function clock() {
  let t = T0
  return { now: () => t, sleep: async (ms: number) => { t += ms } }
}

const opts = (c: ReturnType<typeof clock>) => ({ timeoutMs: 60_000, pollMs: 3_000, graceMs: 15_000, ...c })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(failJob).mockReset()
  vi.mocked(findJobById).mockReset()
})

afterEach(() => {
  delete process.env.KAIROS_TELEGRAM_ROUTINE
  delete process.env.ROUTINE_CHAT_ID
  delete process.env.ROUTINE_CHAT_TOKEN
  delete process.env.ROUTINE_CHAT_FIRE_URL
  vi.unstubAllGlobals()
})

describe('runChatWatchdog', () => {
  it('takes over a still-queued job at the timeout and runs the fallback once', async () => {
    const c = clock()
    vi.mocked(findJobById).mockResolvedValue(row('queued'))
    vi.mocked(failJob).mockImplementation(async (_u, _id, _t, error) => row('failed', { error }))
    const fallback = vi.fn().mockResolvedValue({ ok: true, memoryIds: [] })

    const out = await runChatWatchdog(USER, JOB_ID, fallback, opts(c))

    expect(out).toEqual({ outcome: 'fallback' })
    expect(c.now() - T0).toBe(60_000)
    expect(failJob).toHaveBeenCalledTimes(1)
    expect(failJob).toHaveBeenCalledWith(USER, JOB_ID, null, expect.stringMatching(new RegExp(`^${CHAT_WATCHDOG_PREFIX}`)))
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('gives a claimed job until its deadline plus grace before taking over', async () => {
    const c = clock()
    vi.mocked(findJobById).mockResolvedValue(row('claimed', { claimToken: 'tok' }))
    vi.mocked(failJob).mockImplementation(async () => row('failed'))
    const fallback = vi.fn().mockResolvedValue({ ok: true, memoryIds: [] })

    await runChatWatchdog(USER, JOB_ID, fallback, opts(c))

    expect(c.now()).toBeGreaterThanOrEqual(T0 + 90_000 + 15_000)
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('stops without a fallback once the routine has answered', async () => {
    const c = clock()
    vi.mocked(findJobById)
      .mockResolvedValueOnce(row('queued'))
      .mockResolvedValueOnce(row('claimed'))
      .mockResolvedValue(row('done'))
    const fallback = vi.fn()

    expect(await runChatWatchdog(USER, JOB_ID, fallback, opts(c))).toEqual({ outcome: 'answered' })
    expect(failJob).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('answers on the paid key right away when the routine answer was rejected', async () => {
    const c = clock()
    vi.mocked(findJobById).mockResolvedValue(row('failed', { error: 'empty_reply; fallback covers this job' }))
    const fallback = vi.fn().mockResolvedValue({ ok: true, memoryIds: [] })

    expect(await runChatWatchdog(USER, JOB_ID, fallback, opts(c))).toEqual({ outcome: 'fallback' })
    expect(c.now()).toBe(T0)
    expect(failJob).not.toHaveBeenCalled()
  })

  it('never answers a superseded job or one another watchdog took over', async () => {
    const fallback = vi.fn()
    vi.mocked(findJobById).mockResolvedValueOnce(row('failed', { error: `${CHAT_SUPERSEDED_PREFIX} newer` }))
    expect(await runChatWatchdog(USER, JOB_ID, fallback, opts(clock()))).toEqual({ outcome: 'superseded' })
    vi.mocked(findJobById).mockResolvedValueOnce(row('failed', { error: `${CHAT_WATCHDOG_PREFIX} x` }))
    expect(await runChatWatchdog(USER, JOB_ID, fallback, opts(clock()))).toEqual({ outcome: 'owned_elsewhere' })
    vi.mocked(findJobById).mockResolvedValueOnce(row('expired'))
    expect(await runChatWatchdog(USER, JOB_ID, fallback, opts(clock()))).toEqual({ outcome: 'swept' })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('reports a throwing fallback instead of crashing the after() task', async () => {
    vi.mocked(findJobById).mockResolvedValue(row('queued'))
    vi.mocked(failJob).mockResolvedValue(row('failed'))
    const fallback = vi.fn().mockRejectedValue(new Error('provider down'))

    expect(await runChatWatchdog(USER, JOB_ID, fallback, opts(clock())))
      .toEqual({ outcome: 'fallback_failed', reason: 'provider down' })
  })
})

describe('chat routine config', () => {
  it('is off unless KAIROS_TELEGRAM_ROUTINE is 1/true', () => {
    expect(telegramRoutineEnabled()).toBe(false)
    process.env.KAIROS_TELEGRAM_ROUTINE = '0'
    expect(telegramRoutineEnabled()).toBe(false)
    process.env.KAIROS_TELEGRAM_ROUTINE = '1'
    expect(telegramRoutineEnabled()).toBe(true)
  })

  it('needs both an id (or fire URL) and a token', () => {
    process.env.ROUTINE_CHAT_ID = 'trig_1'
    expect(chatRoutineConfig()).toBeNull()
    process.env.ROUTINE_CHAT_TOKEN = 'tok'
    expect(chatRoutineConfig()).toEqual({
      fireUrl: 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire',
      token: 'tok',
    })
  })

  it('fireChatRoutine never throws on a network error', async () => {
    process.env.ROUTINE_CHAT_ID = 'trig_1'
    process.env.ROUTINE_CHAT_TOKEN = 'tok'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    expect(await fireChatRoutine()).toEqual({ ok: false, error: 'fire failed: ECONNRESET' })
  })
})

describe('chatJobOwnsMessage', () => {
  it('does no lookup with the flag off', async () => {
    expect(await chatJobOwnsMessage(USER, 'thread-1', 'msg-1')).toBe(false)
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('matches the exact turn key among open jobs', async () => {
    process.env.KAIROS_TELEGRAM_ROUTINE = '1'
    vi.mocked(listJobs).mockImplementation(async (_u, f) => (f?.status === 'claimed'
      ? [row('claimed', { externalKey: 'chat:thread-1:msg-1' })]
      : []))
    expect(await chatJobOwnsMessage(USER, 'thread-1', 'msg-1')).toBe(true)
    expect(await chatJobOwnsMessage(USER, 'thread-1', 'msg-2')).toBe(false)
  })

  it('a job the watchdog took over still owns its turn inside the window (paid fallback in flight)', async () => {
    process.env.KAIROS_TELEGRAM_ROUTINE = '1'
    const now = new Date(T0 + 120_000)
    const taken = row('failed', { externalKey: 'chat:thread-1:msg-1', error: `${CHAT_WATCHDOG_PREFIX} x` })
    vi.mocked(listJobs).mockImplementation(async (_u, f) => {
      if (f?.status) return []
      // The recent-jobs lookup is bounded by the ownership window.
      return f?.since && f.since.getTime() <= taken.createdAt.getTime() ? [taken] : []
    })
    expect(await chatJobOwnsMessage(USER, 'thread-1', 'msg-1', now)).toBe(true)
    expect(vi.mocked(listJobs).mock.calls.some(([, f]) => f?.since?.getTime() === now.getTime() - CHAT_JOB_OWNERSHIP_WINDOW_MS)).toBe(true)
    // Past the window the fallback has certainly ended (webhook maxDuration).
    expect(await chatJobOwnsMessage(USER, 'thread-1', 'msg-1', new Date(T0 + CHAT_JOB_OWNERSHIP_WINDOW_MS + 1))).toBe(false)
  })

  it('a lookup failure never blocks a reply', async () => {
    process.env.KAIROS_TELEGRAM_ROUTINE = '1'
    vi.mocked(listJobs).mockRejectedValue(new Error('db down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await chatJobOwnsMessage(USER, 'thread-1', 'msg-1')).toBe(false)
    consoleError.mockRestore()
  })
})

describe('timeout clamp and watchdog budget', () => {
  afterEach(() => {
    delete process.env.KAIROS_CHAT_ROUTINE_TIMEOUT_MS
    delete process.env.KAIROS_CHAT_ROUTINE_POLL_MS
  })

  it('clamps KAIROS_CHAT_ROUTINE_TIMEOUT_MS to 120 s and the poll to 10 s', () => {
    expect(chatRoutineTimeoutMs()).toBe(60_000)
    process.env.KAIROS_CHAT_ROUTINE_TIMEOUT_MS = '90000'
    expect(chatRoutineTimeoutMs()).toBe(90_000)
    process.env.KAIROS_CHAT_ROUTINE_TIMEOUT_MS = '600000'
    expect(chatRoutineTimeoutMs()).toBe(MAX_CHAT_ROUTINE_TIMEOUT_MS)
    expect(MAX_CHAT_ROUTINE_TIMEOUT_MS).toBe(120_000)
    process.env.KAIROS_CHAT_ROUTINE_POLL_MS = '60000'
    expect(chatRoutinePollMs()).toBe(10_000)
  })

  it('the max wait covers deadline + grace, and fire + wait leaves the paid fallback room in 300 s', () => {
    const wait = chatWatchdogMaxWaitMs(MAX_CHAT_ROUTINE_TIMEOUT_MS, CHAT_CLAIMED_GRACE_MS, 10_000)
    expect(wait).toBeGreaterThanOrEqual(MAX_CHAT_ROUTINE_TIMEOUT_MS + CHAT_JOB_DEADLINE_SLACK_MS + CHAT_CLAIMED_GRACE_MS)
    expect(300_000 - 10_000 - wait).toBeGreaterThanOrEqual(100_000)
  })

  it('a claimed job at the clamp ceiling is never taken over before its deadline + grace', async () => {
    const c = clock()
    const deadline = T0 + MAX_CHAT_ROUTINE_TIMEOUT_MS + CHAT_JOB_DEADLINE_SLACK_MS
    vi.mocked(findJobById).mockResolvedValue(row('claimed', { claimToken: 'tok', deadlineAt: new Date(deadline) }))
    let takenAt = 0
    vi.mocked(failJob).mockImplementation(async () => {
      takenAt = c.now()
      return row('failed')
    })
    const fallback = vi.fn().mockResolvedValue({ ok: true, memoryIds: [] })

    // Even an over-long timeout option is clamped to the ceiling.
    await runChatWatchdog(USER, JOB_ID, fallback, { ...c, timeoutMs: 600_000, pollMs: 3_000, graceMs: CHAT_CLAIMED_GRACE_MS })

    expect(takenAt).toBeGreaterThanOrEqual(deadline + CHAT_CLAIMED_GRACE_MS)
    expect(takenAt - T0).toBeLessThanOrEqual(chatWatchdogMaxWaitMs(MAX_CHAT_ROUTINE_TIMEOUT_MS, CHAT_CLAIMED_GRACE_MS, 3_000))
    expect(fallback).toHaveBeenCalledTimes(1)
  })
})
