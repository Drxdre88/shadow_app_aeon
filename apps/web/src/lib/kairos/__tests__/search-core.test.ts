import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql, type SQL } from 'drizzle-orm'

// Shared retrieval core (Wave 1 "one search"): stream defaults, Dominion
// scope, exact filters on both legs, ranking + rerank with mocked legs.

const ftsQueue: unknown[][] = []
const vecQueue: unknown[][] = []
const ftsWhere: unknown[] = []
const vecWhere: unknown[] = []
let vectorThrows = false
let hybrid = false

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
      select: vi.fn(() => makeChain(ftsQueue.shift() ?? [], ftsWhere)),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        if (vectorThrows) throw new Error('vector index unavailable')
        return fn({
          execute: vi.fn(async () => undefined),
          select: vi.fn(() => makeChain(vecQueue.shift() ?? [], vecWhere)),
        })
      }),
    },
  }
})

vi.mock('../embeddings', () => ({
  embeddingsEnabled: () => hybrid,
  embedOne: vi.fn(async () => [0.1, 0.2]),
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

vi.mock('../rerank', () => ({ rerankScored: vi.fn(async () => null) }))

import { MACHINE_STREAMS, REAL_MEMORY_STREAMS, searchCore } from '../search-core'
import { rerankScored } from '../rerank'

const dialect = new PgDialect()
const render = (w: unknown) => dialect.sqlToQuery(w as SQL)

const NOW = new Date()
const OLD = new Date(NOW.getTime() - 60 * 86_400_000)
const A = 'a1111111-1111-4111-8111-111111111111'
const B = 'a2222222-2222-4222-8222-222222222222'
const C = 'a3333333-3333-4333-8333-333333333333'

function row(id: string, createdAt: Date, opts: { rank?: number; standing?: number | null; streamClass?: string; bodyMd?: string } = {}) {
  return {
    id,
    title: `title ${id}`,
    summary: null,
    bodyMd: opts.bodyMd ?? 'body',
    streamClass: opts.streamClass ?? 'idea',
    createdAt,
    updatedAt: createdAt,
    confidence: null,
    pinned: false,
    standing: opts.standing ?? null,
    rank: opts.rank ?? 0.1,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ftsQueue.length = 0
  vecQueue.length = 0
  ftsWhere.length = 0
  vecWhere.length = 0
  vectorThrows = false
  hybrid = false
})

describe('searchCore — scope and filters', () => {
  it('defaults to real-memory streams and never lets a machine stream in', async () => {
    await searchCore('user-1', { query: 'telegram morning message', limit: 5 })

    const q = render(ftsWhere[0])
    expect(q.params).toEqual(expect.arrayContaining([...REAL_MEMORY_STREAMS]))
    for (const machine of MACHINE_STREAMS) expect(q.params).not.toContain(machine)
    expect(q.sql).toContain('"memories"."stream_class" in')
    expect(q.sql).toContain('"memories"."superseded_at" is null')
    expect(q.sql).toContain('"memories"."archived_at" is null')
  })

  it('streams: null (includeMachine) drops the stream-class filter entirely', async () => {
    await searchCore('user-1', { query: 'nightly trace', limit: 5, streams: null })

    expect(render(ftsWhere[0]).sql).not.toContain('"memories"."stream_class" in')
  })

  it('scopes a Dominion by FK OR soft dominion: tag', async () => {
    const DOM = 'b0000000-0000-4000-8000-000000000002'
    await searchCore('user-1', { query: 'aeon deploy', limit: 5, dominionId: DOM })

    const q = render(ftsWhere[0])
    expect(q.sql).toMatch(/"memories"\."dominion_id" = \$\d+ OR "memories"\."tags" @> \$\d+::jsonb/)
    expect(q.params).toEqual(expect.arrayContaining([DOM, JSON.stringify([`dominion:${DOM}`])]))
  })

  it('applies exact filters to BOTH the FTS and the vector leg', async () => {
    hybrid = true
    const filter = sql`"memories"."type" = ${'decision'}`
    await searchCore('user-1', { query: 'auth migration', limit: 5, filters: [filter] })

    expect(render(ftsWhere[0]).params).toContain('decision')
    expect(render(vecWhere[0]).params).toContain('decision')
  })

  it('returns nothing (and runs no query) below the minimum query length', async () => {
    const out = await searchCore('user-1', { query: 'ab', limit: 5 })
    expect(out).toEqual({ hits: [], mode: 'none', reranked: false, candidates: 0 })
    expect(ftsWhere).toHaveLength(0)

    await searchCore('user-1', { query: 'ab', limit: 5, minQueryChars: 2 })
    expect(ftsWhere).toHaveLength(1)
  })
})

describe('searchCore — ranking with mocked legs', () => {
  it('FTS-only: relevance × standing — a fresh weak match beats a stale strong one', async () => {
    ftsQueue.push([row(B, OLD, { rank: 0.115 }), row(A, NOW, { rank: 0.1 })])

    const out = await searchCore('user-1', { query: 'launch plan', limit: 5 })

    expect(out.mode).toBe('fts')
    expect(out.hits.map((h) => h.row.id)).toEqual([A, B])
    expect(out.hits[0].relevance).toBe(0.1)
    expect(out.hits[0].score).toBeGreaterThan(out.hits[1].score)
  })

  it('hybrid without rerank: a vector-only row joins via RRF and standing orders the fused pool', async () => {
    hybrid = true
    ftsQueue.push([row(A, OLD, { standing: 0.1 })])
    vecQueue.push([row(C, OLD, { standing: 0.9 }), row(A, OLD, { standing: 0.1 })])

    const out = await searchCore('user-1', { query: 'launch plan', limit: 5 })

    expect(out).toMatchObject({ mode: 'hybrid', reranked: false, candidates: 2 })
    // A is in both legs (higher RRF) but C's standing 0.9 vs 0.1 wins.
    expect(out.hits.map((h) => h.row.id)).toEqual([C, A])
  })

  it('rerank: blends relevance with standing, caps the pool and clips documents', async () => {
    hybrid = true
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`c000000${i}-0000-4000-8000-000000000000`, NOW, { bodyMd: 'x'.repeat(500), rank: 0.1 - i * 0.01 }))
    ftsQueue.push(rows)
    vecQueue.push([])
    vi.mocked(rerankScored).mockImplementation(async (_q, items) =>
      (items as typeof rows).map((item, i) => ({ item, relevance: 0.1 + i * 0.1 })) as never)

    const out = await searchCore('user-1', { query: 'launch plan', limit: 20, rerankPoolMax: 3, rerankChars: 50 })

    const [, pool, toText] = vi.mocked(rerankScored).mock.calls[0]
    // Pool = max(12, min(limit, cap)) → 12 here; only 6 candidates exist.
    expect(pool).toHaveLength(6)
    expect((toText as (r: unknown) => string)(pool[0]).length).toBe(50)
    expect(out.reranked).toBe(true)
    // Highest rerank relevance (last row) leads after the blend.
    expect(out.hits[0].row.id).toBe(rows[5].id)
    expect(out.hits[0].relevance).toBeCloseTo(0.6)
  })

  it('rows past the rerank pool keep their fused order after the reranked head', async () => {
    hybrid = true
    const rows = Array.from({ length: 14 }, (_, i) =>
      row(`d0000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, NOW, { rank: 1 - i * 0.01 }))
    ftsQueue.push(rows)
    vecQueue.push([])
    vi.mocked(rerankScored).mockImplementation(async (_q, items) =>
      (items as typeof rows).map((item) => ({ item, relevance: 0.5 })) as never)

    const out = await searchCore('user-1', { query: 'launch plan', limit: 14, rerankPoolMax: 12 })

    expect(vi.mocked(rerankScored).mock.calls[0][1]).toHaveLength(12)
    expect(out.hits).toHaveLength(14)
    expect(out.hits.slice(12).map((h) => h.row.id)).toEqual([rows[12].id, rows[13].id])
  })

  it('a vector-leg failure falls back to the standing-weighted FTS order', async () => {
    hybrid = true
    vectorThrows = true
    ftsQueue.push([row(B, OLD, { rank: 0.115 }), row(A, NOW, { rank: 0.1 })])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await searchCore('user-1', { query: 'launch plan', limit: 5 })

    expect(out.mode).toBe('fts')
    expect(out.hits.map((h) => h.row.id)).toEqual([A, B])
    expect(rerankScored).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
