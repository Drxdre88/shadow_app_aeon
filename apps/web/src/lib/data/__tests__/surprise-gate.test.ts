import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Surprise gate data access: SQL shape only (no real DB).

const state = vi.hoisted(() => ({ calls: [] as Array<{ kind: string; arg?: unknown; where?: unknown }>, rows: [] as unknown[] }))

vi.mock('@/lib/db', () => {
  const chain = (call: { kind: string; arg?: unknown; where?: unknown }) => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'limit', 'orderBy', 'returning']) c[m] = () => c
    c.set = (arg: unknown) => { call.arg = arg; return c }
    c.where = (w: unknown) => { call.where = w; return c }
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(state.rows).then(res)
    return c
  }
  const db = {
    select: (arg: unknown) => { const call = { kind: 'select', arg }; state.calls.push(call); return chain(call) },
    update: () => { const call = { kind: 'update' }; state.calls.push(call); return chain(call) },
  }
  return { db }
})
vi.mock('@/lib/data/memories', async () => {
  const { sql } = await import('drizzle-orm')
  return { validAsOfNow: sql`true` }
})
vi.mock('@/lib/data/memory-ops', () => ({ insertMemoryOps: vi.fn() }))

import { clearSurprisePressure, listProvenanceNeighbours, matchHeldBeliefsByText, pruneSurpriseMarks } from '../surprise-gate'
import { listOpenAlignedBeliefs } from '../belief-recheck'

const dialect = new PgDialect()
const q = (s: unknown) => dialect.sqlToQuery(s as SQL)
const NOW = new Date('2026-10-03T02:00:00.000Z')

beforeEach(() => {
  state.calls.length = 0
  state.rows = []
})

describe('surprise-gate data', () => {
  it('prune: drops stale signals/pressure in one jsonb statement and never sets updatedAt', async () => {
    state.rows = [{ id: 'x' }]
    expect(await pruneSurpriseMarks('u', NOW, 14 * 86_400_000)).toBe(1)
    const call = state.calls[0]
    expect(Object.keys(call.arg as object)).toEqual(['sourceMetadata'])
    const set = q((call.arg as { sourceMetadata: SQL }).sourceMetadata)
    expect(set.sql).toContain("#- '{engine,surprise}'")
    expect(set.params).toContain('2026-09-19T02:00:00.000Z')
  })

  it('clear pressure removes only the pressure key', async () => {
    expect(await clearSurprisePressure('u', [])).toBe(0)
    state.rows = [{ id: 'a' }]
    await clearSurprisePressure('u', ['a'])
    expect(q((state.calls[0].arg as { sourceMetadata: SQL }).sourceMetadata).sql).toContain("#- '{engine,surprise,pressure}'")
  })

  it('full-text match ORs only sanitised terms, ranks normalised, no embedding', async () => {
    expect(await matchHeldBeliefsByText('u', ['bad term', "x'); drop"])).toEqual([])
    expect(state.calls).toHaveLength(0)
    state.rows = [{ id: 'b-1', rank: '0.5' }]
    expect(await matchHeldBeliefsByText('u', ['evenings', 'deep'])).toEqual([{ id: 'b-1', rank: 0.5 }])
    const where = q(state.calls[0].where)
    expect(where.sql).toContain('"memories"."fts" @@ to_tsquery')
    expect(where.params).toContain('evenings | deep')
  })

  it('neighbours query provenance overlap and exclude the replaced pair', async () => {
    expect(await listProvenanceNeighbours('u', [], [])).toEqual([])
    await listProvenanceNeighbours('u', ['m-1'], ['old'])
    const where = q(state.calls[0].where)
    expect(where.sql).toContain('?| ARRAY[')
    expect(where.params).toEqual(expect.arrayContaining(['m-1', 'old']))
  })

  it('listOpenAlignedBeliefs: open at now, unflagged, not retire-vetoed', async () => {
    expect(await listOpenAlignedBeliefs('u', NOW, 0)).toEqual([])
    state.rows = [{ id: 'o-1', sourceMetadata: { belief: { v: 1, mind: 'aligned', domain: 'general', dominionId: null, claim: 'c', reasons: [], falsifier: 'f', sourceType: 'tool', provenance: ['m'], status: 'held', confidence: 0.6 } } }, { id: 'junk', sourceMetadata: {} }]
    const out = await listOpenAlignedBeliefs('u', NOW, 5)
    expect(out.map((o) => o.id)).toEqual(['o-1'])
    const where = q(state.calls[0].where)
    expect(where.sql).toContain(`#>> '{engine,surprise,openUntil}'`)
    expect(where.sql).toContain("'recheck') IS NULL")
    expect(where.params).toContain(NOW.toISOString())
  })
})
