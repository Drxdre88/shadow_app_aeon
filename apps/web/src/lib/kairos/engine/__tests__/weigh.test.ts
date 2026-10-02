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
    loadStalestEngineMemories: vi.fn(async (..._args: unknown[]) => stalest),
    countLiveEngineMemories: vi.fn(async () => 0),
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
    expect(data.loadStalestEngineMemories).toHaveBeenCalledWith('user-1', NOW, 3, ['a', 'b'], { night: 20727, buckets: 1 })
    expect(data.countOpenChallenges).toHaveBeenCalledWith('user-1', ['a', 'b', 'c'])
    expect(result.examined).toBe(3)
    expect(data.updateStandings).toHaveBeenCalledTimes(1)
    expect(data.updateStandings.mock.calls[0][1]).toHaveLength(3)
  })

  it('writes a standing only when |Δ| ≥ 0.05 from the stored value, always with its op; a first score writes without one', async () => {
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
    // 'same' (0.62 → 0.6) is held: not written.
    expect(written.map((w) => w.id)).toEqual(['moved', 'new'])
    expect(result.notes).toContain('held 1 (|Δ| < 0.05)')
  })

  it('applies open challenges from the contradiction count', async () => {
    const data = makeData([makeMemory({ id: 'loser', standing: 0.6 })])
    data.countOpenChallenges.mockResolvedValue(new Map([['loser', 1]]))
    await new WeighStep(standing, { data }).run(ctx)
    const written = data.updateStandings.mock.calls[0][1] as Array<{ standing: number }>
    expect(written[0].standing).toBeCloseTo(0.48)
    expect(writtenOps(data)[0]).toMatchObject({ memoryId: 'loser', after: { standing: 0.48 } })
  })

  it('zeroes every scored retired row with its op (even a tiny one) in the standings transaction', async () => {
    const data = makeData([])
    data.listScoredRetiredMemories.mockResolvedValue([{ id: 'gone', standing: 0.7 }, { id: 'tiny', standing: 0.01 }])
    data.zeroRetiredStanding.mockResolvedValue(4)
    const result = await new WeighStep(standing, { data }).run(ctx)
    expect(data.updateStandings.mock.calls[0][1]).toEqual([{ id: 'gone', standing: 0 }, { id: 'tiny', standing: 0 }])
    expect(writtenOps(data)).toEqual([
      expect.objectContaining({ memoryId: 'gone', before: { standing: 0.7 }, after: { standing: 0 } }),
      expect.objectContaining({ memoryId: 'tiny', before: { standing: 0.01 }, after: { standing: 0 } }),
    ])
    expect(data.zeroRetiredStanding).toHaveBeenCalledWith('user-1', NOW, NOW)
    expect(result.notes).toContain('retired zeroed 6')
  })

  it('a held drift accumulates against the stored value and is written (with its op) once it crosses 0.05', async () => {
    let computed = 0.57
    const stub = { compute: () => ({ standing: computed, base: computed, factors: [] }) } as unknown as Standing
    const stored = makeMemory({ id: 'drift', standing: 0.6 })

    const night1 = makeData([stored])
    const r1 = await new WeighStep(stub, { data: night1 }).run(ctx)
    expect(night1.updateStandings).not.toHaveBeenCalled()
    expect(r1).toMatchObject({ opsWritten: 0, changed: 0 })

    // Nothing was written, so tonight still compares against the stored 0.6.
    computed = 0.55
    const night2 = makeData([stored])
    const r2 = await new WeighStep(stub, { data: night2 }).run(ctx)
    expect(night2.updateStandings.mock.calls[0][1]).toEqual([{ id: 'drift', standing: 0.55 }])
    expect(writtenOps(night2)).toEqual([expect.objectContaining({ memoryId: 'drift', before: { standing: 0.6 }, after: { standing: 0.55 } })])
    expect(r2.opsWritten).toBe(1)
  })

  it('ops == writes: every written standing that had a stored value carries exactly one op, and no op lacks a write', async () => {
    const data = makeData(
      [makeMemory({ id: 't-moved', standing: 0.1 }), makeMemory({ id: 't-held', standing: 0.61 }), makeMemory({ id: 't-new' })],
      [makeMemory({ id: 'r-moved', standing: 0.95 }), makeMemory({ id: 'r-held', standing: 0.58 })],
    )
    data.listScoredRetiredMemories.mockResolvedValue([{ id: 'gone', standing: 0.02 }])
    const result = await new WeighStep(standing, { data, chunk: 2 }).run(ctx)
    const calls = data.updateStandings.mock.calls as unknown as Array<[string, Array<{ id: string }>, Date, { ops: MemoryOpInput[] }]>
    const written = calls.flatMap((c) => c[1].map((u) => u.id))
    const opIds = calls.flatMap((c) => c[3].ops.map((o) => o.memoryId))
    expect(written).toEqual(['t-moved', 't-new', 'gone', 'r-moved'])
    expect(opIds.sort()).toEqual(written.filter((id) => id !== 't-new').sort())
    expect(result.opsWritten).toBe(3)
  })

  it('rotates the rolling slice by nightly bucket, sized so a bucket fits the slice', async () => {
    const data = makeData([makeMemory({ id: 'a' })])
    data.countLiveEngineMemories.mockResolvedValue(8_000)
    await new WeighStep(standing, { data }).run(ctx)
    // 1999-row slice × 0.75 fill → ⌈8000 / 1499.25⌉ = 6 buckets.
    expect(data.countLiveEngineMemories).toHaveBeenCalledWith('user-1', NOW)
    expect(data.loadStalestEngineMemories.mock.calls[0][4]).toEqual({ night: Math.floor(NOW.getTime() / 86_400_000), buckets: 6 })
  })

  it('a failed standings/op chunk is reported as rolled back and stops the writes (nothing half-written)', async () => {
    const data = makeData([makeMemory({ id: 'moved', standing: 0.1 })])
    data.updateStandings.mockRejectedValue(new Error('memory_ops insert failed'))
    const result = await new WeighStep(standing, { data }).run(ctx)
    expect(result).toMatchObject({ opsWritten: 0, errors: ['standings 1-1 of 1: memory_ops insert failed'] })
    expect(data.zeroRetiredStanding).not.toHaveBeenCalled()
  })

  it('writes standings in chunks, each with exactly the score ops of its own rows', async () => {
    const touched = [
      makeMemory({ id: 'a', standing: 0.1 }),
      makeMemory({ id: 'b', standing: 0.62 }),
      makeMemory({ id: 'c', standing: null }),
      makeMemory({ id: 'd', standing: 0.2 }),
    ]
    const data = makeData(touched, [makeMemory({ id: 'e', standing: 0.9 })])
    data.listScoredRetiredMemories.mockResolvedValue([{ id: 'gone', standing: 0.7 }])
    const result = await new WeighStep(standing, { data, chunk: 2 }).run(ctx)

    const calls = data.updateStandings.mock.calls as unknown as Array<[string, Array<{ id: string }>, Date, { runId: string; ops: MemoryOpInput[] }]>
    // Touched rows first, then retired zeroes, then the rolling slice ('b' is held).
    expect(calls.map((c) => c[1].map((u) => u.id))).toEqual([['a', 'c'], ['d', 'gone'], ['e']])
    for (const [, chunk, at, log] of calls) {
      expect(at).toBe(NOW)
      expect(log.runId).toBe('run-1')
      const ids = new Set(chunk.map((u) => u.id))
      expect(log.ops.every((o) => ids.has(o.memoryId as string))).toBe(true)
    }
    const ops = calls.flatMap((c) => c[3].ops)
    expect(ops.map((o) => o.memoryId)).toEqual(['a', 'd', 'gone', 'e'])
    expect(new Set(ops.map((o) => o.memoryId)).size).toBe(ops.length)
    expect(ops.find((o) => o.memoryId === 'a')).toMatchObject({ op: 'score', before: { standing: 0.1 }, after: { standing: 0.6 } })
    expect(ops.find((o) => o.memoryId === 'gone')).toMatchObject({ before: { standing: 0.7 }, after: { standing: 0 } })
    expect(result).toMatchObject({ opsWritten: 4 })
    expect(data.zeroRetiredStanding).toHaveBeenCalledTimes(1)
  })

  it('yields between chunks once its deadline passes; unwritten rows carry over', async () => {
    const data = makeData([makeMemory({ id: 'a', standing: 0.1 }), makeMemory({ id: 'b', standing: 0.1 }), makeMemory({ id: 'c', standing: 0.1 })])
    let deadline = Date.now() + 60_000
    data.updateStandings.mockImplementation(async (_u, updates) => { deadline = 0; return updates.length })
    const result = await new WeighStep(standing, { data, chunk: 2 }).run({ ...ctx, get deadline() { return deadline } })
    expect(data.updateStandings).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ outOfTime: true, opsWritten: 2 })
    expect(result.notes).toContain('out of time after 2/3')
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
    expect(data.loadStalestEngineMemories).toHaveBeenCalledWith('user-1', NOW, 0, ['a', 'b'], undefined)
    expect(data.countLiveEngineMemories).not.toHaveBeenCalled()
  })
})
