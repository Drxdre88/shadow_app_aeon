import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// get_entity lists only live, valid-now, unheld memories that mention it.

const selectQueue: unknown[][] = []
const selectWhere: unknown[] = []

vi.mock('@/lib/db', () => {
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {}
    const pass = () => c
    Object.assign(c, { from: pass, innerJoin: pass, orderBy: pass, limit: pass })
    c.where = (w: unknown) => {
      selectWhere.push(w)
      return c
    }
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return c
  }
  return { db: { select: vi.fn(() => chain(selectQueue.shift() ?? [])) } }
})

import { getEntity } from '../queries'

const dialect = new PgDialect()
const ENTITY = 'a0000000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  selectWhere.length = 0
})

describe('getEntity', () => {
  it('filters mentioning memories by liveness, valid time and the privacy hold', async () => {
    selectQueue.push([{ id: ENTITY, kind: 'repo', name: 'Wraith' }])
    selectQueue.push([{ alias: 'wraith', source: 'seed' }])
    selectQueue.push([{ memoryId: 'm1', title: 't', source: 'dict', confidence: 0.7 }])

    const out = await getEntity('u1', { id: ENTITY, mentions: 10 })

    expect(out?.recentMentions).toHaveLength(1)
    const q = dialect.sqlToQuery(selectWhere[2] as SQL)
    expect(q.sql).toContain('"memories"."archived_at" is null')
    expect(q.sql).toContain('"memories"."superseded_at" is null')
    expect(q.sql).toContain('"memories"."invalid_at" IS NULL OR "memories"."invalid_at" > NOW()')
    expect(q.sql).toContain("'sensitiveHeld'")
    expect(q.params).toEqual(expect.arrayContaining([ENTITY, 'u1']))
  })

  it('returns null for an unknown entity', async () => {
    expect(await getEntity('u1', { id: 'Nobody', mentions: 10 })).toBeNull()
  })
})
