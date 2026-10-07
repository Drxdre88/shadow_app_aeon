import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL } from 'drizzle-orm'

// The board Archive switch: its writer is scoped to the board's creator,
// restore removes both keys, and the list filter keeps unarchived boards.

const state = vi.hoisted(() => ({
  set: null as Record<string, unknown> | null,
  where: null as unknown,
  orderBy: [] as unknown[],
  returning: [] as unknown[],
  rows: [] as unknown[],
}))

vi.mock('@/lib/db', () => {
  const select = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: unknown) => { state.where = w; return chain }
    chain.orderBy = (...o: unknown[]) => { state.orderBy = o; return chain }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(state.rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(select),
      update: () => ({
        set: (arg: Record<string, unknown>) => {
          state.set = arg
          return {
            where: (w: unknown) => {
              state.where = w
              return { returning: async () => state.returning }
            },
          }
        },
      }),
    },
  }
})

import { findArchivedProjects, notArchivedSql, setProjectArchivedForOwner } from '../project-archive'

const dialect = new PgDialect()
const PROJECT = '40000000-0000-4000-8000-000000000001'
const OWNER = '50000000-0000-4000-8000-000000000002'
const query = (s: unknown) => dialect.sqlToQuery(s as SQL)

beforeEach(() => {
  state.set = null
  state.where = null
  state.orderBy = []
  state.rows = []
  state.returning = [{ id: PROJECT, settings: {} }]
})

describe('notArchivedSql', () => {
  it('is literal SQL with no bound params, and keeps boards with no archived key', () => {
    const q = query(notArchivedSql)
    expect(q.sql).toBe(`("projects"."settings" ->> 'archived') is distinct from 'true'`)
    expect(q.params).toEqual([])
  })
})

describe('setProjectArchivedForOwner', () => {
  it('merges archived + archivedAt and scopes the update to the board creator', async () => {
    await setProjectArchivedForOwner(PROJECT, OWNER, true)
    expect(state.set?.settings).toBeInstanceOf(SQL)
    const s = query(state.set?.settings)
    expect(s.sql).toContain(`coalesce("projects"."settings", '{}'::jsonb) ||`)
    const merged = JSON.parse(s.params[0] as string)
    expect(merged.archived).toBe(true)
    expect(Number.isNaN(Date.parse(merged.archivedAt))).toBe(false)
    const w = query(state.where)
    expect(w.sql).toContain('"projects"."user_id" = $')
    expect(w.params).toEqual([PROJECT, OWNER])
  })

  it('restore removes both keys and nothing else', async () => {
    await setProjectArchivedForOwner(PROJECT, OWNER, false)
    const s = query(state.set?.settings)
    expect(s.sql).toContain(`- 'archived' - 'archivedAt'`)
    expect(s.sql).not.toContain('||')
    expect(s.params).toEqual([])
  })

  it('returns null when the caller did not create the board', async () => {
    state.returning = []
    expect(await setProjectArchivedForOwner(PROJECT, OWNER, true)).toBeNull()
  })
})

describe('findArchivedProjects', () => {
  it('lists the creator’s archived boards, newest archive first', async () => {
    state.rows = [
      { id: 'b', name: 'Beta', settings: { archived: true, archivedAt: '2026-10-07T10:00:00.000Z' } },
      { id: 'a', name: 'Alpha', settings: { archived: true } },
    ]
    expect(await findArchivedProjects(OWNER)).toEqual([
      { id: 'b', name: 'Beta', archivedAt: '2026-10-07T10:00:00.000Z' },
      { id: 'a', name: 'Alpha', archivedAt: null },
    ])
    const w = query(state.where)
    expect(w.sql).toContain(`("projects"."settings" ->> 'archived') = 'true'`)
    expect(w.params).toEqual([OWNER])
    expect(query(state.orderBy[0]).sql).toContain(`->> 'archivedAt') desc nulls last`)
  })
})
