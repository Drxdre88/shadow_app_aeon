import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Operator reactions (docs/kairos/32 §2): outcome is merged atomically in SQL
// (no read-modify-write), use reinforcement bumps lastUsedAt/useCount, each is
// logged as a 'feedback' op, and the best-effort wrappers never throw.

const setCalls: Record<string, unknown>[] = []
const returningQueue: unknown[][] = []
let updateError: Error | null = null
const txHandles: unknown[] = []

vi.mock('@/lib/db', () => {
  function makeUpdateChain() {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => {
      setCalls.push(patch)
      return chain
    }
    chain.where = () => chain
    chain.returning = () => (updateError ? Promise.reject(updateError) : Promise.resolve(returningQueue.shift() ?? []))
    return chain
  }
  const db: Record<string, unknown> = {
    update: vi.fn(() => makeUpdateChain()),
    select: vi.fn(() => {
      throw new Error('reactions must not read before writing')
    }),
  }
  // A transaction handle that writes through the same chain; the callback's
  // rejection propagates (a real driver would roll back).
  db.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = { update: db.update, select: db.select }
    txHandles.push(tx)
    return fn(tx)
  })
  return { db }
})

vi.mock('@/lib/data/memory-ops', () => ({
  insertMemoryOps: vi.fn(async (_u: string, _r: string | null, ops: unknown[]) => ops.length),
}))

import { db } from '@/lib/db'
import { insertMemoryOps } from '@/lib/data/memory-ops'
import { reactOutcome, reactUsed, recordMemoryUse, recordOutcome } from '../memory-reactions'

const USER = 'user-1'
const MEM = 'a1111111-1111-4111-8111-111111111111'
const MEM2 = 'a2222222-2222-4222-8222-222222222222'
const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)

beforeEach(() => {
  vi.clearAllMocks()
  setCalls.length = 0
  returningQueue.length = 0
  txHandles.length = 0
  updateError = null
})

describe('recordOutcome', () => {
  it('merges engine.outcome in one SQL UPDATE (jsonb_set), not a JS object write', async () => {
    returningQueue.push([{ outcome: { positive: 2, negative: 0 } }])

    const out = await recordOutcome(USER, MEM, 'positive')

    expect(out).toEqual({ positive: 2, negative: 0 })
    expect(db.select).not.toHaveBeenCalled()
    expect(setCalls).toHaveLength(1)
    expect(Object.keys(setCalls[0])).toEqual(['sourceMetadata'])
    const q = render(setCalls[0].sourceMetadata)
    expect(q.sql).toContain('jsonb_set(')
    expect(q.sql).toContain("'{engine,outcome}'")
    expect(q.sql).toContain('"source_metadata"')
    // +1 positive, +0 negative.
    expect(q.params).toEqual([1, 0])
  })

  it('increments negative for a dismissal', async () => {
    returningQueue.push([{ outcome: { positive: 0, negative: 1 } }])
    await recordOutcome(USER, MEM, 'negative')
    expect(render(setCalls[0].sourceMetadata).params).toEqual([0, 1])
  })

  it('never bumps updatedAt (it drives confidence decay)', async () => {
    returningQueue.push([{ outcome: { positive: 1, negative: 0 } }])
    await recordOutcome(USER, MEM, 'positive')
    expect(setCalls[0]).not.toHaveProperty('updatedAt')
  })

  it('returns null for a missing row or a non-uuid id', async () => {
    returningQueue.push([])
    await expect(recordOutcome(USER, MEM, 'positive')).resolves.toBeNull()
    await expect(recordOutcome(USER, 'not-a-uuid', 'positive')).resolves.toBeNull()
    expect(db.update).toHaveBeenCalledTimes(1)
  })
})

describe('recordMemoryUse', () => {
  it('bumps useCount/lastUsedAt atomically for deduped uuid ids only', async () => {
    returningQueue.push([{ id: MEM, useCount: 3 }])
    const at = new Date('2026-09-30T12:00:00Z')

    const out = await recordMemoryUse(USER, [MEM, MEM.toUpperCase(), 'thought-7'], at)

    expect(out).toEqual([{ id: MEM, useCount: 3 }])
    const set = setCalls[0]
    expect(Object.keys(set).sort()).toEqual(['lastUsedAt', 'useCount'])
    expect(render(set.useCount).sql).toContain('"use_count" + 1')
    const last = render(set.lastUsedAt)
    expect(last.sql).toContain('GREATEST(')
    expect(last.params).toContain(at.toISOString())
  })

  it('skips the write entirely when no id is a uuid', async () => {
    await expect(recordMemoryUse(USER, ['x', ''])).resolves.toEqual([])
    expect(db.update).not.toHaveBeenCalled()
  })
})

describe('reactOutcome / reactUsed (best-effort + feedback ops)', () => {
  it('logs a feedback op with before/after outcome totals', async () => {
    returningQueue.push([{ outcome: { positive: 1, negative: 2 } }])

    await reactOutcome(USER, MEM, 'negative', 'proposal dismissed')

    expect(insertMemoryOps).toHaveBeenCalledWith(USER, null, [{
      memoryId: MEM,
      step: 'reaction',
      op: 'feedback',
      before: { outcome: { positive: 1, negative: 1 } },
      after: { outcome: { positive: 1, negative: 2 } },
      reason: 'proposal dismissed',
    }], txHandles[0])
    expect(db.transaction).toHaveBeenCalledTimes(1)
  })

  it('writes the reaction and its op in one transaction, and a failed op insert fails that transaction', async () => {
    returningQueue.push([{ id: MEM, useCount: 1 }])
    vi.mocked(insertMemoryOps).mockRejectedValueOnce(new Error('memory_ops insert failed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(reactUsed(USER, [MEM], 'cited')).resolves.toBeUndefined()

    expect(db.transaction).toHaveBeenCalledTimes(1)
    const txResult = vi.mocked(db.transaction).mock.results[0].value as Promise<unknown>
    await expect(txResult).rejects.toThrow('memory_ops insert failed')
    // Both writes went through the transaction handle, not the pool.
    expect(vi.mocked(insertMemoryOps).mock.calls[0][3]).toBe(txHandles[0])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('opens no transaction when no id is a uuid', async () => {
    await reactUsed(USER, ['thought-7'], 'cited')
    await reactOutcome(USER, 'nope', 'positive', 'accepted')
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('logs one feedback op per memory actually touched', async () => {
    returningQueue.push([{ id: MEM, useCount: 1 }, { id: MEM2, useCount: 5 }])

    await reactUsed(USER, [MEM, MEM2], 'cited', new Date('2026-09-30T12:00:00Z'))

    const ops = vi.mocked(insertMemoryOps).mock.calls[0][2]
    expect(ops.map((o) => [o.memoryId, o.op, o.before, o.after])).toEqual([
      [MEM, 'feedback', { useCount: 0 }, { useCount: 1, lastUsedAt: '2026-09-30T12:00:00.000Z' }],
      [MEM2, 'feedback', { useCount: 4 }, { useCount: 5, lastUsedAt: '2026-09-30T12:00:00.000Z' }],
    ])
  })

  it('writes no op when nothing was touched', async () => {
    returningQueue.push([])
    await reactUsed(USER, [MEM], 'cited')
    await reactOutcome(USER, 'nope', 'positive', 'accepted')
    expect(insertMemoryOps).not.toHaveBeenCalled()
  })

  it('swallows DB errors (e.g. migration 0039 not applied) instead of failing the caller', async () => {
    updateError = new Error('column "use_count" does not exist')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(reactUsed(USER, [MEM], 'cited')).resolves.toBeUndefined()
    await expect(reactOutcome(USER, MEM, 'positive', 'accepted')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
