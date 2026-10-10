import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql, type SQL } from 'drizzle-orm'

// searchCore with the entity list (Total Recall 2a): memories mentioning an
// entity named in the query join the rerank input in hybrid mode and trail the
// FTS rows in FTS-only mode, never re-ordering what the legs found, under the
// caller's full scope, tagged via 'entity' when only the list found them.

const selectQueue: unknown[][] = []
const selectWhere: unknown[] = []
const selectOrder: unknown[][] = []
const selectLimit: unknown[] = []
const vecQueue: unknown[][] = []
let hybrid = true
let entityMatches = true

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[], sink: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = (w: unknown) => {
      sink.push(w)
      return chain
    }
    chain.orderBy = (...o: unknown[]) => {
      if (sink === selectWhere) selectOrder.push(o)
      return chain
    }
    chain.limit = (n: unknown) => {
      if (sink === selectWhere) selectLimit.push(n)
      return chain
    }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [], selectWhere)),
      execute: vi.fn(async () => ({ rows: [] })),
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

vi.mock('../search-entity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../search-entity')>()),
  SEARCH_ENTITY_DEFAULT: true,
  entityLeg: vi.fn(async (input: { fetch: (m: SQL, cap: number) => Promise<unknown[]> }) =>
    entityMatches ? input.fetch(sql`EXISTS (entity mentions)`, 8) : []),
}))

import { searchCore } from '../search-core'
import { entityLeg } from '../search-entity'
import { rerankScored } from '../rerank'

const dialect = new PgDialect()
const render = (w: unknown) => dialect.sqlToQuery(w as SQL)
const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
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
const NAMED = row(3)

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  selectWhere.length = 0
  selectOrder.length = 0
  selectLimit.length = 0
  vecQueue.length = 0
  hybrid = true
  entityMatches = true
})

describe('searchCore — entity list', () => {
  it('hybrid: fuses entity rows as a third list and tags entity-only rows', async () => {
    selectQueue.push([A, B])
    vecQueue.push([B])
    selectQueue.push([B, NAMED])

    const out = await searchCore('user-1', { query: 'what broke in Wraith', limit: 10, expand: false })

    expect(out.mode).toBe('hybrid')
    const via = Object.fromEntries(out.hits.map((h) => [h.row.id, h.via]))
    expect(via).toEqual({ [A.id]: 'search', [B.id]: 'search', [NAMED.id]: 'entity' })
    expect(out.hits[0].row.id).toBe(B.id)
    expect(out.candidates).toBe(3)
  })

  it('the entity fetch carries the same scope, filters and window as the legs', async () => {
    selectQueue.push([A])
    vecQueue.push([])
    selectQueue.push([NAMED])
    const filter = sql`"memories"."type" = ${'decision'}`

    await searchCore('user-1', {
      query: 'Wraith outage', limit: 5, expand: false, dominionId: DOM, filters: [filter],
      window: { days: 90, exempt: ['concept'] },
    })

    const q = render(selectWhere[1])
    expect(q.sql).toContain('EXISTS (entity mentions)')
    expect(q.params).toEqual(expect.arrayContaining(['user-1', DOM, 'decision', 90, 'concept', 'idea']))
    expect(q.sql).toContain('"memories"."archived_at" is null')
    expect(q.sql).toContain('"memories"."superseded_at" is null')
    expect(q.sql).toContain('sensitiveHeld')
  })

  it('FTS-only mode still fuses the entity list', async () => {
    hybrid = false
    selectQueue.push([A])
    selectQueue.push([NAMED])

    const out = await searchCore('user-1', { query: 'Wraith outage', limit: 5 })

    expect(out.mode).toBe('fts')
    expect(out.hits.map((h) => [h.row.id, h.via])).toEqual([[A.id, 'search'], [NAMED.id, 'entity']])
    expect(out.candidates).toBe(2)
  })

  it('no entity named: FTS-only result keeps ts_rank relevance exactly as before', async () => {
    hybrid = false
    entityMatches = false
    selectQueue.push([A, B])

    const out = await searchCore('user-1', { query: 'launch plan', limit: 5 })

    expect(out.hits.map((h) => h.relevance)).toEqual([0.3, 0.2])
    expect(out.hits.every((h) => h.via === 'search')).toBe(true)
  })

  it('entity=false skips the list entirely', async () => {
    selectQueue.push([A])
    vecQueue.push([])
    await searchCore('user-1', { query: 'Wraith outage', limit: 5, expand: false, entity: false })
    expect(entityLeg).not.toHaveBeenCalled()
  })

  it('a late hybrid failure falls back to FTS reusing the one entity lookup', async () => {
    selectQueue.push([A])
    vecQueue.push([])
    selectQueue.push([NAMED])
    vi.mocked(rerankScored).mockRejectedValueOnce(new Error('rerank exploded'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await searchCore('user-1', { query: 'Wraith outage', limit: 5, expand: false })

    expect(entityLeg).toHaveBeenCalledTimes(1)
    expect(out.mode).toBe('fts')
    expect(out.hits.map((h) => [h.row.id, h.via])).toEqual([[A.id, 'search'], [NAMED.id, 'entity']])
    warn.mockRestore()
  })
})

describe('searchCore — entity list tuning', () => {
  const orderSql = (i: number) => selectOrder[i].map((o) => render(o).sql).join(' , ')

  it('hybrid orders the capped list by query-vector distance, off the HNSW index', async () => {
    selectQueue.push([A])
    vecQueue.push([])
    selectQueue.push([NAMED])

    await searchCore('user-1', { query: 'Wraith outage', limit: 10, expand: false })

    expect(selectLimit[1]).toBe(8)
    const order = orderSql(1)
    expect(order).toMatch(/^\("memories"\."embedding" <=> \$\d+::vector\) \+ 0 ASC NULLS LAST/)
    expect(order).toContain("replace(plainto_tsquery('english', $")
    expect(order).not.toContain('confidence')
  })

  it('FTS-only mode leaves the FTS order alone; entity-only rows trail on the ts_rank scale', async () => {
    hybrid = false
    const close = row(4, 0.25)
    selectQueue.push([A, close])
    selectQueue.push([close, row(5, 9)])

    const out = await searchCore('user-1', { query: 'Wraith outage', limit: 5 })

    expect(out.hits.map((h) => [h.row.id, h.via])).toEqual([[A.id, 'search'], [close.id, 'search'], [id(5), 'entity']])
    expect(out.hits.map((h) => Number(h.relevance.toFixed(3)))).toEqual([0.3, 0.25, 0.1])
    expect(out.candidates).toBe(3)
  })

  it('FTS-only mode orders the list by full-query FTS rank, then any-term rank', async () => {
    hybrid = false
    selectQueue.push([A])
    selectQueue.push([NAMED])

    await searchCore('user-1', { query: 'Wraith outage', limit: 5 })

    const order = orderSql(1)
    expect(order).toMatch(/^ts_rank_cd\("memories"\."fts", websearch_to_tsquery\('english', \$\d+\)\) desc , ts_rank_cd\("memories"\."fts", replace\(plainto_tsquery/)
    expect(order).not.toContain('<=>')
  })

  it('FTS-only mode: an entity-only row trails every FTS row, even when the list ranks it first', async () => {
    hybrid = false
    const legRows = Array.from({ length: 30 }, (_, i) => row(10 + i, 0.5 - i * 0.01))
    selectQueue.push(legRows)
    selectQueue.push([NAMED, legRows[29]])

    const out = await searchCore('user-1', { query: 'Wraith outage', limit: 40 })

    expect(out.hits.slice(0, 30).map((h) => h.row.id)).toEqual(legRows.map((r) => r.id))
    expect(out.hits.at(-1)?.row.id).toBe(NAMED.id)
    expect(out.hits.at(-1)?.via).toBe('entity')
  })

  it('FTS-only mode with no FTS match returns the entity rows alone', async () => {
    hybrid = false
    selectQueue.push([])
    selectQueue.push([NAMED])

    const out = await searchCore('user-1', { query: 'Wraith outage', limit: 5 })

    expect(out.hits.map((h) => [h.row.id, h.via, h.relevance])).toEqual([[NAMED.id, 'entity', 0.4]])
  })

  it('hybrid never re-orders the fused list; entity rows outside the pool join the rerank input', async () => {
    const fts = Array.from({ length: 6 }, (_, i) => row(20 + i, 0.5 - i * 0.01))
    const vec = Array.from({ length: 6 }, (_, i) => row(40 + i))
    selectQueue.push(fts)
    vecQueue.push(vec)
    selectQueue.push([fts[5], NAMED])

    const out = await searchCore('user-1', { query: 'Wraith outage', limit: 13, expand: false })

    const docs = vi.mocked(rerankScored).mock.calls[0][1] as Array<{ id: string }>
    expect(docs).toHaveLength(13)
    expect(docs.at(-1)?.id).toBe(NAMED.id)
    const fused = [fts[0], vec[0], fts[1], vec[1], fts[2], vec[2], fts[3], vec[3], fts[4], vec[4], fts[5], vec[5]]
    expect(out.hits.map((h) => h.row.id)).toEqual([...fused.map((r) => r.id), NAMED.id])
    expect(out.hits.at(-1)?.via).toBe('entity')
    expect(out.hits.filter((h) => h.via === 'entity')).toHaveLength(1)
  })

  it('reranked: an entity row the cross-encoder favours leads, tagged via entity', async () => {
    selectQueue.push([A])
    vecQueue.push([B])
    selectQueue.push([NAMED])
    vi.mocked(rerankScored).mockImplementationOnce(async (_q, items) =>
      (items as Array<{ id: string }>).map((item) => ({ item, relevance: item.id === NAMED.id ? 0.9 : 0.2 })) as never)

    const out = await searchCore('user-1', { query: 'Wraith outage', limit: 5, expand: false })

    expect(out.reranked).toBe(true)
    expect(out.hits[0]).toMatchObject({ row: { id: NAMED.id }, via: 'entity' })
    expect(out.candidates).toBe(3)
  })
})