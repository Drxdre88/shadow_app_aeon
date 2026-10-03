import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Surprise marks: one atomic jsonb_set on engine.surprise, no read, no
// updatedAt bump, signals capped at 5.

const h = vi.hoisted(() => ({
  sets: [] as Record<string, unknown>[],
  wheres: [] as unknown[],
  returning: [] as unknown[][],
  selects: [] as unknown[],
}))

vi.mock('@/lib/db', () => {
  const update = () => {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => { h.sets.push(patch); return chain }
    chain.where = (w: unknown) => { h.wheres.push(w); return chain }
    chain.returning = () => Promise.resolve(h.returning.shift() ?? [])
    return chain
  }
  const select = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: unknown) => { h.selects.push(w); return chain }
    chain.orderBy = () => chain
    chain.limit = () => Promise.resolve([{ id: 'm1' }])
    return chain
  }
  return { db: { update: vi.fn(update), select: vi.fn(select) } }
})

import { listOpenMemoryIds, openForUpdate, surpriseMarkSql } from '../surprise-marks'

const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)
const MEM = 'a1111111-1111-4111-8111-111111111111'
const AT = '2026-10-03T09:30:00.000Z'
const signal = { kind: 'prediction_wrong' as const, ref: 'p1', at: AT, s: 0.8 }

beforeEach(() => {
  h.sets.length = 0
  h.wheres.length = 0
  h.returning.length = 0
  h.selects.length = 0
})

describe('surpriseMarkSql', () => {
  it('is a jsonb_set on {engine,surprise} that repairs parents and caps signals at 5', () => {
    const q = render(surpriseMarkSql(signal, '2026-10-04T07:00:00.000Z'))
    expect(q.sql).toContain('jsonb_set(')
    expect(q.sql).toContain(`'{engine}'`)
    expect(q.sql).toContain(`'{engine,surprise}'`)
    expect(q.sql).toMatch(/jsonb_typeof\("memories"\."source_metadata"\) = 'object'/)
    expect(q.sql).toContain('ORDER BY t.ord DESC LIMIT 5')
    expect(q.sql).toContain(`jsonb_build_object('openUntil'`)
    expect(q.sql).toContain('COLLATE "C"')
    expect(q.params).toContain(JSON.stringify(signal))
    expect(q.params).toContain('2026-10-04T07:00:00.000Z')
    expect(q.sql).not.toMatch(/updated_at/)
  })
})

describe('openForUpdate', () => {
  it('writes only sourceMetadata (never updatedAt) for the uuid ids and returns touched ids', async () => {
    h.returning.push([{ id: MEM }])
    const touched = await openForUpdate('u1', [MEM, MEM.toUpperCase(), 'not-a-uuid'], signal, new Date('2026-10-04T07:00:00.000Z'))
    expect(touched).toEqual([MEM])
    expect(h.sets).toHaveLength(1)
    expect(Object.keys(h.sets[0])).toEqual(['sourceMetadata'])
    const where = render(h.wheres[0])
    expect(where.params).toEqual(['u1', MEM])
  })

  it('skips the write entirely when no id is a uuid, and rejects a bad signal', async () => {
    expect(await openForUpdate('u1', ['x'], signal, AT)).toEqual([])
    expect(h.sets).toHaveLength(0)
    await expect(openForUpdate('u1', [MEM], { ...signal, s: 3 }, AT)).rejects.toThrow()
  })
})

describe('listOpenMemoryIds', () => {
  it('filters on openUntil > now; beliefsOnly adds the held-belief predicates', async () => {
    expect(await listOpenMemoryIds('u1', new Date(AT))).toEqual(['m1'])
    const plain = render(h.selects[0])
    expect(plain.sql).toContain(`#>> '{engine,surprise,openUntil}'`)
    expect(plain.params).toContain(AT)
    expect(plain.sql).not.toContain(`'belief'`)
    await listOpenMemoryIds('u1', new Date(AT), { beliefsOnly: true })
    const beliefs = render(h.selects[1])
    expect(beliefs.sql).toContain(`->'belief'`)
    expect(beliefs.sql).toMatch(/"superseded_at" is null/)
  })
})
