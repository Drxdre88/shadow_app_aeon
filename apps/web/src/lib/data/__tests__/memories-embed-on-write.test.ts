import { describe, it, expect, vi, beforeEach } from 'vitest'

// createMemory / updateMemory hand the written row to the embed-on-write
// scheduler (background; the scheduler itself is covered in memory-embed.test).

const mocks = vi.hoisted(() => ({
  scheduleMemoryEmbed: vi.fn((..._a: unknown[]) => true),
}))

vi.mock('../memory-embed', () => ({ scheduleMemoryEmbed: mocks.scheduleMemoryEmbed }))

vi.mock('@/lib/db', () => {
  const insertChain = () => ({
    values: (v: Record<string, unknown>) => ({ returning: async () => [{ id: 'row-1', embedding: null, ...v }] }),
  })
  const select = () => {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.innerJoin = pass
    chain.where = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  const update = () => ({
    set: () => ({ where: () => ({ returning: async () => [{ id: 'row-1', title: 'patched', embedding: null }] }) }),
  })
  return {
    db: {
      select: vi.fn(select),
      insert: vi.fn(insertChain),
      update: vi.fn(update),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ execute: vi.fn(async () => undefined), select: vi.fn(select), insert: vi.fn(insertChain), update: vi.fn(update) })),
    },
  }
})

vi.mock('../dominions', () => ({ resolveDominionForMemory: vi.fn(async () => 'dom-structural') }))

import { createMemory, updateMemory } from '../memories'

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('embed on write', () => {
  it('createMemory schedules an embed for the inserted row after the write', async () => {
    const row = await createMemory(USER, { title: 'Morning message', bodyMd: 'Keep it short.', type: 'note', source: 'manual' } as Parameters<typeof createMemory>[1])

    expect(row.id).toBe('row-1')
    expect(mocks.scheduleMemoryEmbed).toHaveBeenCalledWith(USER, row)
  })

  it('updateMemory schedules a re-embed for the patched row', async () => {
    const row = await updateMemory('row-1', USER, { pinned: true })

    expect(mocks.scheduleMemoryEmbed).toHaveBeenCalledWith(USER, row)
  })
})
