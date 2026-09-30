import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/concepts', () => ({}))
vi.mock('@/lib/data/dominions', () => ({}))
vi.mock('@/lib/ai/provider', () => ({}))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class extends Error {},
  AiCredentialDecryptError: class extends Error {},
}))

import { ConceptStep } from '../steps/concepts'
import type { ChangeLog, EngineRunContext, ThinkingJobSpec } from '../types'

const SUNDAY = new Date('2026-10-04T01:30:00Z')
const SATURDAY = new Date('2026-10-03T01:30:00Z')

function spec(n: number): ThinkingJobSpec {
  return {
    kind: 'concept',
    dominionId: 'dom',
    externalKey: `concept:dom:2026-W40:${n}`,
    deadlineMinutes: 360,
    input: { system: 's', prompt: 'p', context: {} },
  }
}

function ctx(now: Date, dryRun = false): EngineRunContext {
  const changes: ChangeLog = {
    runId: 'run-1',
    record: vi.fn(),
    pending: () => [],
    flush: async () => 0,
  }
  return { userId: 'u', runId: 'run-1', now, dryRun, changes }
}

function fakeHandler(specs: ThinkingJobSpec[]) {
  return {
    plan: vi.fn().mockResolvedValue(specs),
    fallback: vi.fn().mockResolvedValue({ ok: true, memoryIds: ['m'] }),
  }
}

describe('ConceptStep', () => {
  it('skips outside Sunday without planning', async () => {
    const handler = fakeHandler([spec(1)])
    const res = await new ConceptStep({ handler, enqueue: vi.fn() }).run(ctx(SATURDAY))
    expect(res).toMatchObject({ step: 'concepts', skipped: 'not sunday' })
    expect(handler.plan).not.toHaveBeenCalled()
  })

  it('dry run plans only', async () => {
    const handler = fakeHandler([spec(1), spec(2)])
    const enqueue = vi.fn()
    const res = await new ConceptStep({ handler, enqueue }).run(ctx(SUNDAY, true))
    expect(res).toMatchObject({ examined: 2, changed: 0 })
    expect(handler.fallback).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('always enqueues (capped) and never calls the model fallback, whatever the env says', async () => {
    const handler = fakeHandler(Array.from({ length: 10 }, (_, i) => spec(i)))
    const enqueue = vi.fn().mockResolvedValue(3)
    vi.stubEnv('KAIROS_THINKING_QUEUE', '0')
    try {
      const res = await new ConceptStep({ handler, enqueue, maxPerRun: 3 }).run(ctx(SUNDAY))
      expect(enqueue).toHaveBeenCalledTimes(1)
      expect(enqueue.mock.calls[0][0]).toBe('u')
      expect(enqueue.mock.calls[0][1]).toHaveLength(3)
      expect(handler.fallback).not.toHaveBeenCalled()
      expect(res).toMatchObject({ examined: 3, changed: 0, notes: ['enqueued 3 concept jobs'] })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('lets an enqueue failure surface as a step failure (engine records it)', async () => {
    const handler = fakeHandler([spec(1)])
    const enqueue = vi.fn().mockRejectedValue(new Error('db down'))
    await expect(new ConceptStep({ handler, enqueue }).run(ctx(SUNDAY))).rejects.toThrow('db down')
    expect(handler.fallback).not.toHaveBeenCalled()
  })
})
