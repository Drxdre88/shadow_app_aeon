import { describe, expect, it } from 'vitest'
import { steppingStoneReason, toSteppingStone, type IdeaRowLike } from '../stones'
import { TASTE_MIN_DECISIONS, computeIdeaTaste, featuresOf, tasteFit } from '../taste'

const NOW = new Date('2026-10-04T03:00:00Z')
const DAY = 86_400_000

interface RowOpts {
  dominionId?: string | null
  outcome?: 'accepted' | 'dismissed' | null
  outcomeBy?: 'operator' | 'agent'
  status?: string
  archived?: boolean
  ageDays?: number
  move?: string
  claim?: string
  ideaStatus?: string
  eliminatedReason?: string | null
}

function row(o: RowOpts = {}): IdeaRowLike {
  const createdAt = new Date(NOW.getTime() - (o.ageDays ?? 1) * DAY)
  return {
    title: 'Idea',
    dominionId: o.dominionId === undefined ? 'dom-a' : o.dominionId,
    archivedAt: o.archived ? createdAt : null,
    createdAt,
    sourceMetadata: {
      status: o.status ?? 'pending',
      idea: {
        status: o.ideaStatus ?? 'survivor',
        eliminatedReason: o.eliminatedReason ?? null,
        claim: o.claim ?? 'A short claim.',
        outcome: o.outcome ?? null,
        ...(o.outcomeBy ? { outcomeBy: o.outcomeBy } : {}),
        ...(o.move ? { move: o.move } : {}),
        novelty: { class: 'novel', maxCosine: 0.3, nearestId: null, nearestKind: null },
      },
    },
  }
}

const names = new Map([['dom-a', 'Aeon'], ['dom-b', 'Ops']])
const times = (n: number, o: RowOpts) => Array.from({ length: n }, () => row(o))

describe('computeIdeaTaste', () => {
  it('stays inactive on a cold start', () => {
    const p = computeIdeaTaste(times(TASTE_MIN_DECISIONS - 1, { outcome: 'accepted' }), NOW, names)
    expect(p.active).toBe(false)
    expect(p.summary).toEqual([`Not enough of your own decisions yet (5 of ${TASTE_MIN_DECISIONS}).`])
  })

  it('learns lift with shrinkage toward the base rate, clamped to [0.5, 2]', () => {
    const rows = [...times(4, { dominionId: 'dom-a', outcome: 'accepted' }), ...times(4, { dominionId: 'dom-b', outcome: 'dismissed' })]
    const p = computeIdeaTaste(rows, NOW, names)
    expect(p.active).toBe(true)
    expect(p.totals).toMatchObject({ accepted: 4, dismissed: 4, baseRate: 0.5 })
    const area = Object.fromEntries(p.features.area.map((c) => [c.label, c]))
    expect(area.Aeon.lift).toBeCloseTo((4 * 0.5 ** (1 / 30) + 1.5) / (4 * 0.5 ** (1 / 30) + 3) / 0.5, 3)
    expect(area.Ops.lift).toBe(0.5)
    expect(area.Aeon.confident).toBe(true)
    expect(p.summary).toContain('You tend to accept ideas about Aeon.')
    expect(p.summary).toContain('You tend to pass on ideas about Ops.')
  })

  it('decays by a 30-day half-life and drops rows outside the window', () => {
    const p = computeIdeaTaste([row({ outcome: 'accepted', ageDays: 60 }), row({ outcome: 'accepted', ageDays: 120 })], NOW, names)
    expect(p.totals.accepted).toBe(1)
    expect(p.features.area[0].weight).toBe(0.25)
  })

  it('derives ignored rows and leaves promoted or fresh pending rows neutral', () => {
    const p = computeIdeaTaste([
      row({ status: 'decayed', archived: true }),
      row({ status: 'pending', ageDays: 10 }),
      row({ status: 'pending', ageDays: 2 }),
      row({ status: 'promoted' }),
      row({ status: 'pending', archived: true }),
    ], NOW, names)
    expect(p.totals).toMatchObject({ accepted: 0, dismissed: 1, ignored: 2 })
  })

  it('excludes agent-made accepts but counts legacy accepts as the owner\'s', () => {
    const p = computeIdeaTaste([
      ...times(3, { outcome: 'accepted', outcomeBy: 'agent' }),
      row({ outcome: 'accepted' }),
      row({ outcome: 'accepted', outcomeBy: 'operator' }),
      row({ status: 'accepted' }),
    ], NOW, names)
    expect(p.totals.accepted).toBe(3)
  })

  it('labels retired and cross-cutting areas without leaking ids', () => {
    const p = computeIdeaTaste([row({ dominionId: 'dom-gone', outcome: 'accepted' }), row({ dominionId: null, outcome: 'dismissed' })], NOW, names)
    expect(p.features.area.map((c) => c.label).sort()).toEqual(['a retired area', 'cross-cutting'])
  })
})

describe('tasteFit', () => {
  const rows = [
    ...times(4, { dominionId: 'dom-a', move: 'test', outcome: 'accepted' }),
    ...times(4, { dominionId: 'dom-b', move: 'stop', outcome: 'dismissed' }),
  ]
  const p = computeIdeaTaste(rows, NOW, names)

  it('is null for an unseen idea and leans by mean log2 lift otherwise', () => {
    expect(tasteFit({ area: 'dom-z', move: 'combine' }, p)).toBeNull()
    expect(tasteFit({ area: 'dom-b', move: 'stop' }, p)).toBe(-1)
    expect(tasteFit({ area: 'dom-a', move: 'test' }, p)!).toBeGreaterThan(0.5)
  })

  it('featuresOf maps leap from the novelty cosine when no leap is declared', () => {
    expect(featuresOf({ dominionId: null, claim: 'x'.repeat(150), maxCosine: 0.7 })).toEqual({ area: 'cross-cutting', length: 'medium', leap: 'near' })
    expect(featuresOf({ dominionId: 'd', claim: 'x', move: 'bogus', kind: 'make', leap: 'far', maxCosine: 0.7 })).toEqual({ area: 'd', length: 'short', kind: 'make', leap: 'far' })
  })
})

describe('stepping stones', () => {
  it('collects dismissed, ignored and eliminated ideas, not accepted, repeats or unjudged', () => {
    const reason = (o: RowOpts) => steppingStoneReason(row(o), NOW)
    expect(reason({ outcome: 'dismissed', archived: true })).toBe('owner_dismissed')
    expect(reason({ status: 'pending', archived: true })).toBe('owner_dismissed')
    expect(reason({ status: 'decayed', archived: true })).toBe('ignored')
    expect(reason({ ideaStatus: 'eliminated', eliminatedReason: 'ranked_out', archived: true })).toBe('ranked_out')
    expect(reason({ ideaStatus: 'eliminated', eliminatedReason: 'judge_failed', archived: true })).toBeNull()
    expect(reason({ ideaStatus: 'repeat', eliminatedReason: 'repeat', archived: true })).toBeNull()
    expect(reason({ outcome: 'accepted' })).toBeNull()
    expect(toSteppingStone(row({ outcome: 'dismissed', archived: true }), NOW)).toEqual({ title: 'Idea', claim: 'A short claim.', reason: 'owner_dismissed' })
  })
})
