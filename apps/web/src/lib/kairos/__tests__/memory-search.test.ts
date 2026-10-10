import { describe, it, expect, vi, beforeEach } from 'vitest'

// search_memories over the shared core: stream defaults, exact-filter
// lifting, the browse path, paging and the additive response shape.

const mocks = vi.hoisted(() => ({
  searchCore: vi.fn(),
  searchMemoriesFts: vi.fn(),
  exactFilterConditions: vi.fn((_input: unknown) => ['FILTER']),
}))

vi.mock('../search-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../search-core')>()
  return { ...actual, searchCore: mocks.searchCore }
})
vi.mock('@/lib/data/memories-search', () => ({
  searchMemoriesFts: mocks.searchMemoriesFts,
  exactFilterConditions: mocks.exactFilterConditions,
}))
vi.mock('@/lib/db', () => ({ db: {} }))

import { searchMemoriesHybrid } from '../memory-search'
import { MACHINE_STREAMS, REAL_MEMORY_STREAMS } from '../search-core'
import { searchMemoriesSchema } from '@/lib/data/validators'

const USER = 'user-1'
const NOW = new Date('2026-10-09T10:00:00Z')

function coreRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, title: `t-${id}`, summary: null, bodyMd: 'A long body about Telegram morning messages.',
    type: 'note', source: 'claude', sourceMetadata: {}, streamClass: 'idea',
    createdAt: NOW, updatedAt: NOW, realmId: null, projectId: null, taskId: null, dominionId: 'dom-1',
    tags: [], pinned: false, confidence: 0.6, standing: 0.4, ...extra,
  }
}

const parse = (v: Record<string, unknown>) => searchMemoriesSchema.parse(v)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchCore.mockResolvedValue({ hits: [], mode: 'hybrid', reranked: true, candidates: 0 })
})

describe('searchMemoriesHybrid', () => {
  it('runs a query through the core with real-memory streams, exact filters and the Dominion scope', async () => {
    await searchMemoriesHybrid(USER, parse({ query: 'feedback ideas buttons', dominionId: 'b0000000-0000-4000-8000-000000000002' }))

    expect(mocks.searchCore).toHaveBeenCalledWith(USER, expect.objectContaining({
      query: 'feedback ideas buttons',
      limit: 20,
      dominionId: 'b0000000-0000-4000-8000-000000000002',
      streams: REAL_MEMORY_STREAMS,
      filters: ['FILTER'],
      snippets: true,
    }))
    expect(mocks.searchMemoriesFts).not.toHaveBeenCalled()
  })

  it.each([
    ['includeMachine', { includeMachine: true }],
    ['an explicit type', { type: 'snapshot' }],
    ['an explicit source', { source: 'cron' }],
  ])('%s lifts the stream default', async (_label, extra) => {
    await searchMemoriesHybrid(USER, parse({ query: 'nightly board', ...extra }))

    expect(mocks.searchCore.mock.calls[0][1].streams).toBeNull()
  })

  it('passes the entity switch through; absent leaves the core default', async () => {
    await searchMemoriesHybrid(USER, parse({ query: 'Triad bridge', entity: true }))
    await searchMemoriesHybrid(USER, parse({ query: 'Triad bridge' }))

    expect(mocks.searchCore.mock.calls[0][1].entity).toBe(true)
    expect(mocks.searchCore.mock.calls[1][1].entity).toBeUndefined()
    expect(searchMemoriesSchema.safeParse({ query: 'x y', entity: 'yes' }).success).toBe(false)
  })

  it('keeps the legacy hit fields and adds streamClass, dominionId, score and retrieval', async () => {
    mocks.searchCore.mockResolvedValue({
      hits: [
        { row: coreRow('m1', { snippet: '<b>Telegram</b> morning' }), score: 0.9, relevance: 0.7 },
        { row: coreRow('m2'), score: 0.5, relevance: 0.4 },
      ],
      mode: 'hybrid', reranked: true, candidates: 7, topRelevance: 0.82,
    })

    const out = await searchMemoriesHybrid(USER, parse({ query: 'telegram morning' }))

    expect(out.total).toBe(7)
    expect(out.retrieval).toEqual({ mode: 'hybrid', reranked: true, confidence: 0.82, lowConfidence: false })
    expect(out.hits[0]).toMatchObject({
      id: 'm1', title: 't-m1', type: 'note', source: 'claude', pinned: false, confidence: 0.6,
      streamClass: 'idea', dominionId: 'dom-1', rank: 0.9, score: 0.9, snippet: '<b>Telegram</b> morning',
    })
    expect(out.hits[0]).not.toHaveProperty('bodyMd')
    // Vector-only hit: no ts_headline, so a plain excerpt stands in.
    expect(out.hits[1].snippet).toBe('A long body about Telegram morning messages.')
  })

  it('a weak best match keeps its hits but flags lowConfidence', async () => {
    mocks.searchCore.mockResolvedValue({
      hits: [{ row: coreRow('w1'), score: 0.4, relevance: 0.39 }],
      mode: 'hybrid', reranked: true, candidates: 1, topRelevance: 0.393,
    })

    const out = await searchMemoriesHybrid(USER, parse({ query: 'tokyo office lease renewal' }))

    expect(out.hits.map((h) => h.id)).toEqual(['w1'])
    expect(out.retrieval).toEqual({ mode: 'hybrid', reranked: true, confidence: 0.393, lowConfidence: true })
  })

  it('without rerank there is no calibrated signal: confidence null, never flagged', async () => {
    mocks.searchCore.mockResolvedValue({
      hits: [{ row: coreRow('f1'), score: 0.02, relevance: 0.016 }],
      mode: 'fts', reranked: false, candidates: 1, topRelevance: null,
    })

    const out = await searchMemoriesHybrid(USER, parse({ query: 'aeon deploy' }))

    expect(out.retrieval).toMatchObject({ confidence: null, lowConfidence: false })
  })

  it('pages with offset over the ranked window', async () => {
    mocks.searchCore.mockResolvedValue({
      hits: ['a', 'b', 'c'].map((id, i) => ({ row: coreRow(id), score: 1 - i * 0.1, relevance: 0.5 })),
      mode: 'fts', reranked: false, candidates: 3,
    })

    const out = await searchMemoriesHybrid(USER, parse({ query: 'aeon deploy', limit: 2, offset: 1 }))

    expect(mocks.searchCore.mock.calls[0][1].limit).toBe(3)
    expect(out.hits.map((h) => h.id)).toEqual(['b', 'c'])
    expect(out).toMatchObject({ total: 3, hasMore: false })
  })

  it('caps hybrid paging at 100 so a "while offset < total" client stops', async () => {
    mocks.searchCore.mockResolvedValue({ hits: [], mode: 'hybrid', reranked: true, candidates: 900 })
    const first = await searchMemoriesHybrid(USER, parse({ query: 'aeon deploy', limit: 20, offset: 0 }))
    expect(first).toMatchObject({ total: 100, hasMore: true })
    const last = await searchMemoriesHybrid(USER, parse({ query: 'aeon deploy', limit: 20, offset: 90 }))
    expect(mocks.searchCore.mock.calls[1][1].limit).toBe(100)
    expect(last).toMatchObject({ hasMore: false })
    const beyond = await searchMemoriesHybrid(USER, parse({ query: 'aeon deploy', limit: 20, offset: 100 }))
    expect(beyond).toMatchObject({ hits: [], hasMore: false })
    expect(mocks.searchCore).toHaveBeenCalledTimes(2)
  })

  it('a Dominion browse (no query) keeps the recency path but hides machine rows', async () => {
    mocks.searchMemoriesFts.mockResolvedValue({ hits: [{ id: 'x', rank: 0 }], total: 1 })

    const out = await searchMemoriesHybrid(USER, parse({ dominionId: 'b0000000-0000-4000-8000-000000000002' }))

    expect(mocks.searchCore).not.toHaveBeenCalled()
    expect(mocks.searchMemoriesFts).toHaveBeenCalledWith(USER, expect.any(Object), { excludeStreams: MACHINE_STREAMS })
    expect(out).toMatchObject({ total: 1, retrieval: { mode: 'browse', reranked: false, confidence: null, lowConfidence: false } })
    expect(out.hits[0]).toMatchObject({ id: 'x', score: 0 })
  })
})
