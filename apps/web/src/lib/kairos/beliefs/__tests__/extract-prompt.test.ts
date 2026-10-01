import { describe, expect, it } from 'vitest'
import {
  BeliefGroundingError,
  MAX_CLAIMS,
  buildExtractPrompt,
  groundExtraction,
  extractOutSchema,
  parseExtractText,
} from '../extract-prompt'

const IN1 = '11111111-aaaa-4aaa-8aaa-111111111111'
const IN2 = '22222222-bbbb-4bbb-8bbb-222222222222'
const HELD = '33333333-cccc-4ccc-8ccc-333333333333'
const ctx = { inputIds: [IN1, IN2], heldIds: [HELD], dominions: [{ id: 'dom-1', name: 'Aeon' }] }

function claim(over: Record<string, unknown> = {}) {
  return {
    claim: 'Ship small',
    domain: 'aeon',
    reasons: ['Fast feedback'],
    falsifier: 'Small ships keep breaking',
    provenance: [IN1],
    relation: 'new',
    targetId: null,
    confidence: 0.7,
    ...over,
  }
}

const text = (beliefs: unknown[]) => '```json\n' + JSON.stringify({ beliefs }) + '\n```'

describe('groundExtraction', () => {
  it('drops unknown provenance ids and keeps canonical fed ids (prefix + bracket tolerant)', () => {
    const [c] = parseExtractText(text([claim({ provenance: ['[11111111]', 'deadbeef-0000-4000-8000-000000000000', IN2.toUpperCase()] })]), ctx)
    expect(c.provenance).toEqual([IN1, IN2])
    expect(c.domain).toBe('Aeon')
    expect(c.dominionId).toBe('dom-1')
  })

  it('drops a claim whose provenance is entirely ungrounded but keeps the grounded ones', () => {
    const out = parseExtractText(text([claim({ provenance: ['nope'] }), claim({ claim: 'Kept' })]), ctx)
    expect(out.map((c) => c.claim)).toEqual(['Kept'])
  })

  it('throws when every claim is ungrounded', () => {
    expect(() => parseExtractText(text([claim({ provenance: ['nope'] })]), ctx)).toThrow(BeliefGroundingError)
  })

  it('accepts an honest empty answer', () => {
    expect(parseExtractText(text([]), ctx)).toEqual([])
  })

  it('downgrades reinforces/replaces with an unknown target to new', () => {
    const [c] = parseExtractText(text([claim({ relation: 'replaces', targetId: 'invented' })]), ctx)
    expect(c).toMatchObject({ relation: 'new', targetId: null })
  })

  it('never grounds a target against the input ids (targets are held beliefs only)', () => {
    const [c] = parseExtractText(text([claim({ relation: 'reinforces', targetId: IN1 })]), ctx)
    expect(c.relation).toBe('new')
  })

  it('replaces one held belief at most once and drops a moot reinforcement of it', () => {
    const out = parseExtractText(text([
      claim({ claim: 'A', relation: 'replaces', targetId: HELD }),
      claim({ claim: 'B', relation: 'replaces', targetId: HELD }),
      claim({ claim: 'C', relation: 'reinforces', targetId: HELD }),
    ]), ctx)
    expect(out.map((c) => [c.claim, c.relation, c.targetId])).toEqual([
      ['A', 'replaces', HELD],
      ['B', 'new', null],
    ])
  })

  it('maps an unknown domain to general', () => {
    const [c] = groundExtraction(extractOutSchema.parse({ beliefs: [claim({ domain: 'Narnia' })] }), ctx)
    expect(c).toMatchObject({ domain: 'general', dominionId: null })
  })
})

describe('extractOutSchema', () => {
  it(`rejects more than ${MAX_CLAIMS} claims`, () => {
    const many = Array.from({ length: MAX_CLAIMS + 1 }, () => claim())
    expect(extractOutSchema.safeParse({ beliefs: many }).success).toBe(false)
  })

  it('rejects an unknown relation and a confidence out of range', () => {
    expect(extractOutSchema.safeParse({ beliefs: [claim({ relation: 'maybe' })] }).success).toBe(false)
    expect(extractOutSchema.safeParse({ beliefs: [claim({ confidence: 3 })] }).success).toBe(false)
  })

  it('clamps over-long text and caps reasons', () => {
    const out = extractOutSchema.parse({ beliefs: [claim({ claim: 'x'.repeat(900), reasons: ['a', 'b', 'c', 'd', 'e', 'f'] })] })
    expect(out.beliefs[0].claim.length).toBeLessThanOrEqual(300)
    expect(out.beliefs[0].reasons).toHaveLength(4)
  })
})

describe('buildExtractPrompt', () => {
  it('lists dominions, held beliefs and inputs by [id]', () => {
    const prompt = buildExtractPrompt({
      dominions: [{ id: 'dom-1', name: 'Aeon' }],
      held: [{ id: HELD, domain: 'Aeon', claim: 'Quality first' }],
      inputs: [{ id: IN1, title: 'Note', aiTitle: null, summary: null, bodyMd: 'I think ```x``` matters', type: 'reflection', kind: null, createdAt: new Date('2026-09-30T10:00:00Z') }],
    })
    expect(prompt).toContain(`[${HELD}] (Aeon) Quality first`)
    expect(prompt).toContain(`[${IN1}] 2026-09-30 (reflection) Note`)
    expect(prompt).not.toContain('```')
  })
})
