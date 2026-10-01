import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobHandler, ThinkingJobKind, ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/data/thinking-jobs', () => ({
  upsertJob: vi.fn(),
  claimNextJob: vi.fn(),
  findJobById: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  releaseForFallback: vi.fn(),
  expireOverdue: vi.fn(),
  listPendingFallbacks: vi.fn(),
  hasJobWithKeyLike: vi.fn(),
  recordFallback: vi.fn(),
  listJobs: vi.fn(),
}))

// The real registry pulls in the aether/cortex modules (and the DB); the
// queue under test always gets explicit fake handlers.
vi.mock('../registry', () => ({ getThinkingHandlers: () => [] }))

import {
  claimNextJob,
  completeJob,
  expireOverdue,
  failJob,
  findJobById,
  hasJobWithKeyLike,
  listPendingFallbacks,
  recordFallback,
  releaseForFallback,
  upsertJob,
} from '@/lib/data/thinking-jobs'
import {
  CHAT_JOB_INSTRUCTIONS,
  SWEEP_PLAN_SKIP_KINDS,
  TEXT_JOB_INSTRUCTIONS,
  THINKING_JOB_INSTRUCTIONS,
  ThinkingQueue,
  createSweepBudget,
  jobInstructions,
  submitErrorStatus,
} from '../queue'

const USER = 'user-1'
const JOB = '22222222-2222-4222-8222-222222222222'
const TOKEN = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-10-01T02:45:00.000Z')

function job(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: JOB,
    userId: USER,
    kind: 'cortex',
    dominionId: null,
    externalKey: 'cortex:d:2026-10-01',
    status: 'claimed',
    input: { system: 'sys', prompt: 'prompt', validMemoryIds: [] },
    output: null,
    claimedBy: 'routine',
    claimToken: TOKEN,
    claimedAt: NOW,
    deadlineAt: new Date('2026-10-01T02:58:00.000Z'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function handler(kind: ThinkingJobKind, log: string[] = [], overrides: Partial<ThinkingJobHandler> = {}): ThinkingJobHandler {
  return {
    kind,
    plan: vi.fn(async () => {
      log.push(`plan:${kind}`)
      return [{ kind, dominionId: null, externalKey: `${kind}:k`, deadlineMinutes: 10, input: { system: 's', prompt: 'p' } }]
    }),
    apply: vi.fn(async () => ({ ok: true as const, memoryIds: ['mem-1'] })),
    fallback: vi.fn(async () => ({ ok: false as const, reason: 'deferred to cron' })),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(upsertJob).mockImplementation(async (_u, spec) => {
    return job({ kind: spec.kind, externalKey: spec.externalKey, status: 'queued' })
  })
  vi.mocked(listPendingFallbacks).mockResolvedValue([])
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
})

describe('ThinkingQueue.planDue / claim — lazy planning in prerequisite order', () => {
  it('plans cortex before aether whatever the registry order, upserting every spec', async () => {
    const log: string[] = []
    const q = new ThinkingQueue([handler('aether', log), handler('cortex', log)])
    const res = await q.planDue(USER, NOW)
    expect(log).toEqual(['plan:cortex', 'plan:aether'])
    expect(vi.mocked(upsertJob).mock.calls.map((c) => c[1].kind)).toEqual(['cortex', 'aether'])
    expect(res.planned).toHaveLength(2)
  })

  it('does not count a conflict (already planned) as planned', async () => {
    vi.mocked(upsertJob).mockResolvedValue(null)
    const q = new ThinkingQueue([handler('cortex')])
    expect((await q.planDue(USER, NOW)).planned).toEqual([])
  })

  it('a throwing plan is reported and does not block the other kinds', async () => {
    const q = new ThinkingQueue([
      handler('cortex', [], { plan: vi.fn(async () => { throw new Error('db down') }) }),
      handler('aether'),
    ])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await q.planDue(USER, NOW)
    expect(res.errors).toEqual([{ kind: 'cortex', error: 'db down' }])
    expect(res.planned.map((r) => r.kind)).toEqual(['aether'])
  })

  it('planDue skips the given kinds (the sweep never plans concept/chat)', async () => {
    const log: string[] = []
    const q = new ThinkingQueue([handler('concept', log), handler('weekly_review', log), handler('chat', log), handler('daily_message', log)])
    const res = await q.planDue(USER, NOW, { skipKinds: SWEEP_PLAN_SKIP_KINDS })
    expect(log).toEqual(['plan:weekly_review', 'plan:daily_message'])
    expect(res.planned.map((r) => r.kind)).toEqual(['weekly_review', 'daily_message'])
  })

  it('plans the former paid-key kinds in their night order', async () => {
    const log: string[] = []
    const kinds: ThinkingJobKind[] = [
      'daily_message', 'micro_consolidate', 'introspection', 'brief', 'contradiction', 'ask_mine',
      'idea_generate', 'aether', 'cortex', 'archetype', 'chat_distill',
    ]
    await new ThinkingQueue(kinds.map((k) => handler(k, log))).planDue(USER, NOW)
    expect(log).toEqual([
      'plan:chat_distill', 'plan:archetype', 'plan:cortex', 'plan:aether', 'plan:idea_generate',
      'plan:ask_mine', 'plan:contradiction', 'plan:brief', 'plan:introspection', 'plan:micro_consolidate',
      'plan:daily_message',
    ])
  })

  it('the sweep never plans a micro_consolidate fold (claim-only, so its window ends at the claim)', async () => {
    const log: string[] = []
    await new ThinkingQueue([handler('micro_consolidate', log), handler('brief', log)]).planDue(USER, NOW, { skipKinds: SWEEP_PLAN_SKIP_KINDS })
    expect(log).toEqual(['plan:brief'])
  })

  it('a kinds-filtered claim plans only those kinds; an unfiltered claim plans all', async () => {
    const log: string[] = []
    const q = new ThinkingQueue([handler('contradiction', log), handler('brief', log), handler('daily_message', log)])
    await q.claim(USER, ['brief', 'daily_message'], NOW)
    expect(log).toEqual(['plan:brief', 'plan:daily_message'])
    log.length = 0
    await q.claim(USER, undefined, NOW)
    expect(log).toEqual(['plan:contradiction', 'plan:brief', 'plan:daily_message'])
  })

  it('claim plans first, then claims (with the kinds filter)', async () => {
    const order: string[] = []
    vi.mocked(upsertJob).mockImplementation(async () => { order.push('upsert'); return null })
    vi.mocked(claimNextJob).mockImplementation(async () => { order.push('claim'); return job() })
    const q = new ThinkingQueue([handler('cortex')])
    const claimed = await q.claim(USER, ['cortex'], NOW)
    expect(order).toEqual(['upsert', 'claim'])
    expect(claimNextJob).toHaveBeenCalledWith(USER, ['cortex'])
    expect(claimed?.id).toBe(JOB)
  })
})

describe('ThinkingQueue.planDue — concept planning at most once per ISO week', () => {
  const SUNDAY = new Date('2026-10-04T02:45:00.000Z')

  it('plans concepts on Sunday when no job of this week exists yet', async () => {
    const concept = handler('concept')
    await new ThinkingQueue([concept]).planDue(USER, SUNDAY)
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'concept', 'concept:%:2026-W40:%')
    expect(concept.plan).toHaveBeenCalledTimes(1)
  })

  it('skips the (expensive) concept plan once this week has a concept job, but still plans the rest', async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValue(true)
    const concept = handler('concept')
    const cortex = handler('cortex')
    const res = await new ThinkingQueue([concept, cortex]).planDue(USER, SUNDAY)
    expect(concept.plan).not.toHaveBeenCalled()
    expect(cortex.plan).toHaveBeenCalledTimes(1)
    expect(res.planned.map((r) => r.kind)).toEqual(['cortex'])
  })

  it('never touches concept planning off Sunday', async () => {
    const concept = handler('concept')
    await new ThinkingQueue([concept]).planDue(USER, NOW)
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
    expect(concept.plan).not.toHaveBeenCalled()
  })
})

describe('ThinkingQueue.submit', () => {
  it('applies through the handler as routine and completes the job with the memory ids', async () => {
    const h = handler('cortex')
    vi.mocked(findJobById).mockResolvedValue(job())
    const res = await new ThinkingQueue([h]).submit(USER, JOB, TOKEN, '{"x":1}', NOW)
    expect(res).toEqual({ ok: true, jobId: JOB, kind: 'cortex', memoryIds: ['mem-1'] })
    expect(h.apply).toHaveBeenCalledWith(expect.objectContaining({ id: JOB }), '{"x":1}', 'routine')
    expect(completeJob).toHaveBeenCalledWith(USER, JOB, TOKEN, { memoryIds: ['mem-1'], answeredBy: 'routine', chars: 7 }, 'routine')
    expect(failJob).not.toHaveBeenCalled()
  })

  it('a rejected answer fails a cron-covered job with the handler reason and its fallback owner (422)', async () => {
    const h = handler('cortex', [], { apply: vi.fn(async () => ({ ok: false as const, reason: 'parse_failed: visionAnchor: too short' })) })
    vi.mocked(findJobById).mockResolvedValue(job())
    const res = await new ThinkingQueue([h]).submit(USER, JOB, TOKEN, 'nope', NOW)
    const error = 'parse_failed: visionAnchor: too short; the 03:00 UTC cortex-regen cron covers this job'
    expect(res).toMatchObject({ ok: false, code: 'apply_failed', error })
    expect(failJob).toHaveBeenCalledWith(USER, JOB, TOKEN, error)
    expect(releaseForFallback).not.toHaveBeenCalled()
    expect(completeJob).not.toHaveBeenCalled()
    expect(submitErrorStatus('apply_failed')).toBe(422)
  })

  it('a throwing apply is caught and fails the job', async () => {
    const h = handler('cortex', [], { apply: vi.fn(async () => { throw new Error('tx aborted') }) })
    vi.mocked(findJobById).mockResolvedValue(job())
    const res = await new ThinkingQueue([h]).submit(USER, JOB, TOKEN, '{}', NOW)
    expect(res).toMatchObject({ ok: false, code: 'apply_failed', error: expect.stringMatching(/^apply_error: tx aborted; /) })
    expect(failJob).toHaveBeenCalled()
  })

  it.each([
    ['not_found', null, 404],
    ['not_claimed', job({ status: 'expired' }), 409],
    ['bad_token', job({ claimToken: '44444444-4444-4444-8444-444444444444' }), 409],
  ] as const)('rejects %s without touching the job', async (code, row, status) => {
    const h = handler('cortex')
    vi.mocked(findJobById).mockResolvedValue(row)
    const res = await new ThinkingQueue([h]).submit(USER, JOB, TOKEN, '{}', NOW)
    expect(res).toMatchObject({ ok: false, code })
    expect(submitErrorStatus(code)).toBe(status)
    expect(h.apply).not.toHaveBeenCalled()
    expect(failJob).not.toHaveBeenCalled()
    expect(completeJob).not.toHaveBeenCalled()
  })

  it('a submit after the deadline fails a cron-covered job and names its cron', async () => {
    const h = handler('cortex')
    vi.mocked(findJobById).mockResolvedValue(job())
    const res = await new ThinkingQueue([h]).submit(USER, JOB, TOKEN, '{}', new Date('2026-10-01T02:59:00.000Z'))
    expect(res).toMatchObject({ ok: false, code: 'deadline_passed', error: expect.stringContaining('03:00 UTC cortex-regen cron') })
    expect(h.apply).not.toHaveBeenCalled()
    expect(failJob).toHaveBeenCalledWith(USER, JOB, TOKEN, expect.stringContaining('deadline_passed'))
    expect(releaseForFallback).not.toHaveBeenCalled()
  })

  it('a late concept submit releases the job to the sweep fallback instead of failing it', async () => {
    const h = handler('concept')
    vi.mocked(findJobById).mockResolvedValue(job({ kind: 'concept', externalKey: 'concept:d:2026-W40:abc' }))
    const res = await new ThinkingQueue([h]).submit(USER, JOB, TOKEN, '{}', new Date('2026-10-01T02:59:00.000Z'))
    expect(res).toMatchObject({ ok: false, code: 'deadline_passed', error: expect.stringContaining('thinking-sweep') })
    expect(h.apply).not.toHaveBeenCalled()
    expect(releaseForFallback).toHaveBeenCalledWith(USER, JOB, TOKEN, expect.stringMatching(/^deadline_passed: /))
    expect(failJob).not.toHaveBeenCalled()
  })

  it('a rejected concept answer releases the job to the sweep fallback with the reason', async () => {
    const h = handler('concept', [], { apply: vi.fn(async () => ({ ok: false as const, reason: 'concept rejected: too few citations' })) })
    vi.mocked(findJobById).mockResolvedValue(job({ kind: 'concept' }))
    const res = await new ThinkingQueue([h]).submit(USER, JOB, TOKEN, 'x', NOW)
    expect(res).toMatchObject({ ok: false, code: 'apply_failed' })
    expect(releaseForFallback).toHaveBeenCalledWith(USER, JOB, TOKEN, expect.stringMatching(/^concept rejected: too few citations; the hourly thinking-sweep/))
    expect(failJob).not.toHaveBeenCalled()
  })
})

describe('ThinkingQueue.sweep', () => {
  it('expires overdue jobs; cron kinds record their declining fallback, concept runs from the pending list', async () => {
    const cortex = handler('cortex')
    const concept = handler('concept', [], { fallback: vi.fn(async () => ({ ok: true as const, memoryIds: ['c1'] })) })
    vi.mocked(expireOverdue).mockResolvedValue([
      job({ id: 'a', kind: 'cortex', status: 'expired' }),
      job({ id: 'b', kind: 'concept', status: 'expired' }),
    ])
    vi.mocked(listPendingFallbacks).mockResolvedValue([job({ id: 'b', kind: 'concept', status: 'expired' })])
    const res = await new ThinkingQueue([cortex, concept]).sweep(USER, NOW, createSweepBudget({ maxFallbacks: 2, budgetMs: 1000 }))
    expect(expireOverdue).toHaveBeenCalledWith(NOW, USER)
    expect(listPendingFallbacks).toHaveBeenCalledWith(USER, ['concept', 'belief_extract', 'drift_probe', 'mind_compare', 'weekly_review', 'idea_generate', 'idea_judge'])
    expect(res).toEqual({
      expired: 2,
      deferred: 0,
      fallbacks: [
        { jobId: 'a', kind: 'cortex', ok: false, reason: 'deferred to cron' },
        { jobId: 'b', kind: 'concept', ok: true },
      ],
    })
    expect(concept.fallback).toHaveBeenCalledTimes(1)
    expect(recordFallback).toHaveBeenCalledWith(USER, 'b', { ok: true, memoryIds: ['c1'] }, NOW)
    expect(recordFallback).toHaveBeenCalledWith(USER, 'a', { ok: false, reason: 'deferred to cron' }, NOW)
  })

  it('runs a concept fallback released earlier by a late/rejected submit (nothing newly expired)', async () => {
    const concept = handler('concept', [], { fallback: vi.fn(async () => ({ ok: true as const, memoryIds: ['c1'] })) })
    vi.mocked(expireOverdue).mockResolvedValue([])
    vi.mocked(listPendingFallbacks).mockResolvedValue([job({ id: 'late', kind: 'concept', status: 'expired', error: 'deadline_passed: …' })])
    const res = await new ThinkingQueue([concept]).sweep(USER, NOW)
    expect(res.fallbacks).toEqual([{ jobId: 'late', kind: 'concept', ok: true }])
  })

  it('bounds model work: at most N fallbacks per budget, the rest deferred to the next sweep', async () => {
    const concept = handler('concept', [], { fallback: vi.fn(async () => ({ ok: true as const, memoryIds: ['c'] })) })
    vi.mocked(expireOverdue).mockResolvedValue([])
    vi.mocked(listPendingFallbacks).mockResolvedValue(['p1', 'p2', 'p3'].map((id) => job({ id, kind: 'concept', status: 'expired' })))
    const budget = createSweepBudget({ maxFallbacks: 2, budgetMs: 60_000 })
    const q = new ThinkingQueue([concept])
    const first = await q.sweep(USER, NOW, budget)
    expect(first.fallbacks.map((f) => f.jobId)).toEqual(['p1', 'p2'])
    expect(first.deferred).toBe(1)
    // The budget is shared across users within one invocation.
    const second = await q.sweep('user-2', NOW, budget)
    expect(second.fallbacks).toEqual([])
    expect(second.deferred).toBe(3)
    expect(concept.fallback).toHaveBeenCalledTimes(2)
    expect(recordFallback).toHaveBeenCalledTimes(2)
  })

  it('stops starting fallbacks once the wall-clock budget is spent', async () => {
    let t = 0
    const concept = handler('concept', [], {
      fallback: vi.fn(async () => { t += 150_000; return { ok: true as const, memoryIds: ['c'] } }),
    })
    vi.mocked(expireOverdue).mockResolvedValue([])
    vi.mocked(listPendingFallbacks).mockResolvedValue(['p1', 'p2', 'p3'].map((id) => job({ id, kind: 'concept', status: 'expired' })))
    const res = await new ThinkingQueue([concept]).sweep(USER, NOW, createSweepBudget({ maxFallbacks: 10, budgetMs: 200_000, clock: () => t }))
    expect(res.fallbacks.map((f) => f.jobId)).toEqual(['p1', 'p2'])
    expect(res.deferred).toBe(1)
  })
})

describe('createSweepBudget env overrides', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('defaults to 2 fallbacks, overridable by KAIROS_SWEEP_MAX_FALLBACKS', () => {
    delete process.env.KAIROS_SWEEP_MAX_FALLBACKS
    const b = createSweepBudget({ clock: () => 0 })
    expect([b.tryStart(), b.tryStart(), b.tryStart()]).toEqual([true, true, false])
    process.env.KAIROS_SWEEP_MAX_FALLBACKS = '0'
    expect(createSweepBudget({ clock: () => 0 }).tryStart()).toBe(false)
    process.env.KAIROS_SWEEP_MAX_FALLBACKS = 'junk'
    expect(createSweepBudget({ clock: () => 0 }).tryStart()).toBe(true)
  })

  it('KAIROS_SWEEP_BUDGET_MS sets the wall-clock cut-off', () => {
    process.env.KAIROS_SWEEP_BUDGET_MS = '10'
    let t = 0
    const b = createSweepBudget({ maxFallbacks: 5, clock: () => t })
    expect(b.tryStart()).toBe(true)
    t = 10
    expect(b.tryStart()).toBe(false)
  })
})

describe('jobInstructions', () => {
  it('chat → chat text, brief / micro_consolidate → markdown, every other kind → JSON', () => {
    expect(jobInstructions('chat')).toBe(CHAT_JOB_INSTRUCTIONS)
    expect(jobInstructions('brief')).toBe(TEXT_JOB_INSTRUCTIONS)
    expect(jobInstructions('micro_consolidate')).toBe(TEXT_JOB_INSTRUCTIONS)
    for (const k of ['cortex', 'archetype', 'chat_distill', 'ask_mine', 'contradiction', 'introspection'] as const) {
      expect(jobInstructions(k)).toBe(THINKING_JOB_INSTRUCTIONS)
    }
  })
})
