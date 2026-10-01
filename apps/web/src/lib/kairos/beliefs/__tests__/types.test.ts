import { describe, expect, it } from 'vitest'
import {
  BELIEF_STREAM,
  GENERAL_DOMAIN,
  beliefRowValues,
  beliefV1Schema,
  readBelief,
  resolveDomain,
  type BeliefV1,
} from '../types'

const BELIEF: BeliefV1 = {
  v: 1,
  mind: 'aligned',
  domain: 'Aeon',
  dominionId: 'dom-1',
  claim: 'Ship small, ship often',
  reasons: ['Feedback beats speculation'],
  falsifier: 'Small releases keep regressing users',
  sourceType: 'operator',
  provenance: ['m-1', 'm-2'],
  status: 'held',
  confidence: 0.8,
}

describe('beliefV1Schema', () => {
  it('accepts the doc §1 shape, with and without supersedes', () => {
    expect(beliefV1Schema.parse(BELIEF)).toEqual(BELIEF)
    expect(beliefV1Schema.parse({ ...BELIEF, supersedes: 'old-1' }).supersedes).toBe('old-1')
  })

  it('accepts a null dominionId (general domain)', () => {
    expect(beliefV1Schema.safeParse({ ...BELIEF, domain: GENERAL_DOMAIN, dominionId: null }).success).toBe(true)
  })

  it.each([
    ['wrong version', { v: 2 }],
    ['unknown mind', { mind: 'shadow' }],
    ['unknown sourceType', { sourceType: 'chat' }],
    ['unknown status', { status: 'pending' }],
    ['confidence > 1', { confidence: 1.2 }],
    ['empty claim', { claim: '' }],
    ['empty falsifier', { falsifier: '' }],
    ['extra key', { mirroredFrom: 'x' }],
  ])('rejects %s', (_label, patch) => {
    expect(beliefV1Schema.safeParse({ ...BELIEF, ...patch }).success).toBe(false)
  })

  it('rejects a missing required field', () => {
    const { falsifier: _f, ...rest } = BELIEF
    expect(beliefV1Schema.safeParse(rest).success).toBe(false)
  })
})

describe('readBelief', () => {
  it('reads sourceMetadata.belief and returns null for anything else', () => {
    expect(readBelief({ kind: 'belief', belief: BELIEF })).toEqual(BELIEF)
    expect(readBelief({ belief: { ...BELIEF, v: 0 } })).toBeNull()
    expect(readBelief(null)).toBeNull()
    expect(readBelief({})).toBeNull()
  })
})

describe('resolveDomain', () => {
  const doms = [{ id: 'dom-1', name: 'Aeon' }, { id: 'dom-2', name: 'Shadow Lab' }]

  it('matches a Dominion name case-insensitively and returns its canonical name', () => {
    expect(resolveDomain('  shadow lab ', doms)).toEqual({ domain: 'Shadow Lab', dominionId: 'dom-2' })
  })

  it('falls back to general for unknown, empty or non-string domains', () => {
    for (const raw of ['Narnia', '', null, 42]) {
      expect(resolveDomain(raw, doms)).toEqual({ domain: GENERAL_DOMAIN, dominionId: null })
    }
  })
})

describe('beliefRowValues', () => {
  it('builds a belief-stream row with provenance links and bookkeeping beside the v1 payload', () => {
    const row = beliefRowValues(BELIEF, { extractKey: 'belief_extract:2026-10-01' })
    expect(row).toMatchObject({
      type: 'belief',
      streamClass: BELIEF_STREAM,
      confidence: 0.8,
      dominionId: 'dom-1',
      title: BELIEF.claim,
      tags: ['belief', 'mind:aligned'],
    })
    expect(row.links.map((l) => l.target)).toEqual(['m-1', 'm-2'])
    expect(row.sourceMetadata).toEqual({ extractKey: 'belief_extract:2026-10-01', kind: 'belief', belief: BELIEF })
    expect(row.bodyMd).toContain('**Would change my mind:**')
  })

  it('refuses to build a row from an invalid belief', () => {
    expect(() => beliefRowValues({ ...BELIEF, confidence: 2 })).toThrow()
  })
})
