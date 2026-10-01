import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/beliefs', () => ({}))
vi.mock('@/lib/data/memory-ops', () => ({ insertMemoryOps: vi.fn() }))

import { MemoryEngine } from '../memory-engine'
import { OWN_MIND_LOOKBACK_DAYS, OwnMindStep } from '../steps/own-mind'
import { BufferedChangeLog } from '../change-log'
import type { MirrorOptions, MirrorResult } from '@/lib/kairos/beliefs/mirror'
import type { EngineRunContext } from '../types'
import { DAY_MS, NOW } from './fixtures'

function result(over: Partial<MirrorResult> = {}): MirrorResult {
  return { mirrored: [], retired: [], errors: [], examined: 0, planned: [], stopped: false, ...over }
}

function ctx(over: Partial<EngineRunContext> = {}): EngineRunContext {
  return { userId: 'u', runId: 'run-1', now: NOW, dryRun: false, changes: new BufferedChangeLog('u', 'run-1'), ...over }
}

describe('OwnMindStep', () => {
  it('mirrors with the run id over a 14-day lookback and reports the ops it wrote', async () => {
    const mirror = vi.fn().mockResolvedValue(result({ mirrored: ['b-1', 'b-2'], retired: ['b-9'], examined: 3 }))
    const res = await new OwnMindStep({ mirror }).run(ctx())
    const [userId, since, opts] = mirror.mock.calls[0] as [string, Date, MirrorOptions]
    expect(userId).toBe('u')
    expect(OWN_MIND_LOOKBACK_DAYS).toBe(14)
    expect(NOW.getTime() - since.getTime()).toBe(14 * DAY_MS)
    expect(opts).toMatchObject({ runId: 'run-1', now: NOW, dryRun: false })
    expect(res).toMatchObject({ step: 'own_mind', examined: 3, changed: 3, opsWritten: 3, notes: ['mirrored=2', 'retired=1'] })
    expect(res.errors).toBeUndefined()
    expect(res.outOfTime).toBeUndefined()
  })

  it('surfaces per-write failures as step errors', async () => {
    const mirror = vi.fn().mockResolvedValue(result({ mirrored: ['b-1'], errors: ['p-bad: boom'], examined: 2 }))
    const res = await new OwnMindStep({ mirror }).run(ctx())
    expect(res.errors).toEqual(['p-bad: boom'])
    expect(res.notes).toContain('failed=1')
  })

  it('honours the run deadline', async () => {
    let stop: (() => boolean) | undefined
    const mirror = vi.fn(async (_u: string, _s: Date, opts: MirrorOptions = {}) => {
      stop = opts.stop
      return result({ stopped: true, examined: 5, mirrored: ['b-1'] })
    })
    const res = await new OwnMindStep({ mirror }).run(ctx({ deadline: 0 }))
    expect(stop?.()).toBe(true)
    expect(res).toMatchObject({ outOfTime: true })
    expect(res.notes?.some((n) => n.startsWith('out of time'))).toBe(true)
  })

  it('dry run records the planned ops and writes none', async () => {
    const planned = [{ memoryId: null, step: 'beliefs', op: 'promote' as const, reason: 'r' }]
    const mirror = vi.fn().mockResolvedValue(result({ planned, examined: 1 }))
    const c = ctx({ dryRun: true })
    const res = await new OwnMindStep({ mirror }).run(c)
    expect(mirror.mock.calls[0][2]).toMatchObject({ dryRun: true })
    expect(c.changes.pending()).toEqual(planned)
    expect(res).toMatchObject({ examined: 1, changed: 1 })
    expect(res.opsWritten).toBeUndefined()
  })

  it("reaches the engine's failedSteps (and so the cron trace)", async () => {
    const mirror = vi.fn().mockResolvedValue(result({ errors: ['p-bad: boom'], examined: 1 }))
    const engine = new MemoryEngine({ steps: [new OwnMindStep({ mirror })], changes: (u, r) => new BufferedChangeLog(u, r), newRunId: () => 'run-9' })
    const run = await engine.runNight('u')
    expect(mirror.mock.calls[0][2]).toMatchObject({ runId: 'run-9' })
    expect(run.failedSteps).toEqual([{ step: 'own_mind', error: '1 change(s) rolled back: p-bad: boom' }])
  })

  it('a failed read fails the step, not the run', async () => {
    const mirror = vi.fn().mockRejectedValue(new Error('db down'))
    const engine = new MemoryEngine({ steps: [new OwnMindStep({ mirror })], changes: (u, r) => new BufferedChangeLog(u, r) })
    const run = await engine.runNight('u')
    expect(run.failedSteps).toEqual([{ step: 'own_mind', error: 'db down' }])
  })
})
