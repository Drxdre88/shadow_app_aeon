import { beforeEach, describe, expect, it, vi } from 'vitest'

// Owner fixes: "this is wrong" must be undoable through the EXISTING revert
// path, and Confirm must re-label to operator while keeping the prior label.

const state: { current: Record<string, unknown> | null; set: Record<string, unknown> | null; opValues: Record<string, unknown> | null } = {
  current: null, set: null, opValues: null,
}

vi.mock('@/lib/db', () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => (state.current ? [state.current] : []) }) }) }) }),
    update: () => ({ set: (s: Record<string, unknown>) => { state.set = s; return { where: async () => undefined } } }),
    insert: () => ({ values: (v: Record<string, unknown>) => { state.opValues = v; return { returning: async () => [{ id: 'op-1' }] } } }),
  }
  return { db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }
})
vi.mock('@/lib/data/memory-ops', () => ({ insertMemoryOps: vi.fn(), listMemoryOps: vi.fn(), findMemoryOp: vi.fn() }))
vi.mock('@/lib/data/memory-candidates', () => ({
  findRevertableMemories: vi.fn(),
  applyMemoryOpRevert: vi.fn(async () => 'revert-op'),
  MemoryOpRevertRaceError: class extends Error {},
}))

import { confirmMemoryAsOwner, mergeNeedsEyes, rejectMemoryAsWrong, type NeedsEyesRow } from '../memory-knows'
import { findMemoryOp, insertMemoryOps } from '@/lib/data/memory-ops'
import { applyMemoryOpRevert, findRevertableMemories } from '@/lib/data/memory-candidates'
import { revertMemoryOp } from '@/lib/kairos/engine/revert'

const USER = 'user-1'
const ID = 'mem-1'

beforeEach(() => {
  vi.clearAllMocks()
  state.current = null
  state.set = null
  state.opValues = null
})

describe('rejectMemoryAsWrong', () => {
  it('archives with the reason and logs a reject op the existing revert restores', async () => {
    state.current = { id: ID, archivedAt: null, sourceMetadata: { origin: { kind: 'agent' } } }
    const res = await rejectMemoryAsWrong(USER, ID, 'not true')
    expect(res).toEqual({ ok: true, memoryId: ID, opId: 'op-1' })
    const archivedAt = state.set?.archivedAt as Date
    expect(archivedAt).toBeInstanceOf(Date)
    expect(state.set?.sourceMetadata).toMatchObject({ origin: { kind: 'agent' }, ownerRejected: { reason: 'not true' } })
    expect(state.opValues).toMatchObject({ userId: USER, memoryId: ID, step: 'owner', op: 'reject', before: { archivedAt: null } })

    vi.mocked(findMemoryOp).mockResolvedValue({ id: 'op-1', userId: USER, runId: null, memoryId: ID, step: 'owner', op: 'reject', before: state.opValues?.before, after: state.opValues?.after, reason: 'x', revertedAt: null, revertedByOpId: null, createdAt: new Date() })
    vi.mocked(findRevertableMemories).mockResolvedValue([{ id: ID, archivedAt, sourceMetadata: {}, useCount: 0 } as never])
    const undo = await revertMemoryOp(USER, 'op-1')
    expect(undo).toMatchObject({ ok: true, restoredMemoryIds: [ID] })
    const patches = vi.mocked(applyMemoryOpRevert).mock.calls[0][2]
    expect(patches[0]).toMatchObject({ memoryId: ID, set: { archivedAt: null } })
  })

  it('refuses an already-archived or missing row', async () => {
    state.current = { id: ID, archivedAt: new Date(), sourceMetadata: {} }
    expect(await rejectMemoryAsWrong(USER, ID, 'x')).toEqual({ ok: false, reason: 'already_archived' })
    state.current = null
    expect(await rejectMemoryAsWrong(USER, ID, 'x')).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('confirmMemoryAsOwner', () => {
  it('re-labels as operator, keeps the prior label and releases a sensitive hold', async () => {
    state.current = { id: ID, source: 'claude', sourceMetadata: { origin: { kind: 'agent', via: 'mcp' }, sensitive: true, sensitiveHeld: true } }
    await confirmMemoryAsOwner(USER, ID)
    expect(state.set?.sourceMetadata).toMatchObject({
      origin: { kind: 'operator', via: 'confirm' },
      priorOrigin: { kind: 'agent', via: 'mcp' },
      sensitive: true,
      sensitiveHeld: false,
    })
    expect(vi.mocked(insertMemoryOps).mock.calls[0][2][0]).toMatchObject({ step: 'owner', op: 'feedback' })
  })

  it('clears a belief re-check flag as a revertible belief feedback op', async () => {
    const recheck = { since: '2026-10-01T00:00:00Z', lostSources: [{ id: 'm9', state: 'archived' }] }
    state.current = { id: ID, source: 'cron', sourceMetadata: { belief: { claim: 'c', recheck } } }
    await confirmMemoryAsOwner(USER, ID)
    const meta = state.set?.sourceMetadata as { belief: Record<string, unknown> }
    expect(meta.belief).toEqual({ claim: 'c' })
    expect(vi.mocked(insertMemoryOps).mock.calls[0][2][0]).toMatchObject({
      op: 'feedback', before: { belief: { recheck } }, after: { belief: { recheck: null } },
    })
  })
})

describe('mergeNeedsEyes', () => {
  it('keeps one entry per memory, first reason wins, capped', () => {
    const row = (id: string, reason: NeedsEyesRow['reason']) => ({ id, reason }) as NeedsEyesRow
    const out = mergeNeedsEyes([row('a', 'sensitive'), row('a', 'low_trust'), row('b', 'recheck'), row('c', 'low_trust')], 2)
    expect(out.map((r) => [r.id, r.reason])).toEqual([['a', 'sensitive'], ['b', 'recheck']])
  })
})
