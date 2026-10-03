import { afterEach, describe, expect, it } from 'vitest'
import type { ApplyOutcome } from '@/lib/kairos/engine/types'
import {
  STAGE_BASE,
  aetherThoughts,
  agendaDueThoughts,
  askMineThoughts,
  beliefExtractThoughts,
  cortexThoughts,
  driftProbeThoughts,
  goalProposeThoughts,
  ideaJudgeThoughts,
  mindCompareThoughts,
  pulseThoughts,
  reflectThoughts,
  weeklyReviewThoughts,
  withThoughts,
} from '../stage-thoughts'

const one = (text: string, over: Record<string, unknown> = {}) => ({ ...STAGE_BASE, text, ...over })

afterEach(() => {
  delete process.env.KAIROS_STAGE
})

describe('withThoughts — the KAIROS_STAGE gate', () => {
  const ok: ApplyOutcome = { ok: true, memoryIds: ['m1'], output: { a: 1 } }
  const t = [one('x')]

  it.each([[undefined], ['0'], ['nonsense']])('KAIROS_STAGE=%s → outcome untouched (byte-identical)', (flag) => {
    if (flag !== undefined) process.env.KAIROS_STAGE = flag
    expect(withThoughts(ok, t)).toBe(ok)
  })

  it.each([['observe'], ['1']])('KAIROS_STAGE=%s → thoughts attached to the ok branch', (flag) => {
    process.env.KAIROS_STAGE = flag
    expect(withThoughts(ok, t)).toEqual({ ...ok, thoughts: t })
  })

  it('never attaches to a failure or an empty list', () => {
    process.env.KAIROS_STAGE = '1'
    const fail: ApplyOutcome = { ok: false, reason: 'nope' }
    expect(withThoughts(fail, t)).toBe(fail)
    expect(withThoughts(ok, [])).toBe(ok)
  })
})

describe('per-handler derivers', () => {
  const stageItem = { text: 'Board went quiet', importance: 0.4, surprise: 0.8, goalRelevance: 0, need: 0 }

  it.each([
    ['pulse passes ≤2 model stage items through', pulseThoughts([stageItem, stageItem, stageItem]), [stageItem, stageItem]],
    ['pulse with no stage field posts nothing', pulseThoughts([]), []],
    ['reflect with goal notes → goalRelevance .8, cites evidence',
      reflectThoughts({ thought: 'Review is the bottleneck', goalNotes: [{}], evidenceIds: ['e1'] }),
      [one('Review is the bottleneck', { goalRelevance: 0.8, cites: ['e1'] })]],
    ['reflect without goal notes → goalRelevance .3, plus its stage items',
      reflectThoughts({ thought: 'Quiet morning', goalNotes: [], evidenceIds: [], stage: [stageItem] }),
      [one('Quiet morning', { goalRelevance: 0.3 }), stageItem]],
    ['reflect with no thought posts only stage items', reflectThoughts({ thought: null, goalNotes: [], evidenceIds: [] }), []],
    ['agenda_due note about a goal → need .7, goalRelevance .8',
      agendaDueThoughts({ result: 'thought', text: 'Thursday runs still red' }, 'g1'),
      [one('Thursday runs still red', { need: 0.7, goalRelevance: 0.8 })]],
    ['agenda_due ask without a goal → need .7, base goalRelevance',
      agendaDueThoughts({ result: 'ask', text: 'Did the fix hold?' }, null),
      [one('Did the fix hold?', { need: 0.7 })]],
    ['agenda_due nothing posts nothing', agendaDueThoughts({ result: 'nothing', text: '' }, null), []],
    ['goal_propose → goalRelevance 1', goalProposeThoughts('Why do pricing cards stall?'), [one('Why do pricing cards stall?', { goalRelevance: 1 })]],
    ['ask_mine → need .6', askMineThoughts('What made you drop Hydra?'), [one('What made you drop Hydra?', { need: 0.6 })]],
    ['ask_mine with no question posts nothing', askMineThoughts(null), []],
    ['weekly_review → the summary at base', weeklyReviewThoughts('A week of shipping'), [one('A week of shipping')]],
    ['weekly_review with an empty summary posts nothing', weeklyReviewThoughts('  '), []],
  ])('%s', (_label, got, want) => {
    expect(got).toEqual(want)
  })

  it('aether: the most salient thought; tension/eureka surprise .7, importance = salience', () => {
    const t = (title: string, salience: number, kind: string) => ({ title, insight: `${title} insight`, salience, kind, sourceMemoryIds: [`s-${title}`] })
    expect(aetherThoughts({ thoughts: [t('low', 0.3, 'conclusion'), t('top', 0.9, 'tension')] }))
      .toEqual([one('top: top insight', { importance: 0.9, surprise: 0.7, cites: ['s-top'] })])
    expect(aetherThoughts({ thoughts: [t('plain', 0.6, 'conclusion')] }))
      .toEqual([one('plain: plain insight', { importance: 0.6, cites: ['s-plain'] })])
    expect(aetherThoughts({ thoughts: [] })).toEqual([])
  })

  it('cortex: first drift signal, else first recent shift; surprise .6 importance .5', () => {
    expect(cortexThoughts('Swarm', { driftSignals: ['Tests skipped twice'], recentShifts: ['New lane'] }))
      .toEqual([one('Swarm: Tests skipped twice', { surprise: 0.6, importance: 0.5 })])
    expect(cortexThoughts('Swarm', { driftSignals: [], recentShifts: ['New lane'] }))
      .toEqual([one('Swarm: New lane', { surprise: 0.6, importance: 0.5 })])
    expect(cortexThoughts('Swarm', { driftSignals: [], recentShifts: [] })).toEqual([])
  })

  it('belief_extract: new/replace/retire post; reinforce posts nothing', () => {
    const claim = (c: string, relation: 'new' | 'reinforces' | 'replaces', targetId: string | null = null) => ({ claim: c, relation, targetId, provenance: ['p1'] })
    expect(beliefExtractThoughts({
      claims: [claim('Tests first', 'new'), claim('Same as before', 'reinforces', 'b1'), claim('Ship weekly', 'replaces', 'b2')],
      retire: [{ reason: 'No longer evidenced' }],
    })).toEqual([
      one('Now believe: Tests first', { cites: ['p1'] }),
      one('Now believe: Ship weekly', { surprise: 0.6, cites: ['p1'] }),
      one('Retired a belief: No longer evidenced', { surprise: 0.6 }),
    ])
    expect(beliefExtractThoughts({ claims: [claim('Same', 'reinforces', 'b1')], retire: [] })).toEqual([])
  })

  it('idea_judge: the top survivor, importance from its Elo rank among contenders', () => {
    expect(ideaJudgeThoughts([{ title: 'B', elo: 1010 }, { title: 'A', elo: 1040 }], [1040, 1010, 990, 960]))
      .toEqual([one('A', { importance: 1 })])
    const [mid] = ideaJudgeThoughts([{ title: 'C', elo: 1000 }], [1040, 1000, 960])
    expect(mid.importance).toBeCloseTo(0.7)
    expect(ideaJudgeThoughts([], [1000])).toEqual([])
    expect(ideaJudgeThoughts([{ title: 'Unrated', elo: null }], [1000, 990])).toEqual([one('Unrated', { importance: 0.4 })])
  })

  it('mind_compare: only when minds diverge; surprise ∝ diverging share', () => {
    expect(mindCompareThoughts([{ verdict: 'agree' }, { verdict: 'agree' }])).toEqual([])
    expect(mindCompareThoughts([{ verdict: 'agree' }, { verdict: 'diverge' }, { verdict: 'tension' }, { verdict: 'agree' }]))
      .toEqual([one('2 belief pairs diverge between your mind and mine', { surprise: 0.5 })])
    expect(mindCompareThoughts([{ verdict: 'diverge' }])[0].surprise).toBe(1)
  })

  it('drift_probe: only a flagged drift, importance .9; conscience results never post', () => {
    expect(driftProbeThoughts({ alert: false })).toEqual([])
    expect(driftProbeThoughts({ alert: true, flipped: 2 }))
      .toEqual([one('My answers drifted from the constitution baseline (2 flipped)', { importance: 0.9 })])
    // @ts-expect-error — the conscience input no longer exists
    expect(driftProbeThoughts({ conscienceFailure: 'sycophancy pair 3' })).toEqual([])
  })
})
