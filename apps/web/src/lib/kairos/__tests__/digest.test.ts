import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Evening Digest — gatherDigestCounts / buildDeterministicDigest / runEveningDigestForUser.
// Mirrors the mocking patterns in introspection.test.ts (db chain + mocked data-layer
// modules) and synthesis-health.test.ts (mocked speak/cron-trace collaborators).

const selectQueue: unknown[][] = []
const boundCalls: Array<{ fn: 'gte' | 'lt'; column: unknown; value: unknown }> = []

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  const gteSpy = ((column: unknown, value: unknown) => {
    boundCalls.push({ fn: 'gte', column, value })
    return actual.gte(column as never, value as never)
  }) as typeof actual.gte
  const ltSpy = ((column: unknown, value: unknown) => {
    boundCalls.push({ fn: 'lt', column, value })
    return actual.lt(column as never, value as never)
  }) as typeof actual.lt
  return { ...actual, gte: gteSpy, lt: ltSpy }
})

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
    },
  }
})

vi.mock('@/lib/data/board-signals', () => ({
  countTasksCompletedBetween: vi.fn(),
  countTasksCreatedBetween: vi.fn(),
}))

vi.mock('@/lib/data/ask', () => ({
  listKairosAsksAnsweredBetween: vi.fn(),
}))

vi.mock('@/lib/data/recipes', () => ({
  listTraceHistory: vi.fn(),
}))

// Sidesteps synthesis-health.ts's own heavy dependency chain (memories.ts,
// speak.ts) — digest.ts only needs the constant.
vi.mock('../synthesis-health', () => ({
  SYNTHESIS_HEALTH_RECIPE: 'SYNTHESIS_HEALTH',
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

vi.mock('../speak', () => ({
  deliverKairosSpeak: vi.fn(),
}))

vi.mock('../cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

import { db } from '@/lib/db'
import { countTasksCompletedBetween, countTasksCreatedBetween } from '@/lib/data/board-signals'
import { listKairosAsksAnsweredBetween } from '@/lib/data/ask'
import { listTraceHistory } from '@/lib/data/recipes'
import { getProviderForTask } from '@/lib/ai/route-task'
import { deliverKairosSpeak } from '../speak'
import { writeCronFailureTrace } from '../cron-trace'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import { gatherDigestCounts, buildDeterministicDigest, runEveningDigestForUser, type DigestCounts } from '../digest'

const USER = 'user-1'
const WINDOW = { start: new Date('2026-07-24T00:00:00.000Z'), end: new Date('2026-07-25T00:00:00.000Z') }

function queueCounts(counts: [number, number, number, number]) {
  for (const n of counts) selectQueue.push([{ n }])
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  boundCalls.length = 0
  vi.mocked(countTasksCompletedBetween).mockResolvedValue(0)
  vi.mocked(countTasksCreatedBetween).mockResolvedValue(0)
  vi.mocked(listKairosAsksAnsweredBetween).mockResolvedValue([])
  vi.mocked(listTraceHistory).mockResolvedValue([])
  vi.mocked(deliverKairosSpeak).mockResolvedValue({
    status: 200,
    body: { id: 'x', delivered: { inbox: true, telegram: false } },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('gatherDigestCounts', () => {
  it('returns exact counts from every source', async () => {
    queueCounts([2, 1, 3, 4])
    vi.mocked(listKairosAsksAnsweredBetween).mockResolvedValue([
      { id: 'a', answeredAt: new Date() },
      { id: 'b', answeredAt: new Date() },
    ])
    vi.mocked(countTasksCompletedBetween).mockResolvedValue(5)
    vi.mocked(countTasksCreatedBetween).mockResolvedValue(6)
    vi.mocked(listTraceHistory).mockResolvedValue([{
      id: 'rollup', title: 'Synthesis health', summary: null, dominionId: null,
      createdAt: new Date('2026-07-24T10:00:00.000Z'),
      sourceMetadata: {
        byStage: {
          'stage-a': { '2026-07-24': 'ok' },
          'stage-b': { '2026-07-23': 'failed', '2026-07-24': 'failed' },
        },
      },
    }])

    const counts = await gatherDigestCounts(USER, WINDOW)

    expect(counts).toEqual({
      codingSessions: 2,
      introspectionProposals: 1,
      reflections: 3,
      asksDispatched: 4,
      asksAnswered: 2,
      boardTasksCompleted: 5,
      boardTasksCreated: 6,
      synthesis: { green: 1, failed: 1, failedStages: ['stage-b'] },
    })
  })

  it('reports null synthesis when no rollup has materialised for today yet', async () => {
    queueCounts([0, 0, 0, 0])
    vi.mocked(listTraceHistory).mockResolvedValue([])

    const counts = await gatherDigestCounts(USER, WINDOW)

    expect(counts.synthesis).toBeNull()
  })

  it('reports null synthesis when the only rollup on record is stale (from a prior day)', async () => {
    queueCounts([0, 0, 0, 0])
    vi.mocked(listTraceHistory).mockResolvedValue([{
      id: 'rollup', title: 'Synthesis health', summary: null, dominionId: null,
      createdAt: new Date('2026-07-23T10:00:00.000Z'),
      sourceMetadata: { byStage: { 'stage-a': { '2026-07-23': 'ok' } } },
    }])

    const counts = await gatherDigestCounts(USER, WINDOW)

    expect(counts.synthesis).toBeNull()
  })

  it('reports null synthesis when a fresh rollup has an empty byStage map', async () => {
    queueCounts([0, 0, 0, 0])
    vi.mocked(listTraceHistory).mockResolvedValue([{
      id: 'rollup', title: 'Synthesis health', summary: null, dominionId: null,
      createdAt: new Date('2026-07-24T10:00:00.000Z'),
      sourceMetadata: { byStage: {} },
    }])

    const counts = await gatherDigestCounts(USER, WINDOW)

    expect(counts.synthesis).toBeNull()
  })

  it('scopes every count query to the exact window boundaries passed in', async () => {
    queueCounts([0, 0, 0, 0])

    await gatherDigestCounts(USER, WINDOW)

    const gteValues = boundCalls.filter((c) => c.fn === 'gte').map((c) => c.value)
    const ltValues = boundCalls.filter((c) => c.fn === 'lt').map((c) => c.value)
    expect(gteValues).toHaveLength(4)
    expect(ltValues).toHaveLength(4)
    expect(gteValues.every((v) => v === WINDOW.start)).toBe(true)
    expect(ltValues.every((v) => v === WINDOW.end)).toBe(true)
  })

  it('respects a different window on a subsequent call (no boundary bleed between runs)', async () => {
    queueCounts([0, 0, 0, 0])
    const otherWindow = { start: new Date('2026-01-01T00:00:00.000Z'), end: new Date('2026-01-02T00:00:00.000Z') }

    await gatherDigestCounts(USER, otherWindow)

    const gteValues = boundCalls.filter((c) => c.fn === 'gte').map((c) => c.value)
    expect(gteValues.every((v) => v === otherWindow.start)).toBe(true)
  })
})

describe('buildDeterministicDigest', () => {
  const zeroCounts: DigestCounts = {
    codingSessions: 0, introspectionProposals: 0, reflections: 0,
    asksDispatched: 0, asksAnswered: 0, boardTasksCompleted: 0, boardTasksCreated: 0,
    synthesis: null,
  }

  it('describes a quiet day when every count is zero, with no undefined/NaN', () => {
    const text = buildDeterministicDigest(zeroCounts, '2026-07-24')
    expect(text).toContain('2026-07-24')
    expect(text).toContain('quiet day')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('NaN')
  })

  it('names every nonzero count and pluralises correctly', () => {
    const counts: DigestCounts = {
      codingSessions: 1, introspectionProposals: 2, reflections: 3,
      asksDispatched: 2, asksAnswered: 1, boardTasksCompleted: 1, boardTasksCreated: 4,
      synthesis: { green: 5, failed: 0, failedStages: [] },
    }
    const text = buildDeterministicDigest(counts, '2026-07-24')
    expect(text).toContain('1 coding session')
    expect(text).toContain('2 introspection proposals')
    expect(text).toContain('3 reflections')
    expect(text).toContain('1 board task completed')
    expect(text).toContain('4 board tasks created')
    expect(text).toContain('2 asks')
    expect(text).toContain('1 answered')
    expect(text).toContain('clean across 5 stages')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('NaN')
  })

  it('names failing stages plainly when synthesis is unhealthy', () => {
    const text = buildDeterministicDigest({ ...zeroCounts, synthesis: { green: 2, failed: 1, failedStages: ['cortex-regen'] } }, '2026-07-24')
    expect(text).toContain('cortex-regen')
    expect(text).toContain('not healthy')
  })

  it('reports no signal yet when synthesis is null', () => {
    const text = buildDeterministicDigest(zeroCounts, '2026-07-24')
    expect(text).toContain('No overnight synthesis-health signal')
  })
})

describe('runEveningDigestForUser', () => {
  function queueAlreadyRan(ran: boolean) {
    selectQueue.push([{ n: ran ? 1 : 0 }])
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T18:00:00.000Z'))
  })

  it('sends the model narrative on the success path', async () => {
    queueAlreadyRan(false)
    queueCounts([0, 0, 0, 0])
    vi.mocked(getProviderForTask).mockResolvedValue({
      decision: { providerId: 'byok', modelId: null, tier: 'standard', source: 'default' },
      provider: { ask: vi.fn().mockResolvedValue({ text: 'A quiet, tidy day.', modelId: 'm', finishReason: 'stop' }) },
    } as never)

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('sent')
    expect(deliverKairosSpeak).toHaveBeenCalledWith(USER, expect.objectContaining({
      title: 'Evening digest · 2026-07-24',
      message: 'A quiet, tidy day.',
      kind: 'notify',
      urgency: 'normal',
      force: true,
      digest: true,
    }))
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('sends the deterministic fallback with NO trace on a missing BYOK credential', async () => {
    queueAlreadyRan(false)
    queueCounts([0, 0, 0, 0])
    vi.mocked(getProviderForTask).mockRejectedValue(new AiCredentialMissingError('anthropic'))

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('sent_fallback')
    expect(deliverKairosSpeak).toHaveBeenCalledOnce()
    const sentMessage = vi.mocked(deliverKairosSpeak).mock.calls[0][1].message
    expect(sentMessage).toContain('quiet day')
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('sends the deterministic fallback with NO trace on an undecryptable BYOK credential', async () => {
    queueAlreadyRan(false)
    queueCounts([0, 0, 0, 0])
    vi.mocked(getProviderForTask).mockRejectedValue(new AiCredentialDecryptError('anthropic'))

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('sent_fallback')
    expect(deliverKairosSpeak).toHaveBeenCalledOnce()
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('sends the deterministic fallback AND writes a trace when the provider throws', async () => {
    queueAlreadyRan(false)
    queueCounts([0, 0, 0, 0])
    vi.mocked(getProviderForTask).mockResolvedValue({
      decision: { providerId: 'byok', modelId: null, tier: 'standard', source: 'default' },
      provider: { ask: vi.fn().mockRejectedValue(new Error('provider timeout')) },
    } as never)

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('sent_fallback')
    expect(deliverKairosSpeak).toHaveBeenCalledOnce()
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({
      cronName: 'digest',
      reason: 'model_call_failed',
    }))
  })

  it('sends the deterministic fallback AND writes a trace when the model returns an empty response', async () => {
    queueAlreadyRan(false)
    queueCounts([0, 0, 0, 0])
    vi.mocked(getProviderForTask).mockResolvedValue({
      decision: { providerId: 'byok', modelId: null, tier: 'standard', source: 'default' },
      provider: { ask: vi.fn().mockResolvedValue({ text: '   ' }) },
    } as never)

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('sent_fallback')
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({
      cronName: 'digest',
      reason: 'model_call_failed',
    }))
  })

  it('skips with zero model calls and zero sends when already run today', async () => {
    queueAlreadyRan(true)

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('already ran today')
    expect(getProviderForTask).not.toHaveBeenCalled()
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
  })

  it('still sends a minimal digest and traces gather_failed when gatherDigestCounts throws (F3 — never total silence)', async () => {
    queueAlreadyRan(false)
    vi.mocked(listTraceHistory).mockRejectedValueOnce(new Error('db unavailable'))

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('sent_fallback')
    expect(getProviderForTask).not.toHaveBeenCalled()
    expect(deliverKairosSpeak).toHaveBeenCalledOnce()
    const sentMessage = vi.mocked(deliverKairosSpeak).mock.calls[0][1].message
    expect(sentMessage).toContain('trace log')
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({
      cronName: 'digest',
      reason: 'gather_failed',
    }))
  })

  it('traces an uncaught exception outside gather/send and never sends, as a last resort', async () => {
    vi.mocked(db.select).mockImplementationOnce(() => {
      throw new Error('db unavailable')
    })

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('db unavailable')
    expect(getProviderForTask).not.toHaveBeenCalled()
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({
      cronName: 'digest',
      reason: 'uncaught_exception',
    }))
  })

  it('writes a delivery_blocked trace and reports blocked when deliverKairosSpeak returns non-200 (F1)', async () => {
    queueAlreadyRan(false)
    queueCounts([0, 0, 0, 0])
    vi.mocked(getProviderForTask).mockResolvedValue({
      decision: { providerId: 'byok', modelId: null, tier: 'standard', source: 'default' },
      provider: { ask: vi.fn().mockResolvedValue({ text: 'A quiet, tidy day.', modelId: 'm', finishReason: 'stop' }) },
    } as never)
    vi.mocked(deliverKairosSpeak).mockResolvedValueOnce({
      status: 429,
      body: { error: 'throttled', spokenLast24h: 10 },
    })

    const result = await runEveningDigestForUser(USER)

    expect(result.status).toBe('blocked')
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({
      cronName: 'digest',
      reason: 'delivery_blocked',
    }))
  })

  it('passes a stable per-day externalId to deliverKairosSpeak so concurrent runs dedupe (F2)', async () => {
    queueAlreadyRan(false)
    queueCounts([0, 0, 0, 0])
    vi.mocked(getProviderForTask).mockResolvedValue({
      decision: { providerId: 'byok', modelId: null, tier: 'standard', source: 'default' },
      provider: { ask: vi.fn().mockResolvedValue({ text: 'A quiet, tidy day.', modelId: 'm', finishReason: 'stop' }) },
    } as never)

    await runEveningDigestForUser(USER)

    expect(deliverKairosSpeak).toHaveBeenCalledWith(USER, expect.objectContaining({
      externalId: 'kairos-digest:2026-07-24',
    }))
  })
})
