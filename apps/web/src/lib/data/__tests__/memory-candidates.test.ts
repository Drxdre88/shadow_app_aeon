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
