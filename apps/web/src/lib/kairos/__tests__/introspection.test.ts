import { describe, it, expect, vi, beforeEach } from 'vitest'

// DB-mocked runner tests, mirroring cortex.test.ts / archetypes.test.ts's
// failure-trace + parse-repair suites (docs/kairos/31, Part A).

const selectQueue: unknown[][] = []
let insertedRows: unknown[] | null = null

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
      insert: vi.fn(() => ({
        values: (v: unknown[]) => {
          insertedRows = v
          return Promise.resolve(v)
        },
      })),
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

const USER_ID = 'user-1'
const DOMINION_ID = '11111111-1111-4111-8111-111111111111'
const MEMORY_ID = '22222222-2222-4222-8222-222222222222'

function queueDominionAndContext() {
  selectQueue.push([{ id: DOMINION_ID, name: 'AEON', archivedAt: null }]) // dominion lookup
  selectQueue.push([{ n: 0 }]) // alreadyRanToday
  selectQueue.push([]) // fetchCortexBody
}

async function mockInspectDominionWithSubstrate() {
  const { inspectDominion } = await import('@/lib/data/dominions')
  vi.mocked(inspectDominion).mockResolvedValueOnce({
    name: 'AEON',
    vision: 'Fluid board/project app.',
    recentMemories: [
      { id: MEMORY_ID, title: 'Reflection', type: 'reflection', summary: 's', createdAt: new Date('2026-07-01') },
    ],
  } as never)
}

function validIntrospectionJson(): string {
  return JSON.stringify({
    proposals: [
      { kind: 'tension', title: 'Drift', body: 'A grounded observation worth surfacing.', citations: [MEMORY_ID], confidence: 0.6 },
    ],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  insertedRows = null
})

// Same headroom as cortex.test.ts / archetypes.test.ts's C1 suites: dynamic-
// import heavy tests can exceed the default 5s timeout under full-suite load.
describe('runIntrospectionForDominion — failure trace + parse repair', { timeout: 20000 }, () => {
  it('writes a failure trace on empty model response', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithSubstrate()
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

  it('repairs malformed JSON on the second attempt and stages the proposal (T-A1)', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithSubstrate()

    // Embedded unescaped quote mid-array — the real prod signature.
    const malformed = '{"proposals":[{"title":"a "quoted" break"}]}'
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: malformed })
      .mockResolvedValueOnce({ text: validIntrospectionJson() })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)

    const { runIntrospectionForDominion } = await import('../introspection')
    const result = await runIntrospectionForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('created')
    expect(result.proposalsCreated).toBe(1)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(insertedRows).toHaveLength(1)
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(0)
  })

  it('writes exactly one failure trace when both parse attempts fail (T-A2)', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithSubstrate()

    const ask = vi.fn().mockResolvedValue({ text: 'not json at all' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)

    const { runIntrospectionForDominion } = await import('../introspection')
    const result = await runIntrospectionForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/^parse_failed:/)
    expect(result.reason).toContain('repair also failed')
    expect(ask).toHaveBeenCalledTimes(2)
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(1)
    const sm = (traceCalls[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata
    expect(sm.reason).toBe('parse_failed:syntax')
  })

  it('repairs a zod-boundary schema violation, not just JSON syntax errors (T-A3)', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithSubstrate()

    // Structurally valid JSON, but confidence is out of the 0-1 range —
    // fails zod, not extractJsonBlock.
    const outOfRange = JSON.stringify({
      proposals: [{ kind: 'tension', title: 'Drift', body: 'A grounded observation.', citations: [MEMORY_ID], confidence: 1.5 }],
    })
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: outOfRange })
      .mockResolvedValueOnce({ text: validIntrospectionJson() })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)

    const { runIntrospectionForDominion } = await import('../introspection')
    const result = await runIntrospectionForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('created')
    expect(ask).toHaveBeenCalledTimes(2)
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(0)
  })

  it('records finishReason on the trace when the model truncates (T-A4)', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithSubstrate()

    const ask = vi.fn().mockResolvedValue({ text: '{"proposals":[{"title":"truncated', finishReason: 'length' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)

    const { runIntrospectionForDominion } = await import('../introspection')
    const result = await runIntrospectionForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('error')
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(1)
    const sm = (traceCalls[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata
    expect(sm.finishReason).toBe('length')
    expect(typeof sm.rawExcerpt).toBe('string')
  })
})
