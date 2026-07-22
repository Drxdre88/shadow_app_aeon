import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/recipes', () => ({
  listTraceHistory: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

vi.mock('../speak', () => ({
  deliverKairosSpeak: vi.fn(),
}))

import { listTraceHistory } from '@/lib/data/recipes'
import { captureMemory } from '@/lib/data/memories'
import { deliverKairosSpeak } from '../speak'
import { computeSynthesisHealth } from '../synthesis-health'

const USER = 'user-1'
const OPERATOR = 'operator-1'
const NOW = new Date('2026-07-22T08:00:00.000Z')

type Row = {
  id: string
  title: string
  summary: string | null
  dominionId: string | null
  sourceMetadata: unknown
  createdAt: Date
}

function failureRow(id: string, cronName: string, at: string): Row {
  return {
    id, title: `${cronName} failed`, summary: null, dominionId: null,
    sourceMetadata: { cronName, reason: 'parse_failed:syntax' },
    createdAt: new Date(at),
  }
}

function successRow(id: string, recipe: string, at: string): Row {
  return {
    id, title: `${recipe} run`, summary: null, dominionId: null,
    sourceMetadata: { recipe, mode: 'flat', durationMs: 1000, primaryMemoryId: `m-${id}` },
    createdAt: new Date(at),
  }
}

function rollupRow(alertedStages: string[]): Row {
  return {
    id: 'prev-rollup', title: 'Synthesis health', summary: null, dominionId: null,
    sourceMetadata: { recipe: 'SYNTHESIS_HEALTH', byStage: {}, alertedStages },
    createdAt: new Date('2026-07-21T08:00:00.000Z'),
  }
}

function mockHistory(previous: Row[], history: Row[]) {
  vi.mocked(listTraceHistory).mockImplementation(async (_userId, opts) => {
    if (opts?.recipe === 'SYNTHESIS_HEALTH') return previous as never
    return history as never
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR
  vi.mocked(captureMemory).mockImplementation(async (_userId, input) => ({
    memory: { id: 'rollup-memory-id', ...input } as never,
    created: true,
  }))
  vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'x', delivered: { inbox: true, telegram: false } } })
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.KAIROS_OPERATOR_USER_ID
})

describe('computeSynthesisHealth — bucketing (T-B2)', () => {
  it('buckets mixed cronName/recipe keys per UTC night, treats absence as no-signal, and flags only 2-consecutive failures', async () => {
    mockHistory([], [
      failureRow('a1', 'cortex-regen', '2026-07-21T03:00:00.000Z'),
      failureRow('a2', 'cortex-regen', '2026-07-22T03:00:00.000Z'),
      failureRow('b1', 'archetype-synthesis', '2026-07-22T02:30:00.000Z'), // only 1 night — not yet 2-strike
      successRow('c1', 'BRIEF', '2026-07-21T07:00:00.000Z'),
      successRow('c2', 'BRIEF', '2026-07-22T07:00:00.000Z'),
      failureRow('d1', 'contradiction-scan', '2026-07-21T05:00:00.000Z'),
      failureRow('d2', 'contradiction-scan', '2026-07-22T05:00:00.000Z'),
      // Outside the 48h window (4 days back) — must not count toward cortex-regen's nights.
      failureRow('stale', 'cortex-regen', '2026-07-18T03:00:00.000Z'),
      // The rollup's own prior output must never become a bucketed "stage".
      successRow('self', 'SYNTHESIS_HEALTH', '2026-07-22T08:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage).toEqual({
      'cortex-regen': { '2026-07-21': 'failed', '2026-07-22': 'failed' },
      'archetype-synthesis': { '2026-07-22': 'failed' },
      'BRIEF': { '2026-07-21': 'ok', '2026-07-22': 'ok' },
      'contradiction-scan': { '2026-07-21': 'failed', '2026-07-22': 'failed' },
    })
    expect(result.alertedStages).toEqual(['contradiction-scan', 'cortex-regen'])
    expect(result.newlyAlertedStages).toEqual(['contradiction-scan', 'cortex-regen'])
  })

  it('excludes rows older than the 48h window entirely', async () => {
    mockHistory([], [
      failureRow('old1', 'cortex-regen', '2026-07-17T03:00:00.000Z'),
      failureRow('old2', 'cortex-regen', '2026-07-18T03:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage).toEqual({})
    expect(result.alertedStages).toEqual([])
  })

  it('writes one rollup memory tagged recipe:SYNTHESIS_HEALTH with an idempotent externalId', async () => {
    mockHistory([], [])

    const result = await computeSynthesisHealth(USER)

    expect(captureMemory).toHaveBeenCalledWith(USER, expect.objectContaining({
      type: 'session_event',
      streamClass: 'trace',
      source: 'system',
      sourceMetadata: expect.objectContaining({
        externalId: 'synthesis-health:2026-07-22',
        recipe: 'SYNTHESIS_HEALTH',
        byStage: {},
        alertedStages: [],
      }),
    }))
    expect(result.date).toBe('2026-07-22')
  })
})

describe('computeSynthesisHealth — 2-strike alert + alertedStages dedupe (T-B3)', () => {
  it('fires exactly one alert the first time a stage crosses 2 consecutive failing nights', async () => {
    mockHistory([], [
      failureRow('a1', 'cortex-regen', '2026-07-21T03:00:00.000Z'),
      failureRow('a2', 'cortex-regen', '2026-07-22T03:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(deliverKairosSpeak).toHaveBeenCalledTimes(1)
    expect(deliverKairosSpeak).toHaveBeenCalledWith(OPERATOR, expect.objectContaining({
      kind: 'notify',
      urgency: 'high',
      force: true,
      opsAlert: true,
    }))
    expect(result.alertedStages).toEqual(['cortex-regen'])
  })

  it('stays silent on a later night while the stage remains in yesterday\'s alertedStages', async () => {
    mockHistory([rollupRow(['cortex-regen'])], [
      failureRow('a1', 'cortex-regen', '2026-07-21T03:00:00.000Z'),
      failureRow('a2', 'cortex-regen', '2026-07-22T03:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(deliverKairosSpeak).not.toHaveBeenCalled()
    expect(result.alertedStages).toEqual(['cortex-regen'])
    expect(result.newlyAlertedStages).toEqual([])
  })

  it('does not flag a lone failure night as a 2-strike (no signal the night before)', async () => {
    mockHistory([], [
      failureRow('a1', 'cortex-regen', '2026-07-22T03:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(deliverKairosSpeak).not.toHaveBeenCalled()
    expect(result.alertedStages).toEqual([])
  })

  it('re-alerts after a stage recovers and then fails 2 consecutive nights again (flap)', async () => {
    mockHistory([rollupRow([])], [
      failureRow('a1', 'cortex-regen', '2026-07-21T03:00:00.000Z'),
      failureRow('a2', 'cortex-regen', '2026-07-22T03:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(deliverKairosSpeak).toHaveBeenCalledTimes(1)
    expect(result.newlyAlertedStages).toEqual(['cortex-regen'])
  })

  it('skips the alert gracefully (but still writes the rollup) when KAIROS_OPERATOR_USER_ID is unset', async () => {
    delete process.env.KAIROS_OPERATOR_USER_ID
    mockHistory([], [
      failureRow('a1', 'cortex-regen', '2026-07-21T03:00:00.000Z'),
      failureRow('a2', 'cortex-regen', '2026-07-22T03:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(deliverKairosSpeak).not.toHaveBeenCalled()
    expect(captureMemory).toHaveBeenCalledOnce()
    expect(result.alertedStages).toEqual(['cortex-regen'])
  })
})
