import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql, type SQL } from 'drizzle-orm'

// searchCore with the entity list (Total Recall 2a): memories mentioning an
// entity named in the query fuse as a third RRF list in hybrid and FTS-only
// mode, under the caller's full scope, tagged via 'entity' when only it found them.

const selectQueue: unknown[][] = []
const selectWhere: unknown[] = []
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
    chain.orderBy = pass
    chain.limit = pass
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

vi.mock('../search-entity', () => ({
  SEARCH_ENTITY_DEFAULT: true,
  entityLeg: vi.fn(async (input: { fetch: (m: SQL, c: SQL<number>) => Promise<unknown[]> }) =>
    entityMatches ? input.fetch(sql`EXISTS (entity mentions)`, sql<number>`(max confidence)`) : []),
}))

import { searchCore } from '../search-core'
import { entityLeg } from '../search-entity'

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
})
