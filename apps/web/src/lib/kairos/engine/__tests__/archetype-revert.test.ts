import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memory-ops', () => ({ findMemoryOp: vi.fn() }))
vi.mock('@/lib/data/memory-candidates', () => {
  class MemoryOpRevertRaceError extends Error {}
  return { findRevertableMemories: vi.fn(), applyMemoryOpRevert: vi.fn(async () => 'revert-op-1'), MemoryOpRevertRaceError }
})

import { findMemoryOp, type MemoryOpRow } from '@/lib/data/memory-ops'
import { applyMemoryOpRevert, findRevertableMemories, type RevertableMemoryRow } from '@/lib/data/memory-candidates'
import { revertMemoryOp } from '../revert'

const beforeSnap = { title: 'Queue first', bodyMd: 'old body', summary: 'old', confidence: null, links: [], tags: ['kairos'], sourceMetadata: { runId: 'r1' } }
const afterSnap = { title: 'Queue first', bodyMd: 'new body', summary: 'new', confidence: null, links: [], tags: ['kairos'], sourceMetadata: { runId: 'r2', revisedAt: 'x' } }

const op: MemoryOpRow = {
  id: 'op-1', userId: 'u', runId: null, memoryId: 'arch-1', step: 'archetype', op: 'archetype_update',
  before: beforeSnap, after: afterSnap, reason: 'r', revertedAt: null, revertedByOpId: null, createdAt: new Date(),
}

function row(overrides: Partial<RevertableMemoryRow> = {}): RevertableMemoryRow {
  return {
    id: 'arch-1', title: 'Queue first', bodyMd: 'new body', summary: 'new', links: [], tags: ['kairos'], streamClass: 'archetype',
    confidence: null, standing: null, standingAt: null, archivedAt: null, supersededAt: null, supersededById: null,
    invalidAt: null, lastUsedAt: null, useCount: 0, sourceMetadata: afterSnap.sourceMetadata, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findMemoryOp).mockResolvedValue(op)
})

describe('revertMemoryOp — archetype_update', () => {
  it('restores the archetype body from the before snapshot, keeping its id', async () => {
    vi.mocked(findRevertableMemories).mockResolvedValue([row()])

    const res = await revertMemoryOp('u', 'op-1')

    expect(res).toMatchObject({ ok: true, restoredMemoryIds: ['arch-1'] })
    const [patch] = vi.mocked(applyMemoryOpRevert).mock.calls[0][2]
    expect(patch).toMatchObject({ memoryId: 'arch-1', set: { bodyMd: 'old body', summary: 'old', embedding: null } })
  })

  it('is stale once a later night revised the archetype again', async () => {
    vi.mocked(findRevertableMemories).mockResolvedValue([row({ bodyMd: 'third body' })])

    expect(await revertMemoryOp('u', 'op-1')).toEqual({ ok: false, reason: 'stale' })
  })
})
