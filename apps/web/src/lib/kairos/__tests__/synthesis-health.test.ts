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

function outcomeRow(id: string, cronName: string, at: string, outcome: 'ok' | 'skipped' = 'ok'): Row {
  return {
    id, title: `${cronName} ${outcome}`, summary: null, dominionId: null,
    sourceMetadata: { cronName, outcome, externalId: `cron-${outcome}:${cronName}:all:${at.slice(0, 10)}` },
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
      // Dispatcher's recipe:'BRIEF' run traces resolve to the briefer cron's stage.
      'briefer': { '2026-07-21': 'ok', '2026-07-22': 'ok' },
      'contradiction-scan': { '2026-07-21': 'failed', '2026-07-22': 'failed' },
    })
    expect(result.alertedStages).toEqual(['contradiction-scan', 'cortex-regen'])
    expect(result.newlyAlertedStages).toEqual(['contradiction-scan', 'cortex-regen'])
  })

  it('turns a stage ok from a success (outcome) row, including an expected skip', async () => {
    mockHistory([], [
      outcomeRow('s1', 'cortex-regen', '2026-07-21T03:00:00.000Z'),
      outcomeRow('s2', 'micro-consolidate', '2026-07-22T06:15:00.000Z', 'skipped'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage).toEqual({
      'cortex-regen': { '2026-07-21': 'ok' },
      'micro-consolidate': { '2026-07-22': 'ok' },
    })
  })

  it('a failure row beats an ok row for the same stage-night, regardless of order', async () => {
    mockHistory([], [
      outcomeRow('s1', 'cortex-regen', '2026-07-22T03:10:00.000Z'),
      failureRow('f1', 'cortex-regen', '2026-07-22T03:00:00.000Z'),
      failureRow('f2', 'aether-regen', '2026-07-22T04:00:00.000Z'),
      outcomeRow('s2', 'aether-regen', '2026-07-22T04:10:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage).toEqual({
      'cortex-regen': { '2026-07-22': 'failed' },
      'aether-regen': { '2026-07-22': 'failed' },
    })
  })

  it('collapses the three BRIEF keys (recipe BRIEF, cronName recipe:BRIEF, cronName briefer) into one stage', async () => {
    mockHistory([], [
      // Night 1: dispatcher success trace + briefer route liveness → ok.
      successRow('b1', 'BRIEF', '2026-07-21T07:00:00.000Z'),
      outcomeRow('b2', 'briefer', '2026-07-21T07:01:00.000Z'),
      // Night 2: dispatcher recipe failure + route failure → failed.
      failureRow('b3', 'recipe:BRIEF', '2026-07-22T07:00:00.000Z'),
      failureRow('b4', 'briefer', '2026-07-22T07:01:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage).toEqual({
      briefer: { '2026-07-21': 'ok', '2026-07-22': 'failed' },
    })
  })

  it('alerts a 2-strike across mixed BRIEF keys (recipe failure one night, route failure the next)', async () => {
    mockHistory([], [
      failureRow('b1', 'recipe:BRIEF', '2026-07-21T07:00:00.000Z'),
      failureRow('b2', 'briefer', '2026-07-22T07:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.alertedStages).toEqual(['briefer'])
  })

  it('ignores cronName rows that are neither a failure nor an ok/skipped outcome (no signal)', async () => {
    mockHistory([], [{
      id: 'x', title: 'odd', summary: null, dominionId: null,
      sourceMetadata: { cronName: 'cortex-regen' },
      createdAt: new Date('2026-07-22T03:00:00.000Z'),
    }])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage).toEqual({})
  })

  it('reads history with a 48h since-window and a generous cap (not the 100-row default clamp)', async () => {
    mockHistory([], [])

    await computeSynthesisHealth(USER)

    expect(listTraceHistory).toHaveBeenCalledWith(USER, {
      since: new Date('2026-07-20T08:00:00.000Z'),
      limit: 2000,
    })
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

describe('computeSynthesisHealth — expected nightly stage: idea-tournament (P3)', () => {
  const ARMED = { since: '2026-07-15', lastSeen: '2026-07-20' }

  function rollupWithExpected(expectedStages: Record<string, unknown>, alertedStages: string[] = []): Row {
    return { ...rollupRow(alertedStages), sourceMetadata: { recipe: 'SYNTHESIS_HEALTH', byStage: {}, alertedStages, expectedStages } }
  }

  it('is never flagged missing before the stage has been seen (pre-deploy, users without the feature)', async () => {
    mockHistory([], [outcomeRow('s1', 'cortex-regen', '2026-07-22T03:00:00.000Z')])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage['idea-tournament']).toBeUndefined()
    expect(result.missingStages).toEqual({})
    expect(captureMemory).toHaveBeenCalledWith(USER, expect.objectContaining({
      sourceMetadata: expect.objectContaining({ expectedStages: {} }),
    }))
  })

  it('counts a 0-survivor night as ok (the tournament writes a success trace) and arms the stage', async () => {
    mockHistory([], [{
      id: 't1', title: 'idea-tournament ok', summary: null, dominionId: null,
      sourceMetadata: { cronName: 'idea-tournament', outcome: 'ok', survivors: 0, candidates: 9, externalId: 'cron-ok:idea-tournament:all:2026-07-22' },
      createdAt: new Date('2026-07-22T05:10:00.000Z'),
    }])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage['idea-tournament']).toEqual({ '2026-07-22': 'ok' })
    // Armed today → yesterday predates arming and is not judged.
    expect(result.missingStages).toEqual({})
    expect(captureMemory).toHaveBeenCalledWith(USER, expect.objectContaining({
      sourceMetadata: expect.objectContaining({
        expectedStages: { 'idea-tournament': { since: '2026-07-22', lastSeen: '2026-07-22' } },
      }),
    }))
  })

  it('shows a failed tournament night as failed', async () => {
    mockHistory([rollupWithExpected({ 'idea-tournament': ARMED })], [
      outcomeRow('t1', 'idea-tournament', '2026-07-21T05:00:00.000Z'),
      failureRow('t2', 'idea-tournament', '2026-07-22T05:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage['idea-tournament']).toEqual({ '2026-07-21': 'ok', '2026-07-22': 'failed' })
    expect(result.missingStages).toEqual({})
  })

  it('marks an armed stage with no trace on a judged night as failed + missing', async () => {
    mockHistory([rollupWithExpected({ 'idea-tournament': ARMED })], [
      outcomeRow('t1', 'idea-tournament', '2026-07-21T05:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage['idea-tournament']).toEqual({ '2026-07-21': 'ok', '2026-07-22': 'failed' })
    expect(result.missingStages).toEqual({ 'idea-tournament': ['2026-07-22'] })
    expect(result.alertedStages).toEqual([])
    expect(captureMemory).toHaveBeenCalledWith(USER, expect.objectContaining({
      sourceMetadata: expect.objectContaining({
        expectedStages: { 'idea-tournament': { since: '2026-07-15', lastSeen: '2026-07-21' } },
      }),
    }))
  })

  it('fires the 2-strike alert when the tournament is missing two nights running', async () => {
    mockHistory([rollupWithExpected({ 'idea-tournament': ARMED })], [])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage['idea-tournament']).toEqual({ '2026-07-21': 'failed', '2026-07-22': 'failed' })
    expect(result.missingStages).toEqual({ 'idea-tournament': ['2026-07-21', '2026-07-22'] })
    expect(result.alertedStages).toEqual(['idea-tournament'])
    expect(deliverKairosSpeak).toHaveBeenCalledTimes(1)
  })

  it('does not judge today before the 08:00Z slot (early manual run)', async () => {
    vi.setSystemTime(new Date('2026-07-22T04:00:00.000Z'))
    mockHistory([rollupWithExpected({ 'idea-tournament': ARMED })], [
      outcomeRow('t1', 'idea-tournament', '2026-07-21T05:00:00.000Z'),
    ])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage['idea-tournament']).toEqual({ '2026-07-21': 'ok' })
    expect(result.missingStages).toEqual({})
  })

  it('disarms a stage not seen for more than 14 days', async () => {
    mockHistory([rollupWithExpected({ 'idea-tournament': { since: '2026-06-01', lastSeen: '2026-07-01' } })], [])

    const result = await computeSynthesisHealth(USER)

    expect(result.byStage['idea-tournament']).toBeUndefined()
    expect(result.missingStages).toEqual({})
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
  })

  it('ignores a malformed carried expectedStages entry', async () => {
    mockHistory([rollupWithExpected({ 'idea-tournament': { since: 'yesterday', lastSeen: 42 } })], [])

    const result = await computeSynthesisHealth(USER)

    expect(result.missingStages).toEqual({})
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
