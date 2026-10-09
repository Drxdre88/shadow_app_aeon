import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql, type SQL } from 'drizzle-orm'

// Graph step 1 pool expansion: link-walk SQL, signpost parsing, fair cap,
// dedupe against the pool, scope via hydrate, and the never-fail fallback.

const executed: unknown[] = []
const selectWhere: unknown[] = []
const selectOrder: unknown[] = []
let linkRows: Array<Record<string, unknown>> = []
let signpostRows: Array<Record<string, unknown>> = []
let linkThrows = false

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = (w: unknown) => {
    selectWhere.push(w)
    return chain
  }
  chain.orderBy = (o: unknown) => {
    selectOrder.push(o)
    return chain
  }
  chain.limit = () => chain
  chain.then = (resolve: (v: unknown[]) => unknown) => resolve(signpostRows)
  return {
    db: {
      select: vi.fn(() => chain),
      execute: vi.fn(async (q: unknown) => {
        executed.push(q)
        if (linkThrows) throw new Error('links walk failed')
        return { rows: linkRows }
      }),
    },
  }
})

import {
  EXPAND_CAP, LINK_EXPAND_TYPES, capFairly, citedIdsOf, expandCandidates, linkNeighbourIds, signpostCitedIds,
} from '../search-expand'
import { db } from '@/lib/db'

const dialect = new PgDialect()
const render = (q: unknown) => dialect.sqlToQuery(q as SQL)
const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

beforeEach(() => {
  vi.clearAllMocks()
  executed.length = 0
  selectWhere.length = 0
  selectOrder.length = 0
  linkRows = []
  signpostRows = []
  linkThrows = false
})

describe('citedIdsOf', () => {
  it('keeps valid uuids, lower-cased, and tolerates missing or malformed metadata', () => {
    expect(citedIdsOf({ citedMemoryIds: [id(1).toUpperCase(), 'nope', null, 7, id(2)] })).toEqual([id(1), id(2)])
    expect(citedIdsOf(null)).toEqual([])
    expect(citedIdsOf('x')).toEqual([])
    expect(citedIdsOf({})).toEqual([])
    expect(citedIdsOf({ citedMemoryIds: 'not-an-array' })).toEqual([])
  })
})

describe('capFairly', () => {
  const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => id(from + i))

  it('splits the cap evenly when both kinds overflow, links first', () => {
    const out = capFairly(many(100, 20), many(200, 20))
    expect(out).toHaveLength(EXPAND_CAP)
    expect(out.filter((e) => e.via === 'link').map((e) => e.id)).toEqual(many(100, 6))
    expect(out.filter((e) => e.via === 'signpost').map((e) => e.id)).toEqual(many(200, 6))
    expect(out[0].via).toBe('link')
  })

  it('gives unused slots to the other kind', () => {
    expect(capFairly(many(100, 2), many(200, 20)).filter((e) => e.via === 'signpost')).toHaveLength(10)
    expect(capFairly(many(100, 20), many(200, 1)).filter((e) => e.via === 'link')).toHaveLength(11)
  })

  it('an id found both ways counts once, as a link', () => {
    const out = capFairly([id(1)], [id(1), id(2)])
    expect(out).toEqual([{ id: id(1), via: 'link' }, { id: id(2), via: 'signpost' }])
  })
})

describe('linkNeighbourIds', () => {
  it('walks every seed in ONE query, both directions, over the allowed edge types', async () => {
    linkRows = [{ id: id(9), ord: 0 }, { id: 'garbage', ord: 1 }, { id: id(8).toUpperCase(), ord: 1 }]
    const out = await linkNeighbourIds('user-1', [id(1), 'not-a-uuid', id(2)])

    expect(db.execute).toHaveBeenCalledTimes(1)
    expect(out).toEqual([id(9), id(8)])
    const q = render(executed[0])
    expect(q.params).toEqual(expect.arrayContaining(['user-1', id(1), id(2), ...LINK_EXPAND_TYPES]))
    expect(q.params).not.toContain('supersedes')
    expect(q.params).not.toContain('not-a-uuid')
    expect(q.sql).toContain('UNION ALL')
    expect(q.sql).toContain("l->>'target_kind' = 'memory'")
  })

  it('runs no query without valid seeds', async () => {
    expect(await linkNeighbourIds('user-1', [])).toEqual([])
    expect(db.execute).not.toHaveBeenCalled()
  })
})

describe('signpostCitedIds', () => {
  it('orders archetypes by exact distance under the given scope and flattens their citations', async () => {
    signpostRows = [{ meta: { citedMemoryIds: [id(3), id(4)] } }, { meta: null }, { meta: { citedMemoryIds: [id(4), id(5)] } }]
    const scope = [sql`"memories"."stream_class" = ${'archetype'}`]
    const out = await signpostCitedIds(scope, '[0.1,0.2]')

    expect(out).toEqual([id(3), id(4), id(5)])
    const where = render(selectWhere[0])
    expect(where.params).toContain('archetype')
    expect(where.sql).toContain('"memories"."embedding" IS NOT NULL')
    const order = render(selectOrder[0])
    expect(order.sql).toMatch(/<=> \$\d+::vector\) \+ 0/)
    expect(order.params).toContain('[0.1,0.2]')
  })
})

describe('expandCandidates', () => {
  type R = { id: string; title: string }
  const r = (n: number): R => ({ id: id(n), title: `t${n}` })
  const base = (over: Partial<Parameters<typeof expandCandidates<R>>[0]> = {}) => ({
    userId: 'user-1',
    seedIds: [id(1), id(2)],
    pooled: new Set([id(1), id(2)]),
    known: new Map<string, R>([[id(1), r(1)], [id(2), r(2)], [id(7), r(7)]]),
    archetypeScope: [sql`TRUE`],
    vectorLiteral: '[0.1]',
    hydrate: vi.fn(async (ids: string[]) => ids.map((x) => ({ id: x, title: 'h' }))),
    ...over,
  })

  it('dedupes against the pool, reuses known rows and hydrates only new ids', async () => {
    linkRows = [{ id: id(2) }, { id: id(7) }, { id: id(10) }]
    signpostRows = [{ meta: { citedMemoryIds: [id(1), id(10), id(11)] } }]
    const input = base()
    const out = await expandCandidates(input)

    expect(out.map((e) => [e.row.id, e.via])).toEqual([[id(7), 'link'], [id(10), 'link'], [id(11), 'signpost']])
    expect(out[0].row).toBe(input.known.get(id(7)))
    expect(input.hydrate).toHaveBeenCalledWith([id(10), id(11)])
  })

  it('drops ids that fail the scope before the cap counts them', async () => {
    linkRows = Array.from({ length: 10 }, (_, i) => ({ id: id(100 + i) }))
    signpostRows = [{ meta: { citedMemoryIds: Array.from({ length: 10 }, (_, i) => id(200 + i)) } }]
    // Scope lets through only the odd ids.
    const hydrate = vi.fn(async (ids: string[]) => ids.filter((x) => Number(x.slice(-1)) % 2 === 1).map((x) => ({ id: x, title: 'h' })))
    const out = await expandCandidates(base({ hydrate }))

    expect(out).toHaveLength(10)
    expect(out.every((e) => Number(e.row.id.slice(-1)) % 2 === 1)).toBe(true)
  })

  it('caps at EXPAND_CAP', async () => {
    linkRows = Array.from({ length: 30 }, (_, i) => ({ id: id(100 + i) }))
    signpostRows = [{ meta: { citedMemoryIds: Array.from({ length: 30 }, (_, i) => id(300 + i)) } }]
    expect(await expandCandidates(base())).toHaveLength(EXPAND_CAP)
  })

  it('a failing query yields no extras and a warning, never an error', async () => {
    linkThrows = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const input = base()
    expect(await expandCandidates(input)).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[search-expand]'), 'links walk failed')
    expect(input.hydrate).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
