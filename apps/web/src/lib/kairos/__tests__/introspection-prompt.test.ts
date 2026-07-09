import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildIntrospectionPrompt,
  introspectionOutSchema,
  filterGroundedProposals,
  extractJsonBlock,
  type IntrospectionContext,
  type IntrospectionOutput,
} from '../introspection-prompt'

// Pure-function tests only below (see archetypes.test.ts for rationale).
// Exception (C1): one targeted describe block at the bottom mocks just
// enough of the data layer to assert the failure-trace wiring fires.

const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => ({ values: () => Promise.resolve([]) })),
    },
  }
})

vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: vi.fn(),
  inspectDominion: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

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

// Heavier DB-mocked tests than the pure-function suite above; give them
// headroom so they don't flake on the default 5s timeout under full-suite load.
describe('runIntrospectionForDominion — failure trace (C1)', { timeout: 20000 }, () => {
  const USER_ID = 'user-1'
  const DOMINION_ID = '33333333-3333-4333-8333-333333333333'

  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
  })

  it('writes a failure trace on empty model response', async () => {
    const { inspectDominion } = await import('@/lib/data/dominions')
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')

    selectQueue.push([{ id: DOMINION_ID, name: 'AEON', archivedAt: null }]) // dominion lookup
    selectQueue.push([{ n: 0 }]) // alreadyRanToday
    vi.mocked(inspectDominion).mockResolvedValueOnce({
      name: 'AEON',
      vision: null,
      recentMemories: [{ id: ID_A, title: 'Shipped hybrid retrieval', type: 'session_summary', summary: null, createdAt: new Date('2026-07-01') }],
    } as never)
    selectQueue.push([]) // fetchCortexBody
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask: vi.fn().mockResolvedValue({ text: '' }) } } as never)

    const { runIntrospectionForDominion } = await import('../introspection')
    const result = await runIntrospectionForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('error')
    expect(result.reason).toBe('empty model response')
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(1)
    const sm = (traceCalls[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata
    expect(sm.cronName).toBe('introspection')
    expect(sm.reason).toBe('empty_response')
  })
})
