import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// memory-candidates — the write paths whose atomicity/guards matter. The
// vector predicates themselves are integration-level (like findSimilarBeliefs);
// here we lock the transaction shape: what is written, in which order, and
// that a lost guard rolls back / reports false.

type Call = { kind: 'update' | 'insert'; table: unknown; set?: Record<string, unknown>; values?: unknown }

const calls: Call[] = []
const returningQueue: unknown[][] = []

function writeChain(call: Call) {
  const chain: Record<string, unknown> = {}
  chain.set = (s: Record<string, unknown>) => { call.set = s; return chain }
  chain.values = (v: unknown) => { call.values = v; return chain }
  chain.where = () => chain
  chain.returning = () => Promise.resolve(returningQueue.shift() ?? [])
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined)
  return chain
}

function makeTx() {
  return {
    update: (table: unknown) => { const c: Call = { kind: 'update', table }; calls.push(c); return writeChain(c) },
    insert: (table: unknown) => { const c: Call = { kind: 'insert', table }; calls.push(c); return writeChain(c) },
    execute: vi.fn(),
  }
}

vi.mock('@/lib/db', () => ({
  db: {
    ...makeTx(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
  },
}))

import { db } from '@/lib/db'
import { memories, memoryOps } from '@/lib/db/schema'
import {
  applyMemoryOpRevert,
  applyMerge,
  MemoryOpRevertRaceError,
  updatePendingProposal,
  updatePendingProposals,
} from '../memory-candidates'

const USER = 'user-1'
const NOW = new Date('2026-10-01T01:30:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  returningQueue.length = 0
})

describe('applyMerge', () => {
  it('supersedes the newer then reinforces the older inside one transaction', async () => {
    returningQueue.push([{ id: 'new-1' }])
    expect(await applyMerge(USER, 'new-1', 'old-1', NOW)).toBe(true)
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(calls).toHaveLength(2)
    expect(calls[0].set).toEqual({ supersededAt: NOW, supersededById: 'old-1' })
    expect(calls[1].set).toMatchObject({ lastUsedAt: NOW })
    expect(calls[1].set).toHaveProperty('useCount')
  })

  it('does not touch the older when the newer was already superseded', async () => {
    returningQueue.push([])
    expect(await applyMerge(USER, 'new-1', 'old-1', NOW)).toBe(false)
    expect(calls).toHaveLength(1)
  })
})

describe('updatePendingProposal', () => {
  it('reports whether the pending guard let the write through', async () => {
    returningQueue.push([{ id: 'p' }], [])
    expect(await updatePendingProposal(USER, 'p', { sourceMetadata: { status: 'promoted' } })).toBe(true)
    expect(await updatePendingProposal(USER, 'p', { sourceMetadata: { status: 'promoted' } })).toBe(false)
  })

  const decayOp = {
    memoryId: 'p',
    step: 'backup',
    op: 'decay' as const,
    before: { status: 'pending', archivedAt: null },
    after: { status: 'decayed', archivedAt: NOW.toISOString() },
    reason: 'no backing',
  }

  it('with an op log, inserts the op in the SAME transaction as the update', async () => {
    returningQueue.push([{ id: 'p' }], [{ id: 'op-1' }])
    expect(await updatePendingProposal(USER, 'p', { sourceMetadata: { status: 'decayed' }, archivedAt: NOW }, { runId: 'run-1', ops: [decayOp] })).toBe(true)
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(calls.map((c) => [c.kind, c.table === memories ? 'memories' : c.table === memoryOps ? 'memory_ops' : '?'])).toEqual([
      ['update', 'memories'],
      ['insert', 'memory_ops'],
    ])
    expect(calls[1].values).toEqual([expect.objectContaining({
      userId: USER, runId: 'run-1', memoryId: 'p', step: 'backup', op: 'decay', before: decayOp.before, after: decayOp.after,
    })])
  })

  it('logs nothing when the pending guard rejected the write', async () => {
    returningQueue.push([])
    expect(await updatePendingProposal(USER, 'p', { sourceMetadata: {} }, { runId: 'run-1', ops: [decayOp] })).toBe(false)
    expect(calls.filter((c) => c.table === memoryOps)).toEqual([])
  })

  it('a failed op insert rejects the transaction (rolling the update back)', async () => {
    vi.mocked(db.transaction).mockImplementationOnce(async (fn) => {
      const tx = makeTx()
      tx.insert = () => { throw new Error('memory_ops insert failed') }
      return fn(tx as never)
    })
    returningQueue.push([{ id: 'p' }])
    await expect(updatePendingProposal(USER, 'p', { sourceMetadata: {} }, { runId: 'run-1', ops: [decayOp] }))
      .rejects.toThrow('memory_ops insert failed')
  })
})

describe('updatePendingProposals (batched BackUp writes)', () => {
  const op = (id: string) => ({
    memoryId: id,
    step: 'backup',
    op: 'decay' as const,
    before: { status: 'pending', archivedAt: null },
    after: { status: 'decayed', archivedAt: NOW.toISOString() },
    reason: `no backing ${id}`,
  })
  const writes = [
    { id: 'a', patch: { sourceMetadata: { status: 'decayed' }, archivedAt: NOW, updatedAt: NOW }, ops: [op('a')] },
    { id: 'b', patch: { sourceMetadata: { status: 'decayed' }, archivedAt: NOW, updatedAt: NOW }, ops: [op('b')] },
    { id: 'c', patch: { sourceMetadata: { status: 'pending', engine: { support: {} } } }, ops: [] },
  ]

  function txReturning(rows: Array<{ id: string }>) {
    const tx = makeTx()
    tx.execute.mockResolvedValue({ rows })
    vi.mocked(db.transaction).mockImplementationOnce(async (fn) => fn(tx as never))
    return tx
  }

  it('one guarded set-based UPDATE, then one op per landed memory — all in ONE transaction', async () => {
    const tx = txReturning([{ id: 'a' }, { id: 'c' }])
    returningQueue.push([{ id: 'op-a' }])

    const landed = await updatePendingProposals(USER, writes, 'run-1')

    expect([...landed].sort()).toEqual(['a', 'c'])
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(tx.execute).toHaveBeenCalledTimes(2)
    const dialect = new PgDialect()
    expect(dialect.sqlToQuery(tx.execute.mock.calls[0][0] as SQL).sql).toBe('SET LOCAL statement_timeout = 10000')
    const q = dialect.sqlToQuery(tx.execute.mock.calls[1][0] as SQL)
    expect(q.sql).toContain('FROM (VALUES')
    expect(q.sql).toContain("source_metadata->>'status' = 'pending'")
    expect(q.sql).toContain('archived_at IS NULL')
    expect(q.sql).toContain('RETURNING m.id')
    expect(q.params).toEqual(expect.arrayContaining(['a', 'b', 'c', USER, JSON.stringify({ status: 'decayed' }), NOW.toISOString()]))
    // 'b' lost the pending guard → no op; 'c' landed but is bookkeeping (no op).
    const inserts = calls.filter((c) => c.table === memoryOps)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].values).toEqual([expect.objectContaining({
      userId: USER, runId: 'run-1', memoryId: 'a', step: 'backup', op: 'decay', before: op('a').before, after: op('a').after,
    })])
  })

  it('inserts no ops when nothing landed', async () => {
    txReturning([])
    expect((await updatePendingProposals(USER, writes, 'run-1')).size).toBe(0)
    expect(calls.filter((c) => c.table === memoryOps)).toEqual([])
  })

  it('a failed op insert rejects the whole batch (rolled back with it)', async () => {
    const tx = txReturning([{ id: 'a' }])
    tx.insert = () => { throw new Error('memory_ops insert failed') }
    await expect(updatePendingProposals(USER, writes, 'run-1')).rejects.toThrow('memory_ops insert failed')
  })

  it('does nothing for an empty batch', async () => {
    expect((await updatePendingProposals(USER, [], 'run-1')).size).toBe(0)
    expect(db.transaction).not.toHaveBeenCalled()
  })
})

describe('applyMerge with an op log', () => {
  it('writes the merge op inside the merge transaction, after both row updates', async () => {
    returningQueue.push([{ id: 'new-1' }], [{ id: 'op-1' }])
    const op = { memoryId: 'new-1', step: 'merge', op: 'merge' as const, before: {}, after: {}, reason: 'repeat' }
    expect(await applyMerge(USER, 'new-1', 'old-1', NOW, { runId: 'run-1', ops: [op] })).toBe(true)
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(calls.map((c) => c.kind)).toEqual(['update', 'update', 'insert'])
    expect(calls[2].table).toBe(memoryOps)
  })

  it('logs nothing when the newer row was already superseded', async () => {
    returningQueue.push([])
    const op = { memoryId: 'new-1', step: 'merge', op: 'merge' as const, reason: 'repeat' }
    expect(await applyMerge(USER, 'new-1', 'old-1', NOW, { runId: 'run-1', ops: [op] })).toBe(false)
    expect(calls.some((c) => c.kind === 'insert')).toBe(false)
  })
})

describe('applyMemoryOpRevert', () => {
  const revertOp = { memoryId: 'm-1', step: 'revert', op: 'revert' as const, before: { a: 1 }, after: { a: 0 }, reason: 'revert merge op-1' }

  it('restores, logs the revert op and marks the original — all in one transaction', async () => {
    returningQueue.push([{ id: 'rev-1' }], [{ id: 'op-1' }])

    const id = await applyMemoryOpRevert(USER, 'op-1', [
      { memoryId: 'm-1', set: { supersededAt: null, supersededById: null } },
      { memoryId: 'm-2', set: {}, decrementUseCount: true },
    ], revertOp)

    expect(id).toBe('rev-1')
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(calls.map((c) => [c.kind, c.table === memories ? 'memories' : c.table === memoryOps ? 'memory_ops' : '?'])).toEqual([
      ['update', 'memories'],
      ['update', 'memories'],
      ['insert', 'memory_ops'],
      ['update', 'memory_ops'],
    ])
    expect(calls[0].set).toEqual({ supersededAt: null, supersededById: null })
    expect(calls[1].set).toHaveProperty('useCount')
    expect(calls[2].values).toMatchObject({ userId: USER, runId: null, memoryId: 'm-1', op: 'revert', reason: 'revert merge op-1' })
    expect(calls[3].set).toMatchObject({ revertedByOpId: 'rev-1' })
  })

  it('throws the race error (rolling back) when another revert already marked the op', async () => {
    returningQueue.push([{ id: 'rev-1' }], [])
    await expect(applyMemoryOpRevert(USER, 'op-1', [{ memoryId: 'm-1', set: { archivedAt: null } }], revertOp))
      .rejects.toBeInstanceOf(MemoryOpRevertRaceError)
  })

  it('undoes an outcome reaction with an atomic jsonb_set delta, not a JS object write', async () => {
    returningQueue.push([{ id: 'rev-1' }], [{ id: 'op-1' }])
    await applyMemoryOpRevert(USER, 'op-1', [{ memoryId: 'm-1', set: {}, outcomeDelta: { positive: 0, negative: -1 } }], revertOp)
    const q = new PgDialect().sqlToQuery(calls[0].set?.sourceMetadata as SQL)
    expect(q.sql).toContain("'{engine,outcome}'")
    expect(q.sql).toContain('GREATEST(')
    expect(q.params).toEqual([0, -1])
  })
})
