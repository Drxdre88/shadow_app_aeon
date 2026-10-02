import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Same-day watched-board cards (kind 'board_card_done', streamClass agentic,
// type achievement) are not belief signals: the nightly board_day page is.

const captured = vi.hoisted(() => ({ where: null as unknown }))

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'orderBy', 'limit']) chain[m] = () => chain
  chain.where = (w: unknown) => { captured.where = w; return chain }
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve([]).then(res)
  return { db: { select: () => chain } }
})
vi.mock('@/lib/data/memories', async () => {
  const { sql } = await import('drizzle-orm')
  return { validAsOfNow: sql`true` }
})

import { listOperatorSignals, originKindSqlOf } from '../belief-inputs'

const dialect = new PgDialect()

describe('belief signals and board_card_done', () => {
  it('selects reflections and board_day pages only — never a same-day card row', async () => {
    await listOperatorSignals('user-1', null)
    const where = dialect.sqlToQuery(captured.where as SQL).sql
    expect(where).toContain("->>'kind' = 'board_day')")
    expect(where).not.toMatch(/->>'kind' = 'board_card_done'/)
    expect(where).not.toMatch(/"stream_class" = 'agentic'/)
  })

  it('keeps the SQL origin twin in step with origin.ts', async () => {
    const { sql } = await import('drizzle-orm')
    const rendered = dialect.sqlToQuery(originKindSqlOf(sql.raw('source'), sql.raw('meta'))).sql
    expect(rendered).toMatch(/IN \([^)]*'board_card_done'[^)]*\) THEN 'activity'/)
  })
})
