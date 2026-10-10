import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql, type SQL } from 'drizzle-orm'

// searchCore with the opt-in pool expansion (graph step 1): off = no extra
// queries; on = link + signpost extras under the full scope, tagged `via`,
// judged by the reranker, trailing the fused order when rerank is down.

const selectQueue: unknown[][] = []
const selectWhere: unknown[] = []
const vecQueue: unknown[][] = []
let linkRows: Array<Record<string, unknown>> = []
let linkThrows = false
let hybrid = true

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[], sink: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = (w: unknown) => {
      sink.push(w)
      return chain
    }
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [], selectWhere)),
      execute: vi.fn(async () => {
        if (linkThrows) throw new Error('links walk failed')
        return { rows: linkRows }
      }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
        execute: vi.fn(async () => undefined),
        select: vi.fn(() => makeChain(vecQueue.shift() ?? [], [])),
      })),
    },
  }
})

vi.mock('../embeddings', () => ({
  embeddingsEnabled: () => hybrid,
  embedOne: vi.fn(async () => [0.1, 0.2]),
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

vi.mock('../rerank', () => ({ rerankScored: vi.fn(async () => null) }))

vi.mock('../search-entity', () => ({ SEARCH_ENTITY_DEFAULT: true, entityLeg: vi.fn(async () => []) }))

import { searchCore } from '../search-core'
import { rerankScored } from '../rerank'
import { db } from '@/lib/db'

const dialect = new PgDialect()
const render = (w: unknown) => dialect.sqlToQuery(w as SQL)
const id = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const NOW = new Date()
const DOM = 'b0000000-0000-4000-8000-000000000002'

function row(n: number, rank = 0.1) {
  return {
    id: id(n), title: `t${n}`, summary: null, bodyMd: 'body', streamClass: 'idea',
    createdAt: NOW, updatedAt: NOW, confidence: null, pinned: false, standing: null, rank,
  }
}

const A = row(1, 0.3)
const B = row(2, 0.2)
const LINKED = row(10)
const CITED = row(11)

// Call order: FTS select, vector txn, then links execute ∥ signpost select,
// then the hydrate select.
function queueExpansion() {
  selectQueue.push([A, B])
  vecQueue.push([])
  linkRows = [{ id: A.id }, { id: LINKED.id }]
  selectQueue.push([{ meta: { citedMemoryIds: [B.id, CITED.id, 'junk'] } }])
  selectQueue.push([LINKED, CITED])
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  selectWhere.length = 0
  vecQueue.length = 0
  linkRows = []
  linkThrows = false
  hybrid = true
  vi.mocked(rerankScored).mockImplementation(async () => null)
})

describe('searchCore — expand off', () => {
  it.each([undefined, false])('expand=%s runs no extra query and tags every hit search', async (expand) => {
    selectQueue.push([A, B])
    vecQueue.push([])
    const out = await searchCore('user-1', { query: 'launch plan', limit: 5, expand })

    expect(db.select).toHaveBeenCalledTimes(1)
    expect(db.execute).not.toHaveBeenCalled()
    expect(out.hits.map((h) => h.via)).toEqual(['search', 'search'])
    expect(out.candidates).toBe(2)
  })

  it('FTS-only mode skips expansion even when asked', async () => {
    hybrid = false
    selectQueue.push([A])
    const out = await searchCore('user-1', { query: 'launch plan', limit: 5, expand: true })

    expect(db.select).toHaveBeenCalledTimes(1)
    expect(db.execute).not.toHaveBeenCalled()
    expect(out.hits.map((h) => h.via)).toEqual(['search'])
  })
})

describe('searchCore — expand on', () => {
  it('reranks extras alongside the pool and tags them link / signpost', async () => {
    queueExpansion()
    vi.mocked(rerankScored).mockImplementation(async (_q, items) =>
      (items as Array<{ id: string }>).map((item) => ({ item, relevance: item.id === CITED.id ? 0.9 : 0.5 })) as never)

    const out = await searchCore('user-1', { query: 'launch plan', limit: 10, expand: true })

    const pool = vi.mocked(rerankScored).mock.calls[0][1] as Array<{ id: string }>
    expect(pool.map((r) => r.id)).toEqual([A.id, B.id, LINKED.id, CITED.id])
    expect(out.hits[0]).toMatchObject({ via: 'signpost', relevance: 0.9 })
    expect(out.hits[0].row.id).toBe(CITED.id)
    const via = Object.fromEntries(out.hits.map((h) => [h.row.id, h.via]))
    expect(via).toEqual({ [A.id]: 'search', [B.id]: 'search', [LINKED.id]: 'link', [CITED.id]: 'signpost' })
    expect(out.candidates).toBe(4)
  })

  it('extras pass the same scope, filters and window as the main legs', async () => {
    queueExpansion()
    const filter = sql`"memories"."type" = ${'decision'}`
    await searchCore('user-1', {
      query: 'launch plan', limit: 10, expand: true, dominionId: DOM, filters: [filter],
      window: { days: 90, exempt: ['concept'] },
    })

    // [0] FTS, [1] signpost archetypes, [2] hydrate.
    const signpost = render(selectWhere[1])
    expect(signpost.params).toEqual(expect.arrayContaining(['user-1', DOM, 'archetype']))
    expect(signpost.sql).toContain('"memories"."superseded_at" is null')

    const hydrate = render(selectWhere[2])
    expect(hydrate.params).toEqual(expect.arrayContaining(['user-1', DOM, 'decision', 90, 'concept', 'idea', LINKED.id, CITED.id]))
    expect(hydrate.params).not.toContain(A.id)
    expect(hydrate.params).not.toContain(B.id)
    expect(hydrate.sql).toContain('"memories"."stream_class" in')
    expect(hydrate.sql).toContain('"memories"."archived_at" is null')
    expect(hydrate.sql).toContain('make_interval')
  })

  it('without rerank, extras trail the fused ranking and never push out an original hit', async () => {
    queueExpansion()
    const full = await searchCore('user-1', { query: 'launch plan', limit: 10, expand: true })
    expect(full.reranked).toBe(false)
    expect(full.hits.map((h) => [h.row.id, h.via])).toEqual([
      [A.id, 'search'], [B.id, 'search'], [LINKED.id, 'link'], [CITED.id, 'signpost'],
    ])

    queueExpansion()
    const tight = await searchCore('user-1', { query: 'launch plan', limit: 2, expand: true })
    expect(tight.hits.map((h) => h.row.id)).toEqual([A.id, B.id])
  })

  it('an expansion failure keeps the unexpanded hybrid result', async () => {
    queueExpansion()
    linkThrows = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await searchCore('user-1', { query: 'launch plan', limit: 10, expand: true })

    expect(out.mode).toBe('hybrid')
    expect(out.hits.map((h) => h.row.id)).toEqual([A.id, B.id])
    expect(out.candidates).toBe(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[search-expand]'), 'links walk failed')
    warn.mockRestore()
  })
})
