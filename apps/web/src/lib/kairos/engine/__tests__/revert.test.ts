import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memory-ops', () => ({ findMemoryOp: vi.fn() }))
vi.mock('@/lib/data/memory-candidates', () => {
  class MemoryOpRevertRaceError extends Error {}
  return { findRevertableMemories: vi.fn(), applyMemoryOpRevert: vi.fn(), MemoryOpRevertRaceError }
})

import { findMemoryOp, type MemoryOpRow } from '@/lib/data/memory-ops'
import {
  applyMemoryOpRevert,
  findRevertableMemories,
  MemoryOpRevertRaceError,
  type RevertableMemoryRow,
} from '@/lib/data/memory-candidates'
import { revertMemoryOp } from '../revert'

const USER = 'user-1'
const OP_ID = 'op-1'
const NOW = new Date('2026-10-01T09:00:00.000Z')
const PROMOTED_AT = '2026-10-01T01:30:00.000Z'

function op(overrides: Partial<MemoryOpRow>): MemoryOpRow {
  return {
    id: OP_ID, userId: USER, runId: 'run-1', memoryId: 'prop-1', step: 'backup', op: 'promote',
    before: null, after: null, reason: 'r', revertedAt: null, revertedByOpId: null, createdAt: new Date(PROMOTED_AT),
    ...overrides,
  }
}

function mem(id: string, overrides: Partial<RevertableMemoryRow> = {}): RevertableMemoryRow {
  return {
    id, title: 't', bodyMd: 'b', summary: null, links: [], tags: [], streamClass: 'idea', confidence: 0.6, standing: null, standingAt: null, archivedAt: null,
    supersededAt: null, supersededById: null, invalidAt: null, lastUsedAt: null, useCount: 0, sourceMetadata: {},
    ...overrides,
  }
}

const promoteOp = op({
  before: { status: 'pending', streamClass: 'agentic', confidence: 0.45 },
  after: { status: 'promoted', streamClass: 'idea', confidence: 0.6 },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(applyMemoryOpRevert).mockResolvedValue('revert-op-1')
})

describe('revertMemoryOp', () => {
  it('reports not_found / already_reverted / not_revertable without writing', async () => {
    vi.mocked(findMemoryOp).mockResolvedValueOnce(null)
    expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'not_found' })

    vi.mocked(findMemoryOp).mockResolvedValueOnce(op({ revertedAt: new Date(), before: {} }))
    expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'already_reverted' })

    vi.mocked(findMemoryOp).mockResolvedValueOnce(op({ op: 'concept_create', before: null, after: { id: 'x' } }))
    expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'not_revertable' })

    vi.mocked(findMemoryOp).mockResolvedValueOnce(op({ op: 'revert', before: { status: 'x' } }))
    expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'not_revertable' })

    expect(applyMemoryOpRevert).not.toHaveBeenCalled()
  })

  it('restores a promotion to a pending agentic guess and leaves a veto marker', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(promoteOp)
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('prop-1', {
      sourceMetadata: { introspection: true, status: 'promoted', promotedAt: PROMOTED_AT, engine: { support: { independentSupports: 2, distinctDays: 2 }, promotedAt: PROMOTED_AT } },
    })])

    const res = await revertMemoryOp(USER, OP_ID, { reason: 'operator veto', now: NOW })

    expect(res).toEqual({ ok: true, opId: OP_ID, revertOpId: 'revert-op-1', restoredMemoryIds: ['prop-1'] })
    const [user, opId, patches, revertOp] = vi.mocked(applyMemoryOpRevert).mock.calls[0]
    expect(user).toBe(USER)
    expect(opId).toBe(OP_ID)
    expect(patches).toEqual([{
      memoryId: 'prop-1',
      set: {
        streamClass: 'agentic',
        confidence: 0.45,
        sourceMetadata: {
          introspection: true,
          status: 'pending',
          engine: {
            support: { independentSupports: 2, distinctDays: 2 },
            vetoes: { promote: { opId: OP_ID, at: NOW.toISOString() } },
          },
        },
      },
    }])
    expect(revertOp).toEqual({
      memoryId: 'prop-1',
      step: 'revert',
      op: 'revert',
      before: promoteOp.after,
      after: promoteOp.before,
      reason: `revert promote ${OP_ID}: operator veto`,
    })
  })

  it('refuses a stale revert when the memory moved on (e.g. operator accepted it)', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(promoteOp)
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('prop-1', { streamClass: 'reflection', sourceMetadata: { status: 'accepted' } })])
    expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'stale' })
    expect(applyMemoryOpRevert).not.toHaveBeenCalled()
  })

  it('un-archives a decayed proposal back to pending', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(op({
      op: 'decay',
      before: { status: 'pending', archivedAt: null },
      after: { status: 'decayed', archivedAt: PROMOTED_AT },
    }))
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('prop-1', {
      archivedAt: new Date(PROMOTED_AT),
      // engine.decayedAt is the decay's own stamp: it leaves with the revert.
      sourceMetadata: { status: 'decayed', engine: { decayedAt: PROMOTED_AT } },
    })])

    await revertMemoryOp(USER, OP_ID, { now: NOW })

    const patches = vi.mocked(applyMemoryOpRevert).mock.calls[0][2]
    expect(patches[0].set).toEqual({
      archivedAt: null,
      sourceMetadata: { status: 'pending', engine: { vetoes: { decay: { opId: OP_ID, at: NOW.toISOString() } } } },
    })
  })

  describe('merge', () => {
    const mergeOp = op({
      op: 'merge',
      memoryId: 'new-1',
      before: {
        newer: { id: 'new-1', supersededAt: null, supersededById: null },
        older: { id: 'old-1', useCount: 2, lastUsedAt: '2026-09-20T00:00:00.000Z' },
      },
      after: {
        newer: { id: 'new-1', supersededAt: PROMOTED_AT, supersededById: 'old-1' },
        older: { id: 'old-1', useCount: 3, lastUsedAt: PROMOTED_AT },
      },
    })

    it('restores both rows when nothing touched the older since', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(mergeOp)
      vi.mocked(findRevertableMemories).mockResolvedValue([
        mem('new-1', { supersededAt: new Date(PROMOTED_AT), supersededById: 'old-1' }),
        mem('old-1', { useCount: 3, lastUsedAt: new Date(PROMOTED_AT) }),
      ])

      const res = await revertMemoryOp(USER, OP_ID, { now: NOW })

      expect(res).toMatchObject({ ok: true, restoredMemoryIds: ['new-1', 'old-1'] })
      const patches = vi.mocked(applyMemoryOpRevert).mock.calls[0][2]
      expect(patches[0]).toEqual({
        memoryId: 'new-1',
        set: {
          supersededById: null,
          supersededAt: null,
          sourceMetadata: { engine: { vetoes: { merge: { opId: OP_ID, at: NOW.toISOString() } } } },
        },
      })
      expect(patches[1]).toEqual({
        memoryId: 'old-1',
        set: { useCount: 2, lastUsedAt: new Date('2026-09-20T00:00:00.000Z') },
      })
    })

    it('keeps later use of the older row: decrements instead of rewinding', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(mergeOp)
      vi.mocked(findRevertableMemories).mockResolvedValue([
        mem('new-1', { supersededAt: new Date(PROMOTED_AT), supersededById: 'old-1' }),
        mem('old-1', { useCount: 5, lastUsedAt: new Date('2026-10-01T08:00:00Z') }),
      ])

      await revertMemoryOp(USER, OP_ID, { now: NOW })

      expect(vi.mocked(applyMemoryOpRevert).mock.calls[0][2][1]).toEqual({ memoryId: 'old-1', set: {}, decrementUseCount: true })
    })

    it('refuses when the newer is no longer superseded by the older', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(mergeOp)
      vi.mocked(findRevertableMemories).mockResolvedValue([mem('new-1'), mem('old-1', { useCount: 3 })])
      expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'stale' })
    })

    it('reports memory_missing when a row was hard-deleted', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(mergeOp)
      vi.mocked(findRevertableMemories).mockResolvedValue([mem('new-1', { supersededAt: new Date(PROMOTED_AT), supersededById: 'old-1' })])
      expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'memory_missing' })
    })
  })

  it('maps a lost race inside the transaction to already_reverted', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(promoteOp)
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('prop-1', { sourceMetadata: { status: 'promoted' } })])
    vi.mocked(applyMemoryOpRevert).mockRejectedValue(new MemoryOpRevertRaceError())
    expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'already_reverted' })
  })

  it('adds to the vetoes map without erasing an earlier veto (legacy veto kept)', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(op({
      op: 'decay',
      before: { status: 'pending', archivedAt: null },
      after: { status: 'decayed', archivedAt: PROMOTED_AT },
    }))
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('prop-1', {
      archivedAt: new Date(PROMOTED_AT),
      sourceMetadata: {
        status: 'decayed',
        engine: { veto: { op: 'merge' }, vetoes: { promote: { opId: 'op-0', at: PROMOTED_AT } } },
      },
    })])

    await revertMemoryOp(USER, OP_ID, { now: NOW })

    expect(vi.mocked(applyMemoryOpRevert).mock.calls[0][2][0].set.sourceMetadata).toEqual({
      status: 'pending',
      engine: {
        veto: { op: 'merge' },
        vetoes: {
          promote: { opId: 'op-0', at: PROMOTED_AT },
          decay: { opId: OP_ID, at: NOW.toISOString() },
        },
      },
    })
  })

  describe('concept_update', () => {
    const beforeSnap = {
      title: 'Old concept', bodyMd: 'old body', summary: 'old sum', confidence: 0.5,
      links: [{ type: 'refers_to', target: 'm-1' }], tags: ['concept'], sourceMetadata: { externalKey: 'k1', kind: 'concept' },
    }
    const afterSnap = {
      title: 'New concept', bodyMd: 'new body', summary: 'new sum', confidence: 0.7,
      links: [{ type: 'refers_to', target: 'm-2' }], tags: ['concept', 'x'], sourceMetadata: { externalKey: 'k2', kind: 'concept' },
    }
    const updateOp = op({ op: 'concept_update', step: 'concepts', memoryId: 'c-1', before: beforeSnap, after: afterSnap })
    const current = mem('c-1', {
      title: 'New concept', bodyMd: 'new body', summary: 'new sum', confidence: 0.7, streamClass: 'concept',
      links: afterSnap.links, tags: afterSnap.tags, sourceMetadata: afterSnap.sourceMetadata,
    })

    it('restores the full snapshot and re-nulls the embedding', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(updateOp)
      vi.mocked(findRevertableMemories).mockResolvedValue([current])

      const res = await revertMemoryOp(USER, OP_ID, { now: NOW })

      expect(res).toMatchObject({ ok: true, restoredMemoryIds: ['c-1'] })
      expect(vi.mocked(applyMemoryOpRevert).mock.calls[0][2]).toEqual([{
        memoryId: 'c-1',
        set: { ...beforeSnap, embedding: null, embeddingModel: null },
      }])
    })

    it('refuses when the concept was rewritten again since', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(updateOp)
      vi.mocked(findRevertableMemories).mockResolvedValue([mem('c-1', { ...current, bodyMd: 'a later body' })])
      expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'stale' })
      expect(applyMemoryOpRevert).not.toHaveBeenCalled()
    })
  })

  describe('feedback', () => {
    it('undoes an outcome reaction as a relative counter delta', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(op({
        op: 'feedback', step: 'reaction',
        before: { outcome: { positive: 1, negative: 1 } },
        after: { outcome: { positive: 1, negative: 2 } },
      }))
      vi.mocked(findRevertableMemories).mockResolvedValue([mem('prop-1')])

      const res = await revertMemoryOp(USER, OP_ID)

      expect(res).toMatchObject({ ok: true })
      expect(vi.mocked(applyMemoryOpRevert).mock.calls[0][2]).toEqual([
        { memoryId: 'prop-1', set: {}, outcomeDelta: { positive: 0, negative: -1 } },
      ])
    })

    it('never reports ok for a revert that would change nothing', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(op({
        op: 'feedback', step: 'reaction',
        before: { outcome: { positive: 1, negative: 0 } },
        after: { outcome: { positive: 1, negative: 0 } },
      }))
      vi.mocked(findRevertableMemories).mockResolvedValue([mem('prop-1')])
      expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'not_revertable' })

      vi.mocked(findMemoryOp).mockResolvedValue(op({ op: 'score', before: { foo: 1 }, after: { foo: 2 } }))
      expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'not_revertable' })
      expect(applyMemoryOpRevert).not.toHaveBeenCalled()
    })

    it('undoes a use reaction by decrementing the current count', async () => {
      vi.mocked(findMemoryOp).mockResolvedValue(op({
        op: 'feedback', step: 'reaction',
        before: { useCount: 2 },
        after: { useCount: 3, lastUsedAt: PROMOTED_AT },
      }))
      vi.mocked(findRevertableMemories).mockResolvedValue([mem('prop-1', { useCount: 5 })])
      await revertMemoryOp(USER, OP_ID)
      expect(vi.mocked(applyMemoryOpRevert).mock.calls[0][2]).toEqual([{ memoryId: 'prop-1', set: {}, decrementUseCount: true }])
    })
  })
})

describe('revertMemoryOp: belief re-check ops (P2.5)', () => {
  const RECHECK = { since: '2026-10-01T01:30:00.000Z', lostSources: [{ id: 'm-2', state: 'archived' }] }
  // jsonb returns keys in its own order; the staleness check must not care.
  const RECHECK_REORDERED = { lostSources: [{ state: 'archived', id: 'm-2' }], since: '2026-10-01T01:30:00.000Z' }
  const held = (over: Record<string, unknown> = {}) => ({
    v: 1, mind: 'aligned', domain: 'general', dominionId: null, claim: 'c', reasons: [], falsifier: 'f',
    sourceType: 'operator', provenance: ['m-1', 'm-2'], status: 'held', confidence: 0.8, ...over,
  })
  const recheckOp = op({
    op: 'recheck', step: 'recheck', memoryId: 'bel-1',
    before: { belief: { confidence: 0.8, recheck: null } },
    after: { belief: { confidence: 0.56, recheck: RECHECK }, lostSources: [{ id: 'm-2', state: 'archived' }] },
  })

  it('restores confidence, removes the flag and remembers the acknowledged loss', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(recheckOp)
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('bel-1', {
      sourceMetadata: { kind: 'belief', belief: held({ confidence: 0.56, recheck: RECHECK_REORDERED }) },
    })])
    const res = await revertMemoryOp(USER, OP_ID, { now: NOW })
    expect(res).toMatchObject({ ok: true, restoredMemoryIds: ['bel-1'] })
    const [patch] = vi.mocked(applyMemoryOpRevert).mock.calls[0][2]
    const meta = patch.set.sourceMetadata as { belief: Record<string, unknown>; engine: { vetoes: Record<string, unknown> } }
    expect(meta.belief.confidence).toBe(0.8)
    expect('recheck' in meta.belief).toBe(false)
    expect(meta.belief.provenance).toEqual(['m-1', 'm-2'])
    expect(meta.engine.vetoes.recheck).toEqual({ opId: OP_ID, at: NOW.toISOString(), lostSources: ['m-2'] })
  })

  it('is stale once the belief moved on (reaffirmed since)', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(recheckOp)
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('bel-1', { sourceMetadata: { belief: held({ confidence: 0.7 }) } })])
    expect(await revertMemoryOp(USER, OP_ID)).toEqual({ ok: false, reason: 'stale' })
    expect(applyMemoryOpRevert).not.toHaveBeenCalled()
  })

  it('reverts a retire: back to held, invalidAt restored, retire vetoed', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(op({
      op: 'retire', step: 'beliefs', memoryId: 'bel-1',
      before: { invalidAt: null, supersededAt: null, belief: { status: 'held' } },
      after: { invalidAt: PROMOTED_AT, supersededAt: null, belief: { status: 'retired' }, extractKey: 'k' },
    }))
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('bel-1', {
      invalidAt: new Date(PROMOTED_AT),
      sourceMetadata: { belief: held({ status: 'retired', recheck: RECHECK }) },
    })])
    expect((await revertMemoryOp(USER, OP_ID, { now: NOW })).ok).toBe(true)
    const [patch] = vi.mocked(applyMemoryOpRevert).mock.calls[0][2]
    expect(patch.set).toMatchObject({ invalidAt: null, supersededAt: null })
    const meta = patch.set.sourceMetadata as { belief: Record<string, unknown>; engine: { vetoes: Record<string, unknown> } }
    expect(meta.belief.status).toBe('held')
    expect(meta.belief.recheck).toEqual(RECHECK)
    expect(meta.engine.vetoes.retire).toEqual({ opId: OP_ID, at: NOW.toISOString() })
  })

  it('reverts a merge remap: provenance and links point back', async () => {
    const beforeLinks = [{ type: 'refers_to', target: 'm-2', target_kind: 'memory' }]
    const afterLinks = [{ type: 'refers_to', target: 'm-9', target_kind: 'memory' }]
    vi.mocked(findMemoryOp).mockResolvedValue(op({
      op: 'feedback', step: 'recheck', memoryId: 'bel-1',
      before: { belief: { provenance: ['m-2'] }, links: beforeLinks },
      after: { belief: { provenance: ['m-9'] }, links: afterLinks, remapped: [{ from: 'm-2', to: 'm-9' }] },
    }))
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('bel-1', { links: afterLinks, sourceMetadata: { belief: held({ provenance: ['m-9'] }) } })])
    expect((await revertMemoryOp(USER, OP_ID)).ok).toBe(true)
    const [patch] = vi.mocked(applyMemoryOpRevert).mock.calls[0][2]
    expect(patch.set.links).toEqual(beforeLinks)
    expect((patch.set.sourceMetadata as { belief: { provenance: string[] } }).belief.provenance).toEqual(['m-2'])
    expect((patch.set.sourceMetadata as { engine?: unknown }).engine).toBeUndefined()
  })

  it('reverts a legacy normalisation: sourceType + confidence restored, normalisedAt removed, vetoed', async () => {
    vi.mocked(findMemoryOp).mockResolvedValue(op({
      op: 'feedback', step: 'recheck', memoryId: 'bel-1',
      before: { belief: { sourceType: 'operator', confidence: 0.9, normalisedAt: null } },
      after: { belief: { sourceType: 'inference', confidence: 0.6, normalisedAt: PROMOTED_AT }, normalised: true },
    }))
    vi.mocked(findRevertableMemories).mockResolvedValue([mem('bel-1', {
      sourceMetadata: { belief: held({ sourceType: 'inference', confidence: 0.6, normalisedAt: PROMOTED_AT }) },
    })])
    expect((await revertMemoryOp(USER, OP_ID, { now: NOW })).ok).toBe(true)
    const [patch] = vi.mocked(applyMemoryOpRevert).mock.calls[0][2]
    const meta = patch.set.sourceMetadata as { belief: Record<string, unknown>; engine: { vetoes: Record<string, unknown> } }
    expect(meta.belief).toMatchObject({ sourceType: 'operator', confidence: 0.9 })
    expect('normalisedAt' in meta.belief).toBe(false)
    expect(meta.engine.vetoes.normalise).toEqual({ opId: OP_ID, at: NOW.toISOString() })
  })
})
