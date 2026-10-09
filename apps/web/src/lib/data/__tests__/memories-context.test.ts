import { describe, it, expect, vi, beforeEach } from 'vitest'

// prepare_context on the shared retrieval core: real-memory default, Dominion
// scope, type lifting, single application of standing, additive `retrieval`.

const mocks = vi.hoisted(() => ({
  searchCore: vi.fn(),
  listMemories: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  getNeighbours: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  findMemoriesByIds: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
}))

vi.mock('@/lib/kairos/search-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kairos/search-core')>()
  return { ...actual, searchCore: mocks.searchCore }
})
vi.mock('../memories', () => ({
  listMemories: mocks.listMemories,
  getNeighbours: mocks.getNeighbours,
  findMemoriesByIds: mocks.findMemoriesByIds,
  recencyMultiplier: () => 1,
}))
vi.mock('../prepare-context-today', () => ({ loadTodayContextSection: vi.fn(async () => '') }))
vi.mock('@/lib/db', () => ({ db: {} }))

import { prepareContext } from '../memories-context'
import { REAL_MEMORY_STREAMS } from '@/lib/kairos/search-core'
import { prepareContextSchema } from '../validators'

const USER = 'user-1'
const NOW = new Date()
const DOM = 'b0000000-0000-4000-8000-000000000002'

function hit(id: string, relevance: number, score: number, standing: number | null = null) {
  return {
    row: {
      id, title: `t-${id}`, summary: `s-${id}`, bodyMd: `body ${id}`, type: 'decision', source: 'claude',
      streamClass: 'idea', createdAt: NOW, updatedAt: NOW, pinned: false, confidence: null, standing,
    },
    relevance,
    score,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchCore.mockResolvedValue({ hits: [], mode: 'hybrid', reranked: true, candidates: 0 })
})

describe('prepareContext on the shared core', () => {
  it('queries the core with real-memory streams, the Dominion scope and a capped rerank pool', async () => {
    await prepareContext(USER, prepareContextSchema.parse({ query: 'telegram morning', dominionId: DOM }))

    expect(mocks.searchCore).toHaveBeenCalledWith(USER, expect.objectContaining({
      query: 'telegram morning',
      limit: 30,
      dominionId: DOM,
      streams: REAL_MEMORY_STREAMS,
      filters: [],
      rerankPoolMax: 40,
      minQueryChars: 2,
    }))
  })

  it('an explicit type or includeMachine lifts the stream default; type + realm become filters', async () => {
    await prepareContext(USER, prepareContextSchema.parse({
      query: 'board snapshot', type: 'snapshot', realmId: 'c0000000-0000-4000-8000-000000000003',
    }))
    const opts = mocks.searchCore.mock.calls[0][1]
    expect(opts.streams).toBeNull()
    expect(opts.filters).toHaveLength(2)

    await prepareContext(USER, prepareContextSchema.parse({ query: 'nightly trace', includeMachine: true }))
    expect(mocks.searchCore.mock.calls[1][1].streams).toBeNull()
  })

  it('scores hits on core relevance (standing applied once) and reports the retrieval mode', async () => {
    // B has the higher relevance; A's higher core score already folds standing.
    mocks.searchCore.mockResolvedValue({
      hits: [hit('a', 0.2, 0.3, 1.0), hit('b', 0.5, 0.25, null)],
      mode: 'hybrid', reranked: true, candidates: 2,
    })

    const out = await prepareContext(USER, prepareContextSchema.parse({ query: 'auth migration', includePinned: false, hops: 0, includeToday: false }))

    // a: 0.2 × (0.5 + 1.0) = 0.3; b: 0.5 × P0 factor (≥ 1) ≥ 0.5.
    expect(out.sources.map((s) => s.id)).toEqual(['b', 'a'])
    expect(out.sources[1].score).toBeCloseTo(0.3)
    expect(out.retrieval).toEqual({ mode: 'hybrid', reranked: true })
    expect(out.contextMd).toContain('## Most relevant')
    expect(out.contextMd).toContain('### t-b')
  })

  it('renders the empty marker when nothing matches', async () => {
    const out = await prepareContext(USER, prepareContextSchema.parse({ query: 'nothing here', includePinned: false, includeToday: false }))

    expect(out.contextMd).toContain('_No matching memories found for this query._')
    expect(out.sources).toEqual([])
  })
})
