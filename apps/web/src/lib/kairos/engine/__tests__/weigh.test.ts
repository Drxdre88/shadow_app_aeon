import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memory-engine', () => ({}))

import { defaultScorers } from '../scorers'
import { Standing } from '../standing'
import { WeighStep, type WeighData } from '../steps/weigh'
import type { ChangeLog, EngineMemory, EngineRunContext, MemoryOpInput } from '../types'
import { NOW, makeMemory } from './fixtures'

function makeData(touched: EngineMemory[], stalest: EngineMemory[] = []) {
  return {
    loadTouchedEngineMemories: vi.fn(async () => touched),
    loadStalestEngineMemories: vi.fn(async () => stalest),
    listScoredRetiredMemories: vi.fn(async () => [] as Array<{ id: string; standing: number }>),
    zeroRetiredStanding: vi.fn(async () => 0),
    countOpenChallenges: vi.fn(async () => new Map<string, number>()),
    updateStandings: vi.fn(async (_u: string, updates: ReadonlyArray<unknown>, _at?: Date, _log?: unknown) => updates.length),
  } satisfies WeighData
}

function context(dryRun = false): EngineRunContext & { ops: MemoryOpInput[] } {
  const ops: MemoryOpInput[] = []
  const changes: ChangeLog = { runId: 'run-1', record: (o) => { ops.push(o) }, pending: () => ops, flush: async () => ops.length }
  return { userId: 'user-1', runId: 'run-1', now: NOW, dryRun, changes, ops }
}

const standing = new Standing(defaultScorers())

// Live runs hand the score ops to updateStandings (same transaction).
function writtenOps(data: ReturnType<typeof makeData>): MemoryOpInput[] {
  const log = data.updateStandings.mock.calls[0]?.[3] as { runId: string; ops: MemoryOpInput[] } | undefined
  return log?.ops ?? []
}

describe('WeighStep', () => {
  let ctx: ReturnType<typeof context>
  beforeEach(() => { ctx = context() })

  it('loads the touched window then fills the rolling slice up to the cap, excluding touched ids', async () => {
    const touched = [makeMemory({ id: 'a' }), makeMemory({ id: 'b' })]
    const data = makeData(touched, [makeMemory({ id: 'c' })])
    const result = await new WeighStep(standing, { cap: 5, data }).run(ctx)
    const [, since, now, limit] = data.loadTouchedEngineMemories.mock.calls[0] as unknown as [string, Date, Date, number]
    expect(NOW.getTime() - since.getTime()).toBe(36 * 3_600_000)
    expect(now).toBe(NOW)
    expect(limit).toBe(5)
    expect(data.loadStalestEngineMemories).toHaveBeenCalledWith('user-1', NOW, 3, ['a', 'b'])
    expect(data.countOpenChallenges).toHaveBeenCalledWith('user-1', ['a', 'b', 'c'])
    expect(result.examined).toBe(3)
    expect(data.updateStandings).toHaveBeenCalledTimes(1)
    expect(data.updateStandings.mock.calls[0][1]).toHaveLength(3)
  })

  it('records a score op only when |Δ| ≥ 0.05 and never for a first score', async () => {
    const data = makeData([
      makeMemory({ id: 'same', standing: 0.62 }),
      makeMemory({ id: 'moved', standing: 0.3 }),
      makeMemory({ id: 'new', standing: null }),
    ])
    const result = await new WeighStep(standing, { data }).run(ctx)
    const ops = writtenOps(data)
    expect(ctx.ops).toEqual([])
    expect(data.updateStandings.mock.calls[0][3]).toMatchObject({ runId: 'run-1' })
    expect(result.opsWritten).toBe(1)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ memoryId: 'moved', step: 'weigh', op: 'score', before: { standing: 0.3 }, after: { standing: 0.6 } })
    expect(ops[0].reason).toContain('base 0.6')
    expect(result.changed).toBe(2)
    const written = data.updateStandings.mock.calls[0][1] as Array<{ id: string; standing: number }>
    expect(written.map((w) => w.id)).toEqual(['same', 'moved', 'new'])
  })

  it('applies open challenges from the contradiction count', async () => {
    const data = makeData([makeMemory({ id: 'loser', standing: 0.6 })])
    data.countOpenChallenges.mockResolvedValue(new Map([['loser', 1]]))
    await new WeighStep(standing, { data }).run(ctx)
    const written = data.updateStandings.mock.calls[0][1] as Array<{ standing: number }>
    expect(written[0].standing).toBeCloseTo(0.48)
    expect(writtenOps(data)[0]).toMatchObject({ memoryId: 'loser', after: { standing: 0.48 } })
  })

  it('zeroes scored retired rows with their ops in the standings transaction', async () => {
    const data = makeData([])
    data.listScoredRetiredMemories.mockResolvedValue([{ id: 'gone', standing: 0.7 }, { id: 'tiny', standing: 0.01 }])
    data.zeroRetiredStanding.mockResolvedValue(4)
    const result = await new WeighStep(standing, { data }).run(ctx)
    expect(data.updateStandings.mock.calls[0][1]).toEqual([{ id: 'gone', standing: 0 }, { id: 'tiny', standing: 0 }])
    expect(writtenOps(data)).toEqual([expect.objectContaining({ memoryId: 'gone', before: { standing: 0.7 }, after: { standing: 0 } })])
    expect(data.zeroRetiredStanding).toHaveBeenCalledWith('user-1', NOW, NOW)
    expect(result.notes).toContain('retired zeroed 6')
  })

  it('a failed standings/op transaction fails the step (nothing half-written to report)', async () => {
    const data = makeData([makeMemory({ id: 'moved', standing: 0.1 })])
    data.updateStandings.mockRejectedValue(new Error('memory_ops insert failed'))
    await expect(new WeighStep(standing, { data }).run(ctx)).rejects.toThrow('memory_ops insert failed')
    expect(data.zeroRetiredStanding).not.toHaveBeenCalled()
  })

  it('does nothing once the deadline has passed', async () => {
    const data = makeData([makeMemory({ id: 'a' })])
    const result = await new WeighStep(standing, { data }).run({ ...ctx, deadline: 0 })
    expect(result).toMatchObject({ skipped: 'out of time', outOfTime: true })
    expect(data.loadTouchedEngineMemories).not.toHaveBeenCalled()
  })

  it('computes but writes nothing on a dry run', async () => {
    ctx = context(true)
    const data = makeData([makeMemory({ id: 'moved', standing: 0.1 })])
    data.listScoredRetiredMemories.mockResolvedValue([{ id: 'gone', standing: 0.7 }])
    const result = await new WeighStep(standing, { data }).run(ctx)
    expect(data.updateStandings).not.toHaveBeenCalled()
    expect(data.zeroRetiredStanding).not.toHaveBeenCalled()
    expect(ctx.ops).toHaveLength(2)
    expect(result.notes).toContain('dry run: nothing written')
  })

  it('skips the rolling slice when the touched window fills the cap', async () => {
    const data = makeData([makeMemory({ id: 'a' }), makeMemory({ id: 'b' })])
    await new WeighStep(standing, { cap: 2, data }).run(ctx)
    expect(data.loadStalestEngineMemories).toHaveBeenCalledWith('user-1', NOW, 0, ['a', 'b'])
  })
})
