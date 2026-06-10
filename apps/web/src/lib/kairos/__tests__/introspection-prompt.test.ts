import { describe, it, expect } from 'vitest'
import {
  buildIntrospectionPrompt,
  introspectionOutSchema,
  filterGroundedProposals,
  extractJsonBlock,
  type IntrospectionContext,
  type IntrospectionOutput,
} from '../introspection-prompt'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_HALLUCINATED = '99999999-9999-4999-8999-999999999999'

const ctx: IntrospectionContext = {
  dominionId: '33333333-3333-4333-8333-333333333333',
  name: 'AEON',
  vision: 'Second brain',
  cortexBody: 'Current model of the dominion.',
  recentMemories: [
    { id: ID_A, title: 'Shipped hybrid retrieval', type: 'session_summary', summary: 'RRF fusion', createdAt: new Date('2026-06-07') },
    { id: ID_B, title: 'No objectives set', type: 'observation', summary: null, createdAt: new Date('2026-06-06') },
  ],
}

describe('buildIntrospectionPrompt', () => {
  it('embeds memory ids so the model can cite them', () => {
    const prompt = buildIntrospectionPrompt(ctx, '2026-06-07')
    expect(prompt).toContain(`[${ID_A}]`)
    expect(prompt).toContain(`[${ID_B}]`)
    expect(prompt).toContain('AEON')
  })

  it('instructs propose-not-commit and grounding', () => {
    const prompt = buildIntrospectionPrompt(ctx, '2026-06-07')
    expect(prompt).toMatch(/PROPOSE, do not assert/i)
    expect(prompt).toMatch(/MUST cite/i)
  })

  it('handles an empty cortex and empty memory list', () => {
    const prompt = buildIntrospectionPrompt(
      { ...ctx, cortexBody: null, recentMemories: [] },
      '2026-06-07',
    )
    expect(prompt).toContain('(no cortex yet)')
    expect(prompt).toContain('(none)')
  })
})

describe('introspectionOutSchema', () => {
  it('parses a valid proposal payload', () => {
    const out = introspectionOutSchema.parse({
      proposals: [
        { kind: 'tension', title: 'Drift', body: 'Cards lag sessions', citations: [ID_A], confidence: 0.7 },
      ],
    })
    expect(out.proposals).toHaveLength(1)
    expect(out.proposals[0].kind).toBe('tension')
  })

  it('defaults proposals to an empty array', () => {
    expect(introspectionOutSchema.parse({}).proposals).toEqual([])
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      introspectionOutSchema.parse({
        proposals: [{ kind: 'rumour', title: 't', body: 'b', citations: [ID_A], confidence: 0.5 }],
      }),
    ).toThrow()
  })

  it('rejects a proposal with zero citations', () => {
    expect(() =>
      introspectionOutSchema.parse({
        proposals: [{ kind: 'reflection', title: 't', body: 'b', citations: [], confidence: 0.5 }],
      }),
    ).toThrow()
  })

  it('rejects confidence outside 0–1', () => {
    expect(() =>
      introspectionOutSchema.parse({
        proposals: [{ kind: 'reflection', title: 't', body: 'b', citations: [ID_A], confidence: 1.4 }],
      }),
    ).toThrow()
  })
})

describe('filterGroundedProposals', () => {
  const validIds = new Set([ID_A, ID_B])

  it('keeps proposals whose citations exist', () => {
    const out: IntrospectionOutput = {
      proposals: [{ kind: 'reflection', title: 't', body: 'b', citations: [ID_A], confidence: 0.6 }],
    }
    expect(filterGroundedProposals(out, validIds)).toHaveLength(1)
  })

  it('strips hallucinated citations but keeps the valid ones', () => {
    const out: IntrospectionOutput = {
      proposals: [{ kind: 'connection', title: 't', body: 'b', citations: [ID_A, ID_HALLUCINATED], confidence: 0.6 }],
    }
    const kept = filterGroundedProposals(out, validIds)
    expect(kept).toHaveLength(1)
    expect(kept[0].citations).toEqual([ID_A])
  })

  it('drops a proposal left with zero valid citations', () => {
    const out: IntrospectionOutput = {
      proposals: [{ kind: 'question', title: 't', body: 'b', citations: [ID_HALLUCINATED], confidence: 0.6 }],
    }
    expect(filterGroundedProposals(out, validIds)).toHaveLength(0)
  })
})

describe('extractJsonBlock', () => {
  it('parses a fenced json block from a model response', () => {
    const raw = 'Here:\n```json\n{ "proposals": [] }\n```\ndone'
    expect(extractJsonBlock(raw)).toEqual({ proposals: [] })
  })

  it('throws a contextual error when no json is present', () => {
    expect(() => extractJsonBlock('no json here')).toThrow(/introspection/)
  })
})
