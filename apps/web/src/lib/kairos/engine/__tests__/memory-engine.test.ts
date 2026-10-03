import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memory-ops', () => ({ insertMemoryOps: vi.fn() }))
vi.mock('@/lib/data/memory-engine', () => ({}))
// buildNightSteps only constructs steps; keep the data layer (and whatever it
// pulls in at module load) out of this unit test.
vi.mock('@/lib/data/memory-candidates', () => ({}))
vi.mock('@/lib/data/memory-reactions', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))

import { BufferedChangeLog } from '../change-log'
import { MemoryEngine } from '../memory-engine'
import { buildNightSteps } from '../registry'
import { WeighStep } from '../steps/weigh'
import type { ChangeLog, EngineRunContext, MemoryOpInput, Step, StepResult } from '../types'
import { NOW } from './fixtures'

const op = (memoryId: string): MemoryOpInput => ({ memoryId, step: 'weigh', op: 'score', reason: 'r' })

describe('BufferedChangeLog', () => {
  it('buffers records and flushes them once in chunks, then empties', async () => {
    const writer = vi.fn(async (_u: string, _r: string | null, ops: readonly MemoryOpInput[]) => ops.length)
    const log = new BufferedChangeLog('user-1', 'run-1', writer)
    for (let i = 0; i < 1203; i++) log.record(op(`m${i}`))
    expect(log.pending()).toHaveLength(1203)
    expect(await log.flush()).toBe(1203)
    expect(writer).toHaveBeenCalledTimes(3)
    expect(writer.mock.calls[0][0]).toBe('user-1')
    expect(writer.mock.calls[0][1]).toBe('run-1')
    expect(log.pending()).toHaveLength(0)
    expect(await log.flush()).toBe(0)
  })

  it('keeps unwritten ops when the writer throws', async () => {
    const writer = vi.fn().mockRejectedValue(new Error('db down'))
    const log = new BufferedChangeLog('user-1', 'run-1', writer)
    log.record(op('a'))
    await expect(log.flush()).rejects.toThrow('db down')
    expect(log.pending()).toHaveLength(1)
  })
})

function fakeLog(): ChangeLog & { flush: ReturnType<typeof vi.fn> } {
  const buf: MemoryOpInput[] = []
  return {
    runId: 'run-1',
    record: (o) => { buf.push(o) },
    pending: () => buf,
    flush: vi.fn(async () => buf.splice(0).length),
  }
}

function step(
  name: string,
  impl: (ctx: EngineRunContext) => Promise<Partial<StepResult> | void> = async () => {},
): Step {
  return {
    name,
    run: async (ctx) => ({ step: name, examined: 1, changed: 0, ...((await impl(ctx)) ?? {}) }),
  }
}

describe('MemoryEngine', () => {
  it('runs steps in order with one shared context and sums the ops each step wrote transactionally', async () => {
    const log = fakeLog()
    const seen: string[] = []
    const engine = new MemoryEngine({
      steps: [
        step('a', async (ctx) => { seen.push(`a:${ctx.runId}`); return { opsWritten: 2 } }),
        step('b', async (ctx) => { seen.push(`b:${ctx.now.toISOString()}`); return { opsWritten: 1 } }),
      ],
      changes: (_userId, runId) => ({ ...log, runId }),
      clock: () => NOW,
      newRunId: () => 'run-42',
    })
    const result = await engine.runNight('user-1')
    expect(seen).toEqual(['a:run-42', `b:${NOW.toISOString()}`])
    expect(result).toMatchObject({ runId: 'run-42', userId: 'user-1', dryRun: false, opsWritten: 3, failedSteps: [] })
    expect(result.steps.map((s) => s.step)).toEqual(['a', 'b'])
    // Live ops never go through the buffer.
    expect(log.flush).not.toHaveBeenCalled()
  })

  it('flags a live step that buffered ops instead of writing them with its change (and persists them)', async () => {
    const writer = vi.fn(async (_u: string, _r: string | null, ops: readonly MemoryOpInput[]) => ops.length)
    const engine = new MemoryEngine({
      steps: [step('a', async (ctx) => { ctx.changes.record(op('x')) }), step('b')],
      changes: (userId, runId) => new BufferedChangeLog(userId, runId, writer),
      clock: () => NOW,
    })
    const result = await engine.runNight('user-1')
    expect(writer).toHaveBeenCalledTimes(1)
    expect(result.opsWritten).toBe(1)
    expect(result.failedSteps).toEqual([{ step: 'changelog:a', error: '1 op(s) recorded outside their write transaction' }])
  })

  it("reports a step's rolled-back changes as a failed step", async () => {
    const engine = new MemoryEngine({
      steps: [step('backup', async () => ({ opsWritten: 1, errors: ['p1: memory_ops insert failed'] }))],
      changes: () => fakeLog(),
      clock: () => NOW,
    })
    const result = await engine.runNight('user-1')
    expect(result.opsWritten).toBe(1)
    expect(result.failedSteps).toEqual([{ step: 'backup', error: '1 change(s) rolled back: p1: memory_ops insert failed' }])
  })

  it('isolates a failing step and still runs the rest', async () => {
    const log = fakeLog()
    const engine = new MemoryEngine({
      steps: [step('a', async () => { throw new Error('boom') }), step('b')],
      changes: () => log,
      clock: () => NOW,
    })
    const result = await engine.runNight('user-1')
    expect(result.failedSteps).toEqual([{ step: 'a', error: 'boom' }])
    expect(result.steps.map((s) => s.step)).toEqual(['b'])
    expect(log.flush).not.toHaveBeenCalled()
  })

  it('never flushes on a dry run and reports the planned ops', async () => {
    const log = fakeLog()
    const engine = new MemoryEngine({
      steps: [step('a', async (ctx) => { expect(ctx.dryRun).toBe(true); ctx.changes.record(op('x')) }), step('b')],
      changes: () => log,
    })
    const result = await engine.runNight('user-1', { dryRun: true })
    expect(log.flush).not.toHaveBeenCalled()
    expect(result).toMatchObject({ dryRun: true, opsWritten: 0, opsPlanned: 1 })
  })

  it('skips the remaining steps once the deadline passes and says so', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    const ran: string[] = []
    const engine = new MemoryEngine({
      steps: [
        step('a', async (ctx) => { ran.push('a'); expect(ctx.deadline).toBe(1_000); clock.mockReturnValue(2_000) }),
        step('b', async () => { ran.push('b') }),
      ],
      changes: () => fakeLog(),
    })
    try {
      const result = await engine.runNight('user-1', { deadline: 1_000 })
      expect(ran).toEqual(['a'])
      expect(result.outOfTime).toBe(true)
      expect(result.steps[1]).toMatchObject({ step: 'b', skipped: 'out of time', outOfTime: true })
    } finally {
      clock.mockRestore()
    }
  })

  it('carries a step-level out-of-time flag to the run result', async () => {
    const engine = new MemoryEngine({
      steps: [step('a', async () => ({ outOfTime: true }))],
      changes: () => fakeLog(),
    })
    expect((await engine.runNight('user-1')).outOfTime).toBe(true)
  })

  it('caps a step at its own budget and still runs the later steps when it overruns', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    const seen: Array<[string, number | undefined]> = []
    const slow: Step = {
      name: 'weigh',
      budgetMs: 1_000,
      run: async (ctx) => {
        seen.push(['weigh', ctx.deadline])
        clock.mockReturnValue(5_000) // ran 5× past its slice
        return { step: 'weigh', examined: 1, changed: 0, outOfTime: true }
      },
    }
    const engine = new MemoryEngine({
      steps: [slow, step('backup', async (ctx) => { seen.push(['backup', ctx.deadline]) })],
      changes: () => fakeLog(),
    })
    try {
      const result = await engine.runNight('user-1', { deadline: 100_000 })
      expect(seen).toEqual([['weigh', 1_000], ['backup', 100_000]])
      expect(result.steps.map((s) => s.step)).toEqual(['weigh', 'backup'])
      expect(result.outOfTime).toBe(true)
      expect(result.failedSteps).toEqual([])
    } finally {
      clock.mockRestore()
    }
  })

  it('stops earlier steps short of what a later step reserves, so that step still runs', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    const seen: Array<[string, number | undefined]> = []
    const concepts: Step = {
      name: 'concepts',
      reserveMs: () => 20_000,
      run: async (ctx) => {
        seen.push(['concepts', ctx.deadline])
        return { step: 'concepts', examined: 0, changed: 0 }
      },
    }
    const engine = new MemoryEngine({
      steps: [
        step('backup', async (ctx) => { seen.push(['backup', ctx.deadline]); clock.mockReturnValue(85_000); return { outOfTime: true } }),
        concepts,
      ],
      changes: () => fakeLog(),
    })
    try {
      const result = await engine.runNight('user-1', { deadline: 100_000 })
      expect(seen).toEqual([['backup', 80_000], ['concepts', 100_000]])
      expect(result.steps[1]).not.toHaveProperty('skipped')
    } finally {
      clock.mockRestore()
    }
  })

  it('a step whose window is gone is skipped while a later step with time left still runs', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(90_000)
    const ran: string[] = []
    const engine = new MemoryEngine({
      steps: [
        step('backup', async () => { ran.push('backup') }),
        { name: 'concepts', reserveMs: () => 20_000, run: async () => { ran.push('concepts'); return { step: 'concepts', examined: 0, changed: 0 } } },
      ],
      changes: () => fakeLog(),
    })
    try {
      const result = await engine.runNight('user-1', { deadline: 100_000 })
      expect(ran).toEqual(['concepts'])
      expect(result.steps[0]).toMatchObject({ step: 'backup', skipped: 'out of time', outOfTime: true })
    } finally {
      clock.mockRestore()
    }
  })

  it('a step that throws (e.g. a DB timeout) does not stop the later steps', async () => {
    const ran: string[] = []
    const engine = new MemoryEngine({
      steps: [
        step('weigh', async () => { throw new Error('Query read timeout') }),
        step('own_mind', async () => { ran.push('own_mind') }),
        step('backup', async () => { ran.push('backup') }),
      ],
      changes: () => fakeLog(),
    })
    const result = await engine.runNight('user-1', { deadline: Date.now() + 60_000 })
    expect(ran).toEqual(['own_mind', 'backup'])
    expect(result.failedSteps).toEqual([{ step: 'weigh', error: 'Query read timeout' }])
  })
})

describe('buildNightSteps', () => {
  it('runs Surprise between Weigh and OwnMind, then the belief re-check before BackUp', () => {
    const steps = buildNightSteps()
    expect(steps.map((s) => s.name)).toEqual(['merge', 'weigh', 'surprise', 'own_mind', 'recheck', 'backup', 'concepts'])
    expect(steps[1]).toBeInstanceOf(WeighStep)
    expect(steps.find((s) => s.name === 'surprise')!.budgetMs).toBeLessThanOrEqual(10_000)
  })

  it('caps Merge and Weigh, lets BackUp drain the rest, and reserves Concepts time on Sundays only', () => {
    const steps = buildNightSteps()
    const by = (n: string) => steps.find((s) => s.name === n)!
    expect(by('merge').budgetMs).toBeGreaterThan(0)
    expect(by('weigh').budgetMs).toBeGreaterThan(0)
    expect(by('backup').budgetMs).toBeUndefined()
    const at = (iso: string) => ({ userId: 'u', runId: 'r', now: new Date(iso), dryRun: false, changes: fakeLog() })
    expect(by('concepts').reserveMs?.(at('2026-10-04T01:30:00Z'))).toBeGreaterThan(0) // Sunday
    expect(by('concepts').reserveMs?.(at('2026-10-02T01:30:00Z'))).toBe(0) // Friday
  })
})
