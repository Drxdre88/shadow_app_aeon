import { describe, it, expect, beforeEach, vi } from 'vitest'

// Restoring a card from the vault must put it in a column, or the board can
// never show it (0409: "Team Meeting" came back with column_id NULL and the
// owner reported the card lost). The first column by order is the target —
// the restore resets status to todo, and the vault's column_name is the
// Done column the card was completed in.

const insertValues: Record<string, unknown>[] = []
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
  // Three selects in restoreFromVault, in order: the vault row, the max
  // order index, the first column.
  let selectCount = 0
  function selectChain() {
    const call = selectCount++
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => {
      if (call % 3 === 0) return resolve([{ id: 'vault-1', projectId: 'p', name: 'Team Meeting', description: null, priority: 'medium', color: 'red', size: null, metadata: {} }])
      if (call % 3 === 1) return resolve([{ max: 5 }])
      return resolve(columns)
    }
    return chain
  }
  const tx = {
    insert: vi.fn(() => insertChain()),
    delete: vi.fn(() => deleteChain()),
  }
  return {
    db: {
      select: vi.fn(() => selectChain()),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  }
})

vi.mock('../projects', () => ({ touchProject: vi.fn() }))

import { restoreFromVault } from '../vault'

beforeEach(() => {
  insertValues.length = 0
})

describe('restoreFromVault', () => {
  it('lands the restored card in the board\'s first column, status todo, at the end of the order', async () => {
    columns = [{ id: 'col-backlog' }]
    const restored = await restoreFromVault('vault-1', 'p')
    expect(insertValues).toHaveLength(1)
    expect(insertValues[0]).toMatchObject({ projectId: 'p', columnId: 'col-backlog', name: 'Team Meeting', status: 'todo', orderIndex: 6 })
    expect(restored).toMatchObject({ columnId: 'col-backlog' })
  })

  it('still restores when the board has no columns yet', async () => {
    columns = []
    await restoreFromVault('vault-1', 'p')
    expect(insertValues[0]).toMatchObject({ columnId: null, name: 'Team Meeting' })
  })
})
