import { describe, expect, it } from 'vitest'
import { emptySurpriseLedger } from '../ledger'
import {
  REPLAY_TOP,
  agendaNeed,
  applyBeliefHop,
  applyReplayNight,
  collectReplayNeeds,
  inhibitedIds,
  predictionNeed,
  replayGain,
  replayNote,
  scoreReplay,
  topReplay,
  topReplayForDominion,
  type ReplayRow,
  type ReplaySources,
} from '../replay'

const NOW = new Date('2026-10-03T03:00:00.000Z')
const hoursFrom = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()
const none: ReplaySources = { agenda: [], predictions: [], goals: [], promises: [] }

const belief = (over: Record<string, unknown> = {}) => ({
  belief: {
    v: 1, mind: 'aligned', domain: 'general', dominionId: null, claim: 'c', reasons: [], falsifier: 'f',
    sourceType: 'tool', provenance: [], status: 'held', confidence: 0.9, ...over,
  },
})

describe('need', () => {
  it('agenda: 1 − h/72 inside 72h, overdue = 1, beyond 72h = none', () => {
    expect(agendaNeed(hoursFrom(0), NOW)).toBe(1)
    expect(agendaNeed(hoursFrom(-5), NOW)).toBe(1)
    expect(agendaNeed(hoursFrom(36), NOW)).toBeCloseTo(0.5)
    expect(agendaNeed(hoursFrom(72), NOW)).toBeCloseTo(0)
    expect(agendaNeed(hoursFrom(73), NOW)).toBeNull()
    expect(agendaNeed('garbage', NOW)).toBeNull()
  })

  it('prediction: .2 + .8(1 − d/7) inside 7 days, none beyond', () => {
    expect(predictionNeed('2026-10-03', NOW)).toBeGreaterThan(0.9)
    expect(predictionNeed('2026-10-10', NOW)).toBeNull() // 7.375 days out
    expect(predictionNeed('2026-10-09', NOW)).toBeCloseTo(0.2 + 0.8 * (1 - 6.375 / 7), 5)
    expect(predictionNeed('2026-10-20', NOW)).toBeNull()
  })

  it('collects the max need per id across agenda, predictions, goals and overdue goal promises', () => {
    const needs = collectReplayNeeds({
      agenda: [
        { status: 'open', dueAt: hoursFrom(18), basisIds: ['a1', 'shared'], dominionId: 'd1' },
        { status: 'done', dueAt: hoursFrom(1), basisIds: ['closed'], dominionId: null },
        { status: 'open', dueAt: hoursFrom(200), basisIds: ['far'], dominionId: null },
      ],
      predictions: [
        { status: 'open', dueDate: '2026-10-04', basisIds: ['p1', 'shared'], dominionId: 'd2' },
        { status: 'wrong', dueDate: '2026-10-04', basisIds: ['settled'], dominionId: null },
      ],
      goals: [{ id: 'g1', dominionId: 'd3', seedIds: ['seed1'] }],
      promises: [
        { status: 'open', dueDate: '2026-10-01', source: { kind: 'goal', goalId: 'g1' } },
        { status: 'open', dueDate: '2026-10-01', source: { kind: 'weekly_review' } },
      ],
    }, NOW)
    expect(needs.get('a1')).toMatchObject({ need: 0.75, why: 'agenda', dominionId: 'd1' })
    expect(needs.get('shared')!.need).toBeGreaterThan(0.75)
    expect(needs.get('shared')!.why).toBe('prediction')
    expect(needs.get('g1')).toMatchObject({ need: 0.9, why: 'promise', dominionId: 'd3' })
    expect(needs.get('seed1')).toMatchObject({ need: 0.9, why: 'promise' })
    for (const id of ['closed', 'far', 'settled']) expect(needs.has(id)).toBe(false)
  })

  it('a goal alone is .7 for the goal and its seeds', () => {
    const needs = collectReplayNeeds({ ...none, goals: [{ id: 'g', dominionId: null, seedIds: ['s'] }] }, NOW)
    expect(needs.get('g')!.need).toBe(0.7)
    expect(needs.get('s')!.need).toBe(0.7)
  })

  it('one hop: a citing belief gets need × .8 and never lowers a direct need', () => {
    const direct = collectReplayNeeds({ ...none, goals: [{ id: 'g', dominionId: 'd', seedIds: [] }] }, NOW)
    const hopped = applyBeliefHop(direct, [
      { id: 'b1', dominionId: 'd', provenance: ['g', 'other'] },
      { id: 'b2', dominionId: null, provenance: ['unrelated'] },
      { id: 'g', dominionId: 'd', provenance: ['g'] },
    ])
    expect(hopped.get('b1')).toMatchObject({ need: 0.56, why: 'belief' })
    expect(hopped.has('b2')).toBe(false)
    expect(hopped.get('g')!.need).toBe(0.7)
  })
})

describe('gain', () => {
  const open = { engine: { surprise: { openUntil: hoursFrom(5), signals: [] } } }
  it('ranks open mark > recheck > mid confidence > negative outcome > non-belief > belief', () => {
    expect(replayGain({ ...belief(), ...open }, NOW)).toEqual({ gain: 1, questioned: true })
    expect(replayGain(belief({ recheck: { since: 'x', lostSources: [{ id: 'm', state: 'missing' }] } }), NOW)).toEqual({ gain: 0.9, questioned: true })
    expect(replayGain(belief({ confidence: 0.5 }), NOW).gain).toBe(0.7)
    expect(replayGain({ ...belief(), engine: { outcome: { negative: 2 } } }, NOW).gain).toBe(0.6)
    expect(replayGain({ engine: { outcome: { negative: 1 } } }, NOW).gain).toBe(0.6)
    expect(replayGain({}, NOW).gain).toBe(0.4)
    expect(replayGain(belief(), NOW).gain).toBe(0.3)
  })

  it('an expired mark is not open', () => {
    expect(replayGain({ engine: { surprise: { openUntil: hoursFrom(-1), signals: [] } } }, NOW).gain).toBe(0.4)
  })
})

describe('inhibition + scoring', () => {
  it('inhibits only ids present on both previous nights', () => {
    expect([...inhibitedIds([['a', 'b'], ['b', 'c']])]).toEqual(['b'])
    expect(inhibitedIds([['a']]).size).toBe(0)
    expect(inhibitedIds([]).size).toBe(0)
  })

  const row = (id: string, dominionId: string | null, sourceMetadata: unknown = {}): ReplayRow => ({ id, title: `T ${id}`, summary: null, dominionId, sourceMetadata })

  it('priority = need × gain, ×.5 when inhibited; retired beliefs and need-less rows dropped', () => {
    const needs = collectReplayNeeds({ ...none, goals: [{ id: 'g', dominionId: 'd', seedIds: ['s', 'r', 'x'] }] }, NOW)
    const scored = scoreReplay({
      needs,
      rows: [row('g', 'd'), row('s', null, belief({ confidence: 0.5 })), row('r', 'd', belief({ status: 'retired' })), row('x', 'd'), row('nope', 'd')],
      now: NOW,
      inhibited: new Set(['x']),
    })
    expect(scored.map((c) => [c.id, c.priority])).toEqual([['s', 0.49], ['g', 0.28], ['x', 0.14]])
    expect(scored[0].dominionId).toBe('d') // falls back to the need's Dominion
    expect(scored.find((c) => c.id === 'x')!.inhibited).toBe(true)
  })

  it('takes the top 8 globally and the top 4 per Dominion', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `id${String(i).padStart(2, '0')}`)
    const needs = collectReplayNeeds({ ...none, goals: [{ id: 'g', dominionId: null, seedIds: ids }] }, NOW)
    const scored = scoreReplay({ needs, rows: ids.map((id, i) => row(id, i % 2 ? 'odd' : 'even')), now: NOW })
    expect(topReplay(scored)).toHaveLength(REPLAY_TOP)
    expect(topReplayForDominion(scored, 'odd')).toHaveLength(4)
    expect(topReplayForDominion(scored, 'odd').every((c) => c.dominionId === 'odd')).toBe(true)
  })

  it('notes carry no ids', () => {
    expect(replayNote({ why: 'prediction', questioned: true })).toBe('prediction due soon; under question')
  })
})

describe('applyReplayNight', () => {
  it('writes the night, then is idempotent the same night', () => {
    const first = applyReplayNight(emptySurpriseLedger(), { night: '2026-10-03', ids: ['a', 'a', 'b'], cited: [] })
    expect(first.state!.replay).toEqual({ night: '2026-10-03', ids: ['a', 'b'] })
    expect(applyReplayNight(first.state!, { night: '2026-10-03', ids: ['z'], cited: [] }).state).toBeNull()
  })

  it('prevHits = last night ids cited by the latest aether', () => {
    const ledger = { ...emptySurpriseLedger(), replay: { night: '2026-10-02', ids: ['a', 'b', 'c'] } }
    const next = applyReplayNight(ledger, { night: '2026-10-03', ids: ['d'], cited: ['b', 'c', 'zz'] })
    expect(next.state!.replay).toEqual({ night: '2026-10-03', ids: ['d'], prevHits: 2 })
  })
})
