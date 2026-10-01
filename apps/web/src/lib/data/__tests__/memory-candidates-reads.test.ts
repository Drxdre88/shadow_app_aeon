import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// memory-candidates read filters (docs/kairos/34 §2-§3), locked by rendering
// the captured WHERE clause:
//   - BackUp candidates never include operator-decision proposals (review
//     actions, constitution amendments) — evidence must not promote/decay them;
//   - the daily message's "promoted beliefs" only counts engine promotions
//     (step 'backup'), never belief-ledger or constitution 'promote' ops.

const captured: { where?: unknown; limit?: number } = {}
let rows: unknown[] = []

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  const pass = () => chain
  chain.from = pass
  chain.innerJoin = pass
  chain.orderBy = pass
  chain.where = (w: unknown) => {
    captured.where = w
    return chain
  }
  chain.limit = (n: number) => {
    captured.limit = n
    return Promise.resolve(rows)
  }
  return { db: { select: vi.fn(() => chain) } }
})

import { listPendingProposalCandidates, listPromotedBeliefsBetween } from '../memory-candidates'

const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)

beforeEach(() => {
  captured.where = undefined
  captured.limit = undefined
  rows = []
})

describe('listPendingProposalCandidates', () => {
  it('excludes review_action and constitution_amendment kinds (and contradiction notices)', async () => {
    await listPendingProposalCandidates('user-1', 25)

    const where = render(captured.where)
    expect(where.sql).toContain(`->>'kind', '') NOT IN ('review_action', 'constitution_amendment')`)
    expect(where.sql).toContain(`->>'introspection' = 'true'`)
    expect(where.sql).toContain(`->>'status' = 'pending'`)
    expect(where.sql).toContain(`->>'contradictionCheck', 'false') <> 'true'`)
    expect(where.params).toEqual(expect.arrayContaining(['user-1', 'inbound']))
    expect(captured.limit).toBe(25)
  })

  it('normalises a null sourceMetadata to an object', async () => {
    rows = [{ id: 'p-1', sourceMetadata: null }]
    await expect(listPendingProposalCandidates('user-1', 5)).resolves.toEqual([{ id: 'p-1', sourceMetadata: {} }])
  })
})

describe('listPromotedBeliefsBetween', () => {
  it("counts only un-reverted engine promotions (step 'backup') inside the window", async () => {
    const start = new Date('2026-09-30T08:00:00.000Z')
    const end = new Date('2026-10-01T08:00:00.000Z')

    await listPromotedBeliefsBetween('user-1', start, end, 3)

    const where = render(captured.where)
    expect(where.sql).toContain('"memory_ops"."step" = $')
    expect(where.params).toContain('backup')
    expect(where.params).toContain('promote')
    expect(where.params).not.toContain('beliefs')
    expect(where.params).not.toContain('constitution')
    expect(where.sql).toContain('"memory_ops"."reverted_at" is null')
    expect(where.params).toEqual(expect.arrayContaining([start.toISOString(), end.toISOString()]))
    expect(captured.limit).toBe(3)
  })

  it('prefers the AI title', async () => {
    rows = [{ opId: 'op-1', memoryId: 'm-1', title: 'raw', aiTitle: 'Nice title' }, { opId: 'op-2', memoryId: 'm-2', title: 'raw2', aiTitle: null }]
    await expect(listPromotedBeliefsBetween('user-1', new Date(0), new Date(1), 3)).resolves.toEqual([
      { opId: 'op-1', memoryId: 'm-1', title: 'Nice title' },
      { opId: 'op-2', memoryId: 'm-2', title: 'raw2' },
    ])
  })
})
