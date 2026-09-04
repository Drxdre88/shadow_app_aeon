import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Restoring a card from the vault must put it in a column, or the board can
// never show it (0409: "Team Meeting" came back with column_id NULL and the
// owner reported the card lost). The FIRST column by order is the target —
// the restore resets status to todo, and the vault's column_name is the
// Done column the card was completed in — and the order index appends to
// that column's own numbering, all inside the one transaction.

const insertValues: Record<string, unknown>[] = []
const txSelects: { orderBy: SQL[]; where: SQL[] }[] = []
let columns: { id: string }[] = []

vi.mock('@/lib/db', () => {
  function insertChain() {
    const chain: Record<string, unknown> = {}
    chain.values = (values: Record<string, unknown>) => {
      insertValues.push(values)
      return chain
    }
    chain.returning = () => Promise.resolve([{ id: 'restored', ...insertValues[insertValues.length - 1] }])
    return chain
  }
  function deleteChain() {
    const chain: Record<string, unknown> = {}
    chain.where = () => Promise.resolve()
    return chain
  }
  // Outside the transaction: the vault row. Inside, in order: the first
  // column, then the max order index in that column.
  function vaultSelectChain() {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([{ id: 'vault-1', projectId: 'p', name: 'Team Meeting', description: null, priority: 'medium', color: 'red', size: null, metadata: {} }])
    return chain
  }
  function txSelectChain() {
    const record = { orderBy: [] as SQL[], where: [] as SQL[] }
    txSelects.push(record)
    const call = txSelects.length - 1
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: SQL) => { record.where.push(w); return chain }
    chain.orderBy = (o: SQL) => { record.orderBy.push(o); return chain }
    chain.limit = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(call % 2 === 0 ? columns : [{ max: 5 }])
    return chain
  }
  const tx = {
    select: vi.fn(() => txSelectChain()),
    insert: vi.fn(() => insertChain()),
    delete: vi.fn(() => deleteChain()),
  }
  return {
    db: {
      select: vi.fn(() => vaultSelectChain()),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  }
})

vi.mock('../projects', () => ({ touchProject: vi.fn() }))

import { restoreFromVault } from '../vault'

const render = (s: SQL) => new PgDialect().sqlToQuery(s).sql

beforeEach(() => {
  insertValues.length = 0
  txSelects.length = 0
})

describe('restoreFromVault', () => {
  it('lands the restored card in the first column by order, status todo, appended to that column', async () => {
    columns = [{ id: 'col-backlog' }]
    const restored = await restoreFromVault('vault-1', 'p')

    expect(txSelects).toHaveLength(2)
    expect(render(txSelects[0].orderBy[0])).toMatch(/"order_index" asc$/)
    expect(render(txSelects[1].where[0])).toContain('"column_id"')

    expect(insertValues).toHaveLength(1)
    expect(insertValues[0]).toMatchObject({ projectId: 'p', columnId: 'col-backlog', name: 'Team Meeting', status: 'todo', orderIndex: 6 })
    expect(restored).toMatchObject({ columnId: 'col-backlog' })
  })

  it('still restores when the board has no columns yet, with a project-wide order index', async () => {
    columns = []
    await restoreFromVault('vault-1', 'p')
    expect(render(txSelects[1].where[0])).not.toContain('"column_id"')
    expect(insertValues[0]).toMatchObject({ columnId: null, name: 'Team Meeting', orderIndex: 6 })
  })
})
