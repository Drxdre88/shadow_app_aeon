import { describe, it, expect } from 'vitest'
import {
  buildContradictionPrompt,
  contradictionOutSchema,
  filterGroundedFindings,
  extractJsonBlock,
  type ContradictionProbe,
  type ContradictionCandidate,
  type ContradictionOutput,
} from '../contradiction-prompt'

// Pure-function tests only (see introspection-prompt.test.ts for rationale).

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_HALLUCINATED = '99999999-9999-4999-8999-999999999999'

const probe: ContradictionProbe = {
  id: ID_A,
  title: 'We ship weekly on Fridays',
  bodyMd: 'Release cadence is weekly, every Friday.',
  type: 'decision',
  createdAt: new Date('2026-07-01'),
  confidence: 0.9,
}

const candidates: ContradictionCandidate[] = [
  {
    id: ID_B,
    title: 'We ship biweekly now',
    aiTitle: null,
    bodyMd: 'Switched release cadence to every other week.',
    type: 'decision',
    createdAt: new Date('2026-06-01'),
    confidence: 0.8,
  },
]

describe('buildContradictionPrompt', () => {
  it('embeds probe and candidate ids so the model can cite them', () => {
    const prompt = buildContradictionPrompt(probe, candidates)
    expect(prompt).toContain(`[${ID_A}]`)
    expect(prompt).toContain(`[${ID_B}]`)
  })

  it('embeds probe and candidate content', () => {
    const prompt = buildContradictionPrompt(probe, candidates)
    expect(prompt).toContain('We ship weekly on Fridays')
    expect(prompt).toContain('We ship biweekly now')
  })

  it('instructs contradiction judging and grounding', () => {
    const prompt = buildContradictionPrompt(probe, candidates)
    expect(prompt).toMatch(/CONTRADICTORY claim/i)
    expect(prompt).toMatch(/MUST be one of the exact/i)
  })
})

describe('contradictionOutSchema', () => {
  it('parses a valid finding payload', () => {
    const out = contradictionOutSchema.parse({
      findings: [
        { candidateId: ID_B, contradicts: true, winner: 'candidate', confidence: 0.8, rationale: 'cadence changed' },
      ],
    })
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].winner).toBe('candidate')
  })

  it('defaults findings to an empty array', () => {
    expect(contradictionOutSchema.parse({}).findings).toEqual([])
  })

  it('rejects an unknown winner value', () => {
    expect(() =>
      contradictionOutSchema.parse({
        findings: [{ candidateId: ID_B, contradicts: true, winner: 'nobody', confidence: 0.5, rationale: 'r' }],
      }),
    ).toThrow()
  })

  it('rejects confidence outside 0–1', () => {
    expect(() =>
      contradictionOutSchema.parse({
        findings: [{ candidateId: ID_B, contradicts: true, winner: 'probe', confidence: 1.2, rationale: 'r' }],
      }),
    ).toThrow()
  })

  it('rejects a non-uuid candidateId', () => {
    expect(() =>
      contradictionOutSchema.parse({
        findings: [{ candidateId: 'not-a-uuid', contradicts: true, winner: 'probe', confidence: 0.5, rationale: 'r' }],
      }),
    ).toThrow()
  })
})

describe('filterGroundedFindings', () => {
  const validIds = new Set([ID_B])

  it('keeps findings whose candidateId exists', () => {
    const out: ContradictionOutput = {
      findings: [{ candidateId: ID_B, contradicts: true, winner: 'probe', confidence: 0.6, rationale: 'r' }],
    }
    expect(filterGroundedFindings(out, validIds)).toHaveLength(1)
  })

  it('drops a finding whose candidateId was never retrieved', () => {
    const out: ContradictionOutput = {
      findings: [{ candidateId: ID_HALLUCINATED, contradicts: true, winner: 'probe', confidence: 0.6, rationale: 'r' }],
    }
    expect(filterGroundedFindings(out, validIds)).toHaveLength(0)
  })
})

describe('extractJsonBlock', () => {
  it('parses a fenced json block from a model response', () => {
    const raw = 'Here:\n```json\n{ "findings": [] }\n```\ndone'
    expect(extractJsonBlock(raw)).toEqual({ findings: [] })
  })

  it('throws a contextual error when no json is present', () => {
    expect(() => extractJsonBlock('no json here')).toThrow(/contradiction/)
  })
})
