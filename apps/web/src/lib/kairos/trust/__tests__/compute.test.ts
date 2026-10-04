import { describe, expect, it } from 'vitest'
import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import type { KairosPromise } from '@/lib/data/validators/kairos-promises'
import type { SurpriseEvent } from '@/lib/data/validators/kairos-surprise'
import { metricsFor } from '@/lib/kairos/predictions/score'
import { computeTrust, levelFor, scoreOf, wilsonLowerBound } from '../compute'
import type { TrustGoalLike, TrustInputs } from '../types'

const NOW = new Date('2026-10-05T08:00:00.000Z')
const DOM = 'dom-aeon'
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

let seq = 0
function pred(over: Partial<KairosPrediction> = {}): KairosPrediction {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    claim: 'A prediction claim long enough to be valid.',
    probability: 0.8,
    dueDate: '2026-09-30',
    topic: 'delivery',
    dominionId: DOM,
    basisIds: [],
    check: { kind: 'owner_verdict' },
    source: { kind: 'weekly_review', jobId: 'j' },
    createdAt: daysAgo(20),
    status: 'right',
    settledAt: daysAgo(10),
    ...over,
  }
}

const doubted = (status: 'right' | 'wrong') => pred({
  status,
  check: { kind: 'card_by', projectId: '00000000-0000-4000-8000-000000000001', taskId: '00000000-0000-4000-8000-000000000002', expect: 'not_done' },
})

const goal = (id: string, state: string, over: Partial<TrustGoalLike['meta']> = {}): TrustGoalLike => ({
  id, dominionId: DOM, meta: { state, proposedAt: daysAgo(30), decidedAt: daysAgo(29), closedAt: daysAgo(5), ...over },
})

const promise = (status: KairosPromise['status'], goalId?: string): KairosPromise => ({
  id: '00000000-0000-4000-8000-0000000000aa', seq: 1, outcome: 'ship the thing', dueDate: '2026-09-30', createdAt: daysAgo(20),
  source: goalId ? { kind: 'goal', goalId } : { kind: 'weekly_review' }, check: { kind: 'owner_confirm' }, status,
  closedAt: daysAgo(3), renegotiations: 0, dueHistory: [],
})

const ideaRow = (outcome: 'accepted' | 'dismissed') => ({
  dominionId: DOM, sourceMetadata: { idea: { status: 'survivor', outcome } }, archivedAt: null, createdAt: new Date(daysAgo(4)),
})

const correction = (): SurpriseEvent => ({
  id: 's_0000000a', key: 'k', at: daysAgo(2), kind: 'owner_correction', s: 0.5, dominionId: DOM,
  refs: { beliefIds: [], memoryIds: [] }, opened: [],
})

const inputs = (over: Partial<TrustInputs> = {}): TrustInputs => ({
  predictions: [], goals: [], promises: [], ideaRows: [], surpriseEvents: [],
  dominionNames: new Map([[DOM, 'AEON']]), ...over,
})

const dominionArea = (i: TrustInputs) => computeTrust(i, NOW).areas.find((a) => a.key === DOM)

describe('trust maths', () => {
  it('Beta(2,2) reliability and the Wilson 80% lower bound', () => {
    expect(scoreOf(0, 0)).toEqual({ n: 0, right: 0, reliability: 0.5, lowerBound: 0 })
    expect(scoreOf(5, 5).reliability).toBe(0.778)
    expect(wilsonLowerBound(5, 5)).toBeCloseTo(0.753, 2)
    expect(wilsonLowerBound(5, 10)).toBeLessThan(0.5)
  })

  it('levels: unknown below 5, check / second / lean by the thresholds', () => {
    const none = { n: 0, ownerRight: 0, kairosRight: 0 }
    expect(levelFor(scoreOf(4, 4), 0, none)).toBe('unknown')
    expect(levelFor(scoreOf(9, 10), 0, none)).toBe('lean')
    expect(levelFor(scoreOf(9, 10), 0.16, none)).toBe('check')
    expect(levelFor(scoreOf(6, 10), 0, none)).toBe('second')
    expect(levelFor(scoreOf(2, 10), 0, none)).toBe('check')
    expect(levelFor(scoreOf(9, 10), 0, { n: 3, ownerRight: 2, kairosRight: 1 })).toBe('check')
  })
})

describe('computeTrust', () => {
  it('too little settled → unknown with an honest statement', () => {
    const area = dominionArea(inputs({ predictions: [pred(), pred(), pred({ status: 'wrong' })] }))
    expect(area?.level).toBe('unknown')
    expect(area?.statement).toBe('Too little settled here to say (3 of 5).')
  })

  it('literal "kept a plan I doubted 5 times, owner right 4"', () => {
    const preds = [doubted('wrong'), doubted('wrong'), doubted('wrong'), doubted('wrong'), doubted('right'), pred(), pred()]
    const area = dominionArea(inputs({ predictions: preds }))!
    expect(area.wentAhead).toEqual({ n: 5, ownerRight: 4, kairosRight: 1 })
    expect(area.level).toBe('check')
    expect(area.statement).toContain('5 times you kept a plan I doubted; you were right 4.')
    expect(area.statement.length).toBeLessThanOrEqual(220)
  })

  it('calls match metricsFor; void / unresolved / out-of-window are excluded', () => {
    const scored = [pred(), pred(), pred({ status: 'wrong', probability: 0.6 }), pred(), pred()]
    const noise = [pred({ status: 'void' }), pred({ status: 'unresolved' }), pred({ settledAt: daysAgo(120) })]
    const area = dominionArea(inputs({ predictions: [...scored, ...noise] }))!
    expect(area.calls).toEqual(metricsFor(scored))
    expect(area.scored.n).toBe(5)
  })

  it('goals: landed / missed scored, vetoes counted not scored; goal promises join the goal Dominion', () => {
    const goals = [goal('g1', 'done'), goal('g2', 'failed'), goal('g3', 'abandoned'), goal('g4', 'active', { closedAt: null }), goal('g5', 'vetoed', { closedAt: null })]
    const area = dominionArea(inputs({ goals, promises: [promise('kept', 'g1'), promise('lapsed', 'g2'), promise('kept')] }))!
    expect(area.goals).toEqual({ taken: 4, landed: 1, missed: 2, vetoed: 1 })
    expect(area.promises).toEqual({ kept: 1, missed: 1 })
    expect(area.scored).toMatchObject({ n: 5, right: 2 })
  })

  it('topic areas carry predictions only; areas of unknown Dominions are left out', () => {
    const view = computeTrust(inputs({ predictions: [pred({ topic: 'risk', dominionId: 'gone' })] }), NOW)
    expect(view.areas.map((a) => a.key)).toEqual(['topic:risk'])
    expect(view.areas[0].label).toBe('risk')
  })

  it('ideas and corrections are display only: level and statement unchanged', () => {
    const base = inputs({ predictions: [pred(), pred(), pred(), pred(), pred({ status: 'wrong' }), pred()] })
    const withTaste = { ...base, ideaRows: [ideaRow('accepted'), ideaRow('dismissed'), ideaRow('dismissed')], surpriseEvents: [correction(), correction()] }
    const a = dominionArea(base)!
    const b = dominionArea(withTaste)!
    expect(b.ideas).toEqual({ accepted: 1, dismissed: 2 })
    expect(b.corrections7d).toBe(2)
    expect(b.level).toBe(a.level)
    expect(b.statement).toBe(a.statement)
    expect(b.scored).toEqual(a.scored)
    expect(b.statement).not.toMatch(/idea|correct/i)
  })

  it('is deterministic: most-settled first, Dominions before topics', () => {
    const names = new Map([[DOM, 'AEON'], ['dom-b', 'Body']])
    const preds = [pred(), pred({ dominionId: 'dom-b' }), pred({ dominionId: 'dom-b', topic: 'people' })]
    const one = computeTrust(inputs({ predictions: preds, dominionNames: names }), NOW)
    const two = computeTrust(inputs({ predictions: [...preds].reverse(), dominionNames: names }), NOW)
    expect(one).toEqual(two)
    expect(one.areas.map((a) => a.key)).toEqual(['dom-b', DOM, 'topic:delivery', 'topic:people'])
  })
})
