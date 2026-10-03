import { describe, expect, it } from 'vitest'
import {
  BeliefGroundingError,
  EXTRACT_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT_SURPRISE,
  MAX_CLAIMS,
  buildExtractPrompt,
  groundExtraction,
  groundRetires,
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

describe('surprise gate (questioned beliefs)', () => {
  const OPEN = '44444444-dddd-4ddd-8ddd-444444444444'
  const input = {
    dominions: [{ id: 'dom-1', name: 'Aeon' }],
    held: [{ id: HELD, domain: 'Aeon', claim: 'Quality first' }],
    inputs: [{ id: IN1, title: 'Note', aiTitle: null, summary: null, bodyMd: 'b', type: 'reflection', kind: null, createdAt: new Date('2026-09-30T10:00:00Z') }],
  }

  it('INVARIANT: no questioned beliefs → prompt byte-identical; the base system prompt keeps its retire rule', () => {
    expect(buildExtractPrompt({ ...input, questioned: [] })).toBe(buildExtractPrompt(input))
    expect(EXTRACT_SYSTEM_PROMPT).toContain('Beliefs listed under "lost part of their support": for each')
    expect(EXTRACT_SYSTEM_PROMPT).not.toContain('questioned by events')
  })

  it('the variant is static and differs only in the retire rules', () => {
    expect(EXTRACT_SYSTEM_PROMPT_SURPRISE).not.toBe(EXTRACT_SYSTEM_PROMPT)
    expect(EXTRACT_SYSTEM_PROMPT_SURPRISE).toContain('"questioned by events"')
    const base = EXTRACT_SYSTEM_PROMPT.split('\n')
    const variant = EXTRACT_SYSTEM_PROMPT_SURPRISE.split('\n')
    expect(variant.filter((l) => !base.includes(l))).toHaveLength(2)
    expect(base.filter((l) => !variant.includes(l))).toHaveLength(1)
    expect(EXTRACT_SYSTEM_PROMPT_SURPRISE).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('renders the questioned section with why, after the held list', () => {
    const prompt = buildExtractPrompt({ ...input, questioned: [{ id: OPEN, domain: 'Aeon', claim: 'Evenings are dead', why: 'a prediction resting on it went wrong' }] })
    expect(prompt).toContain('## These beliefs were questioned by events. For each: reaffirm (cite evidence), replace, or retire. (1)')
    expect(prompt).toContain(`- [${OPEN}] (Aeon) Evenings are dead (why: a prediction resting on it went wrong)`)
    expect(prompt.indexOf('questioned by events')).toBeGreaterThan(prompt.indexOf('Existing held aligned beliefs'))
  })

  it('groundRetires accepts flagged ∪ open ids; others are dropped', () => {
    const out = extractOutSchema.parse({ beliefs: [], retire: [{ targetId: OPEN.slice(0, 8), reason: 'r' }, { targetId: HELD, reason: 'r' }] })
    expect(groundRetires(out, [], { ...ctx, openIds: [OPEN] })).toEqual([{ targetId: OPEN, reason: 'r' }])
    expect(groundRetires(out, [], ctx)).toEqual([])
  })
})
