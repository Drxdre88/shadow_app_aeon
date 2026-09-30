import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Kairos card_notes answers for vaulted cards land on task_vault.description.
// The read-modify-write runs under a row lock, scoped to (vault id, project)
// like every other vault query, and only a real write bumps the project.

const state = {
  row: null as { description: string | null } | null,
  selectWhere: [] as SQL[],
  locked: false,
  updates: [] as { set: Record<string, unknown>; where: SQL }[],
}

vi.mock('@/lib/db', () => {
  const tx = {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.where = (w: SQL) => { state.selectWhere.push(w); return chain }
      chain.for = (mode: string) => {
        state.locked = mode === 'update'
        return Promise.resolve(state.row ? [state.row] : [])
      }
      return chain
    }),
    update: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      let set: Record<string, unknown> = {}
      chain.set = (values: Record<string, unknown>) => { set = values; return chain }
      chain.where = (where: SQL) => { state.updates.push({ set, where }); return Promise.resolve() }
      return chain
    }),
  }
  return {
    db: { transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) },
  }
})

vi.mock('../projects', () => ({ touchProject: vi.fn() }))
vi.mock('../attachments', () => ({ assertAttachmentLossAcknowledged: vi.fn() }))

import { touchProject } from '../projects'
import { updateVaultDescription } from '../vault'

const render = (s: SQL) => new PgDialect().sqlToQuery(s)

beforeEach(() => {
  vi.clearAllMocks()
  state.row = null
  state.selectWhere = []
  state.locked = false
  state.updates = []
})

describe('updateVaultDescription', () => {
  it('locks the scoped row, writes the composed text, and bumps the project', async () => {
    state.row = { description: 'Old' }
    const compose = vi.fn((existing: string | null) => `${existing}\n\nnote`)

    await expect(updateVaultDescription('vault-1', 'proj-1', compose)).resolves.toBe('written')

    expect(state.locked).toBe(true)
    const where = render(state.selectWhere[0]!)
    expect(where.sql).toContain('"id"')
    expect(where.sql).toContain('"project_id"')
    expect(where.params).toEqual(['vault-1', 'proj-1'])
    expect(compose).toHaveBeenCalledWith('Old')
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]!.set).toEqual({ description: 'Old\n\nnote' })
    expect(render(state.updates[0]!.where).params).toEqual(['vault-1', 'proj-1'])
    expect(touchProject).toHaveBeenCalledWith('proj-1')
  })

  it('returns not_found when the vault row is not in that project', async () => {
    const compose = vi.fn(() => 'x')

    await expect(updateVaultDescription('vault-1', 'other-proj', compose)).resolves.toBe('not_found')

    expect(compose).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('leaves the row untouched when compose rejects', async () => {
    state.row = { description: null }

    await expect(updateVaultDescription('vault-1', 'proj-1', () => null)).resolves.toBe('rejected')

    expect(state.updates).toHaveLength(0)
    expect(touchProject).not.toHaveBeenCalled()
  })
})
