import { describe, expect, it, vi } from 'vitest'

// Immediate post-reaction rescore (docs/kairos/34 §6): fresh Standing for the
// touched rows; a ≥0.05 move logs a 'score' op (step 'reaction') handed to
// updateStandings together with the standings (one transaction); smaller
// moves and first scores write the standing with no op; never throws.

vi.mock('@/lib/db', () => ({ db: {} }))

import { Standing } from '../engine/standing'
import { defaultScorers } from '../engine/scorers'
import { makeMemory, NOW } from '../engine/__tests__/fixtures'
import type { EngineMemory } from '../engine/types'
import { RESCORE_MIN_DELTA, rescoreMemories, type RescoreData } from '../rescore'

const USER = 'user-1'

function fakeData(rows: EngineMemory[], challenges = new Map<string, number>()): RescoreData {
  return {
    loadEngineMemoriesByIds: vi.fn(async () => rows),
    countOpenChallenges: vi.fn(async () => challenges),
    updateStandings: vi.fn(async (_u, updates) => updates.length),
  }
}

const fresh = (m: EngineMemory) =>
  Math.round(new Standing(defaultScorers()).compute(m, { now: NOW, openChallenges: 0 }).standing * 10_000) / 10_000

describe('rescoreMemories', () => {
  it('logs a score op (step reaction) only when the standing moves by ≥ 0.05, in the same updateStandings call', async () => {
    const base = makeMemory({ sourceMetadata: { engine: { outcome: { positive: 1, negative: 0 } } } })
    const target = fresh(base)
    const moved = { ...base, id: 'moved', standing: target - 0.06 }
    const nudged = { ...base, id: 'nudged', standing: target - (RESCORE_MIN_DELTA - 0.01) }
    const data = fakeData([moved, nudged])

    await expect(rescoreMemories(USER, ['moved', 'nudged'], 'cited', { now: NOW, data }))
      .resolves.toEqual({ scored: 2, opsWritten: 1 })

    expect(data.updateStandings).toHaveBeenCalledTimes(1)
    const [userId, updates, at, log] = vi.mocked(data.updateStandings).mock.calls[0]!
    expect(userId).toBe(USER)
    expect(at).toBe(NOW)
    expect(updates).toEqual([{ id: 'moved', standing: target }, { id: 'nudged', standing: target }])
    expect(log?.runId).toBeNull()
    expect(log?.ops).toHaveLength(1)
    expect(log?.ops[0]).toMatchObject({
      memoryId: 'moved',
      step: 'reaction',
      op: 'score',
      before: { standing: target - 0.06 },
      after: { standing: target },
    })
    expect(log?.ops[0]?.reason).toContain('after cited')
  })

  it('boundary: a move of exactly +0.05 or −0.06 writes an op, +0.04 does not', async () => {
    const base = makeMemory({ sourceMetadata: { engine: { outcome: { positive: 1, negative: 0 } } } })
    const target = fresh(base)
    // `before` values chosen so after − before is +0.05 / −0.06 / +0.04.
    const up5 = { ...base, id: 'up5', standing: target - 0.05 }
    const down6 = { ...base, id: 'down6', standing: target + 0.06 }
    const up4 = { ...base, id: 'up4', standing: target - 0.04 }
    const data = fakeData([up5, down6, up4])

    await expect(rescoreMemories(USER, ['up5', 'down6', 'up4'], 'cited', { now: NOW, data }))
      .resolves.toEqual({ scored: 3, opsWritten: 2 })
    const log = vi.mocked(data.updateStandings).mock.calls[0]![3]
    expect(log?.ops.map((o) => o.memoryId)).toEqual(['up5', 'down6'])
  })

  it.each([0.1, 0.35, 0.6, 0.65, 0.7, 0.9])(
    'boundary is float-safe: standing %f → +0.05 always logs an op',
    async (before) => {
      const after = Math.round((before + 0.05) * 10_000) / 10_000
      const memory = makeMemory({ id: 'm', standing: before })
      const data = fakeData([memory])
      const spy = vi.spyOn(Standing.prototype, 'compute').mockReturnValue({
        standing: after,
        base: after,
        factors: [],
      } as unknown as ReturnType<Standing['compute']>)
      try {
        await expect(rescoreMemories(USER, ['m'], 'cited', { now: NOW, data }))
          .resolves.toEqual({ scored: 1, opsWritten: 1 })
      } finally {
        spy.mockRestore()
      }
    },
  )

  it('writes a first score (standing null) without an op', async () => {
    const data = fakeData([makeMemory({ standing: null })])
    await expect(rescoreMemories(USER, ['mem-1'], 'accepted', { now: NOW, data }))
      .resolves.toEqual({ scored: 1, opsWritten: 0 })
    expect(vi.mocked(data.updateStandings).mock.calls[0]![3]?.ops).toEqual([])
  })

  it('feeds open challenges into the score', async () => {
    const m = makeMemory({ standing: 0.5 })
    const data = fakeData([m], new Map([['mem-1', 2]]))
    await rescoreMemories(USER, ['mem-1'], 'dismissed', { now: NOW, data })
    const [, updates] = vi.mocked(data.updateStandings).mock.calls[0]!
    expect(updates[0]!.standing).toBeLessThan(fresh(m))
  })

  it('does nothing when no row is found', async () => {
    const data = fakeData([])
    await expect(rescoreMemories(USER, ['x'], 'cited', { now: NOW, data })).resolves.toEqual({ scored: 0, opsWritten: 0 })
    expect(data.updateStandings).not.toHaveBeenCalled()
  })

  it('never throws — a failed write (rolled back with its op) is logged and swallowed', async () => {
    const data = fakeData([makeMemory({ standing: 0.1 })])
    vi.mocked(data.updateStandings).mockRejectedValue(new Error('tx aborted'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(rescoreMemories(USER, ['mem-1'], 'cited', { now: NOW, data })).resolves.toEqual({ scored: 0, opsWritten: 0 })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
