import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memory-candidates', () => ({
  listMergeCandidates: vi.fn(),
  findOlderDuplicate: vi.fn(),
  applyMerge: vi.fn(),
}))

import { applyMerge, findOlderDuplicate, listMergeCandidates, type MergeCandidateRow } from '@/lib/data/memory-candidates'
import { MergeStep } from '../steps/merge'
import type { EngineRunContext, MemoryOpInput } from '../types'

const USER = 'user-1'
const NOW = new Date('2026-10-01T01:30:00.000Z')

function makeCtx(dryRun = false): EngineRunContext & { ops: MemoryOpInput[] } {
  const ops: MemoryOpInput[] = []
  return {
    userId: USER,
    runId: 'run-1',
    now: NOW,
    dryRun,
    ops,
    changes: { runId: 'run-1', record: (op) => { ops.push(op) }, pending: () => ops, flush: async () => ops.length },
  }
}

function row(id: string, overrides: Partial<MergeCandidateRow> = {}): MergeCandidateRow {
  return { id, type: 'note', streamClass: 'idea', createdAt: new Date('2026-09-30T12:00:00Z'), sourceMetadata: {}, ...overrides }
}

const LAST_USED = new Date('2026-09-20T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(applyMerge).mockResolvedValue(true)
  vi.mocked(findOlderDuplicate).mockResolvedValue(null)
})

describe('MergeStep', () => {
  it('asks for the last 36h, excluding reflections, synthesised docs and inbox/ask rows', async () => {
    vi.mocked(listMergeCandidates).mockResolvedValue([])
    await new MergeStep().run(makeCtx())
    const [user, since, opts] = vi.mocked(listMergeCandidates).mock.calls[0]
    expect(user).toBe(USER)
    expect(since).toEqual(new Date('2026-09-29T13:30:00.000Z'))
    expect(opts.excludeTypes).toEqual(expect.arrayContaining(['concept', 'cortex', 'dominion_cortex', 'aether', 'archetype', 'reflection']))
    expect(opts.excludeStreams).toContain('reflection')
  })

  it('supersedes the newer by the older, reinforces the older, logs both snapshots', async () => {
    vi.mocked(listMergeCandidates).mockResolvedValue([row('new-1')])
    vi.mocked(findOlderDuplicate).mockResolvedValue({ id: 'old-1', useCount: 2, lastUsedAt: LAST_USED, similarity: 0.97 })
    const ctx = makeCtx()

    const result = await new MergeStep().run(ctx)

    expect(findOlderDuplicate).toHaveBeenCalledWith(USER, expect.objectContaining({ id: 'new-1' }), expect.objectContaining({ maxDistance: expect.closeTo(0.05, 6) }))
    expect(applyMerge).toHaveBeenCalledWith(USER, 'new-1', 'old-1', NOW)
    expect(result).toMatchObject({ examined: 1, changed: 1 })
    expect(ctx.ops).toEqual([{
      memoryId: 'new-1',
      step: 'merge',
      op: 'merge',
      before: {
        newer: { id: 'new-1', supersededAt: null, supersededById: null },
        older: { id: 'old-1', useCount: 2, lastUsedAt: LAST_USED.toISOString() },
      },
      after: {
        newer: { id: 'new-1', supersededAt: NOW.toISOString(), supersededById: 'old-1' },
        older: { id: 'old-1', useCount: 3, lastUsedAt: NOW.toISOString() },
      },
      reason: expect.stringContaining('old-1'),
    }])
  })

  it('leaves rows without a near-duplicate alone', async () => {
    vi.mocked(listMergeCandidates).mockResolvedValue([row('new-1')])
    const ctx = makeCtx()
    const result = await new MergeStep().run(ctx)
    expect(applyMerge).not.toHaveBeenCalled()
    expect(ctx.ops).toEqual([])
    expect(result.changed).toBe(0)
  })

  it('dryRun logs without writing and never targets a row it already folded away', async () => {
    vi.mocked(listMergeCandidates).mockResolvedValue([row('new-1'), row('new-2')])
    vi.mocked(findOlderDuplicate)
      .mockResolvedValueOnce({ id: 'old-1', useCount: 0, lastUsedAt: null, similarity: 0.99 })
      .mockResolvedValueOnce(null)
    const ctx = makeCtx(true)

    await new MergeStep().run(ctx)

    expect(applyMerge).not.toHaveBeenCalled()
    expect(ctx.ops).toHaveLength(1)
    expect(vi.mocked(findOlderDuplicate).mock.calls[1][2].excludeIds).toEqual(['new-1'])
  })

  it('does not log a merge the live-row guard rejected', async () => {
    vi.mocked(listMergeCandidates).mockResolvedValue([row('new-1')])
    vi.mocked(findOlderDuplicate).mockResolvedValue({ id: 'old-1', useCount: 0, lastUsedAt: null, similarity: 0.99 })
    vi.mocked(applyMerge).mockResolvedValue(false)
    const ctx = makeCtx()
    await new MergeStep().run(ctx)
    expect(ctx.ops).toEqual([])
  })

  it('skips a row whose merge the operator vetoed', async () => {
    vi.mocked(listMergeCandidates).mockResolvedValue([row('new-1', { sourceMetadata: { engine: { veto: { op: 'merge' } } } })])
    await new MergeStep().run(makeCtx())
    expect(findOlderDuplicate).not.toHaveBeenCalled()
  })

  it('skips on engine.vetoes.merge but not on another op\'s veto', async () => {
    const at = { opId: 'op-0', at: '2026-09-30T00:00:00Z' }
    vi.mocked(listMergeCandidates).mockResolvedValue([
      row('new-1', { sourceMetadata: { engine: { vetoes: { merge: at } } } }),
      row('new-2', { sourceMetadata: { engine: { vetoes: { promote: at } } } }),
    ])
    vi.mocked(findOlderDuplicate).mockResolvedValue(null)
    await new MergeStep().run(makeCtx())
    expect(findOlderDuplicate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(findOlderDuplicate).mock.calls[0][1]).toMatchObject({ id: 'new-2' })
  })
})
