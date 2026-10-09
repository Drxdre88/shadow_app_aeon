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
    expect(out.retrieval).toEqual({ mode: 'hybrid', reranked: true, confidence: null, lowConfidence: false })
    expect(out.contextMd).toContain('## Most relevant')
    expect(out.contextMd).toContain('### t-b')
  })

  it('renders the empty marker when nothing matches', async () => {
    const out = await prepareContext(USER, prepareContextSchema.parse({ query: 'nothing here', includePinned: false, includeToday: false }))

    expect(out.contextMd).toContain('_No matching memories found for this query._')
    expect(out.sources).toEqual([])
  })
})

function pinnedRow(id: string, summary = `s-${id}`) {
  return {
    id, title: `t-${id}`, summary, type: 'decision', source: 'manual',
    createdAt: NOW, updatedAt: NOW, confidence: null, standing: null, pinned: true,
  }
}

describe('prepareContext ordering and confidence', () => {
  it('puts query matches first, then pinned; a pinned match is cited once, as relevant', async () => {
    mocks.searchCore.mockResolvedValue({
      hits: [hit('a', 0.8, 0.8), { ...hit('px', 0.6, 0.6), row: { ...hit('px', 0.6, 0.6).row, pinned: true } }],
      mode: 'hybrid', reranked: true, candidates: 2, topRelevance: 0.8,
    })
    mocks.listMemories.mockResolvedValueOnce([pinnedRow('px'), pinnedRow('py')])

    const out = await prepareContext(USER, prepareContextSchema.parse({ query: 'archive switch', hops: 0, includeToday: false }))

    expect(out.sources.map((s) => [s.id, s.section])).toEqual([
      ['a', 'relevant'], ['px', 'relevant'], ['py', 'pinned'],
    ])
    expect(out.contextMd.indexOf('## Most relevant')).toBeLessThan(out.contextMd.indexOf('## Pinned'))
    expect(out.contextMd.match(/### t-px/g)).toHaveLength(1)
    expect(out.retrieval).toMatchObject({ confidence: 0.8, lowConfidence: false })
  })

  it('pinned rows over their budget drop to Related, never into Most relevant', async () => {
    mocks.searchCore.mockResolvedValue({ hits: [hit('a', 0.8, 0.8)], mode: 'hybrid', reranked: true, candidates: 1, topRelevance: 0.8 })
    mocks.listMemories.mockResolvedValueOnce([pinnedRow('big', 'x'.repeat(500))])

    const out = await prepareContext(USER, prepareContextSchema.parse({ query: 'archive switch', budgetTokens: 600, hops: 0, includeToday: false }))

    expect(out.sources.map((s) => [s.id, s.section])).toEqual([['a', 'relevant'], ['big', 'related']])
  })

  it('a pinned memory that matched only weakly keeps its full body in Pinned once Most relevant is full', async () => {
    const hits = Array.from({ length: 8 }, (_, i) => hit(`h${i}`, 0.9 - i * 0.01, 0.9 - i * 0.01))
    const weakPinned = { ...hit('pw', 0.2, 0.2), row: { ...hit('pw', 0.2, 0.2).row, pinned: true } }
    mocks.searchCore.mockResolvedValue({ hits: [...hits, weakPinned], mode: 'hybrid', reranked: true, candidates: 9, topRelevance: 0.9 })
    mocks.listMemories.mockResolvedValueOnce([pinnedRow('pw')])

    const out = await prepareContext(USER, prepareContextSchema.parse({ query: 'archive switch', hops: 0, includeToday: false }))

    expect(out.sources.find((s) => s.id === 'pw')?.section).toBe('pinned')
  })

  it('a weak best match is flagged, not dropped, and pinned context stays', async () => {
    mocks.searchCore.mockResolvedValue({ hits: [hit('w', 0.39, 0.39)], mode: 'hybrid', reranked: true, candidates: 1, topRelevance: 0.39 })
    mocks.listMemories.mockResolvedValueOnce([pinnedRow('py')])

    const out = await prepareContext(USER, prepareContextSchema.parse({ query: 'snowflake contract value', hops: 0, includeToday: false }))

    expect(out.retrieval).toEqual({ mode: 'hybrid', reranked: true, confidence: 0.39, lowConfidence: true })
    expect(out.sources.map((s) => s.id)).toEqual(['w', 'py'])
    expect(out.contextMd).toContain('> Low confidence:')
  })
})
