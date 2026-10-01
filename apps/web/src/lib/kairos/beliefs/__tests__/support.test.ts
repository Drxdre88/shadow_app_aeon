import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/beliefs', () => ({}))
import { BELIEF_CONFIDENCE_CAP } from '@/lib/kairos/origin'
import { ownBeliefFromPromotion } from '../mirror'
import { decideRecheck, mayReplace, penalisedConfidence, reinforcedBelief, sourceTypeOf } from '../support'
import { readBelief, remainingProvenance, type BeliefV1 } from '../types'
import type { PromotionToMirror } from '@/lib/data/beliefs'

const NOW = new Date('2026-10-01T02:00:00.000Z')

function belief(over: Partial<BeliefV1> = {}): BeliefV1 {
  return {
    v: 1, mind: 'aligned', domain: 'general', dominionId: null, claim: 'Ship small', reasons: [], falsifier: 'x',
    sourceType: 'operator', provenance: ['a', 'b'], status: 'held', confidence: 0.8, ...over,
  }
}

describe('belief schema (P2.5)', () => {
  it('still parses rows written before P2.5 (no recheck) and accepts the recheck flag', () => {
    expect(readBelief({ belief: belief() })).toEqual(belief())
    const flagged = belief({ recheck: { since: NOW.toISOString(), lostSources: [{ id: 'b', state: 'archived' }] } })
    expect(readBelief({ belief: flagged })?.recheck?.lostSources).toEqual([{ id: 'b', state: 'archived' }])
    expect(remainingProvenance(flagged)).toEqual(['a'])
  })

  it('rejects a malformed recheck flag', () => {
    expect(readBelief({ belief: { ...belief(), recheck: { since: 'x', lostSources: [] } } })).toBeNull()
  })
})

describe('sourceTypeOf / mayReplace', () => {
  it('takes the best surviving origin; nothing found is inference', () => {
    expect(sourceTypeOf(['a', 'b'], new Map([['a', 'kairos'], ['b', 'agent']]))).toBe('tool')
    expect(sourceTypeOf(['a', 'b'], new Map([['a', 'kairos'], ['b', 'operator']]))).toBe('operator')
    expect(sourceTypeOf(['a'], new Map())).toBe('inference')
  })

  it('an inference-only claim never replaces an operator or tool belief', () => {
    expect(mayReplace('inference', 'operator')).toBe(false)
    expect(mayReplace('inference', 'tool')).toBe(false)
    expect(mayReplace('inference', 'inference')).toBe(true)
    expect(mayReplace('operator', 'operator')).toBe(true)
  })
})

describe('reinforcedBelief', () => {
  it('upgrades on operator evidence, stays within the new cap, drops lost sources and clears the flag', () => {
    const old = belief({ sourceType: 'inference', confidence: 0.5, provenance: ['k', 'gone'], recheck: { since: NOW.toISOString(), lostSources: [{ id: 'gone', state: 'missing' }] } })
    const next = reinforcedBelief(old, ['op'], new Map([['k', 'kairos'], ['op', 'operator']]), 0.99)
    expect(next).toMatchObject({ sourceType: 'operator', confidence: BELIEF_CONFIDENCE_CAP.operator, provenance: ['k', 'op'] })
    expect(next.recheck).toBeUndefined()
  })

  it('caps an over-confident old value when the evidence is weaker than the label claimed', () => {
    const next = reinforcedBelief(belief({ confidence: 0.9 }), [], new Map([['a', 'kairos']]))
    expect(next).toMatchObject({ sourceType: 'inference', confidence: 0.6 })
  })
})

describe('decideRecheck', () => {
  it('penalises by 0.7 with a 0.1 floor', () => {
    expect(penalisedConfidence(0.8)).toBeCloseTo(0.56)
    expect(penalisedConfidence(0.12)).toBe(0.1)
    expect(penalisedConfidence(0.05)).toBe(0.05)
  })

  it('flags once per new loss set and is idempotent for recorded sources', () => {
    const d = decideRecheck(belief(), [{ id: 'b', state: 'invalidated' }], NOW)
    expect(d.kind).toBe('flag')
    if (d.kind !== 'flag') return
    expect(d.belief.recheck).toEqual({ since: NOW.toISOString(), lostSources: [{ id: 'b', state: 'invalidated' }] })
    expect(d.belief.confidence).toBeCloseTo(0.56)
    expect(decideRecheck(d.belief, [{ id: 'b', state: 'invalidated' }], NOW).kind).toBe('none')
    const later = decideRecheck(d.belief, [{ id: 'a', state: 'archived' }, { id: 'b', state: 'invalidated' }], new Date('2026-10-02T02:00:00Z'))
    expect(later.kind).toBe('flag')
    if (later.kind !== 'flag') return
    expect(later.newlyLost).toEqual([{ id: 'a', state: 'archived' }])
    expect(later.belief.recheck?.since).toBe(NOW.toISOString())
    expect(later.belief.confidence).toBeCloseTo(0.392)
  })

  it('skips sources the operator acknowledged by reverting a recheck, and ids not in provenance', () => {
    expect(decideRecheck(belief(), [{ id: 'b', state: 'missing' }], NOW, { acknowledged: new Set(['b']) }).kind).toBe('none')
    expect(decideRecheck(belief(), [{ id: 'zzz', state: 'missing' }], NOW).kind).toBe('none')
  })

  it('retires an own belief whose only provenance is gone; an aligned one stays flagged', () => {
    const own = belief({ mind: 'own', sourceType: 'inference', provenance: ['p'], confidence: 0.6 })
    const d = decideRecheck(own, [{ id: 'p', state: 'missing' }], NOW)
    expect(d.kind).toBe('retire')
    if (d.kind === 'retire') expect(d.belief).toMatchObject({ status: 'retired', confidence: 0.6 })
    expect(decideRecheck(own, [{ id: 'p', state: 'missing' }], NOW, { retireVetoed: true }).kind).toBe('flag')
    expect(decideRecheck(belief({ provenance: ['p'] }), [{ id: 'p', state: 'missing' }], NOW).kind).toBe('flag')
    expect(decideRecheck({ ...own, provenance: ['p', 'q'] }, [{ id: 'p', state: 'missing' }], NOW).kind).toBe('flag')
  })
})

describe('own-mind mirror confidence', () => {
  it('is inference, capped at 0.6', () => {
    const p: PromotionToMirror = {
      opId: 'op-1', promotedAt: NOW, proposalId: 'prop-1', title: 'Rest matters', aiTitle: null, summary: null, bodyMd: '',
      dominionId: null, dominionName: null, confidence: 0.9, sourceMetadata: {},
    }
    expect(ownBeliefFromPromotion(p)).toMatchObject({ sourceType: 'inference', confidence: 0.6 })
  })
})
