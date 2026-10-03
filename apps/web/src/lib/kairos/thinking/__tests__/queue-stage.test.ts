import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobHandler, ThinkingJobKind, ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/data/thinking-jobs', () => ({
  upsertJob: vi.fn(),
  claimNextJob: vi.fn(),
  findJobById: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  releaseForFallback: vi.fn(),
  expireOverdue: vi.fn(async () => []),
  listPendingFallbacks: vi.fn(async () => []),
  hasJobWithKeyLike: vi.fn(),
  recordFallback: vi.fn(async () => ({})),
  listJobs: vi.fn(),
  mergeJobOutput: vi.fn(async () => true),
}))
vi.mock('../registry', () => ({ getThinkingHandlers: () => [] }))
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true), PAID_BACKUP_OFF_NOTE: 'off' }))
vi.mock('@/lib/data/kairos-stage', () => ({ readKairosStage: vi.fn(), mutateKairosStage: vi.fn() }))
vi.mock('@/lib/kairos/stage/ambient', () => ({ gatherAmbient: vi.fn(async () => []) }))

import { claimNextJob, completeJob, findJobById, listPendingFallbacks, mergeJobOutput, recordFallback } from '@/lib/data/thinking-jobs'
import { mutateKairosStage, readKairosStage } from '@/lib/data/kairos-stage'
import { applyStagePost, emptyStageState } from '@/lib/kairos/stage/select'
import type { KairosStageState } from '@/lib/kairos/stage/types'
import { ThinkingQueue, claimThinkingJob, createSweepBudget } from '../queue'

const USER = 'user-1'
const TOKEN = '33333333-3333-4333-8333-333333333333'
const NOW = new Date()
const thought = { text: 'Billing migration is slipping', importance: 0.9, surprise: 0.6, goalRelevance: 0.5, need: 0.5 }

function job(kind: ThinkingJobKind, over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: `job-${kind}`, userId: USER, kind, dominionId: null, externalKey: `${kind}:x`, status: 'claimed',
    input: { system: 'sys', prompt: 'prompt', validMemoryIds: [] }, output: null, claimedBy: 'routine', claimToken: TOKEN,
    claimedAt: NOW, deadlineAt: new Date(NOW.getTime() + 3_600_000), completedAt: null, attempts: 1, error: null,
    createdAt: NOW, updatedAt: NOW, ...over,
  }
}

function handler(kind: ThinkingJobKind, over: Partial<ThinkingJobHandler> = {}): ThinkingJobHandler {
  return {
    kind,
    plan: vi.fn(async () => []),
    apply: vi.fn(async () => ({ ok: true as const, memoryIds: ['mem-1'], thoughts: [thought] })),
    fallback: vi.fn(async () => ({ ok: true as const, memoryIds: ['mem-2'], thoughts: [thought] })),
    ...over,
  }
}

let stored: KairosStageState
function stage(state: KairosStageState) {
  stored = state
  vi.mocked(readKairosStage).mockImplementation(async () => stored)
  vi.mocked(mutateKairosStage).mockImplementation(async (_u, mutate) => {
    const { state: next, result } = mutate(stored)
    if (next) stored = next
    return result
  })
}

const seeded = (tier: 'deep' | 'light' = 'deep') => applyStagePost(emptyStageState(), {
  post: { kind: tier === 'light' ? 'pulse' : 'reflect', source: 'job', tier, jobId: 'seed', items: [{ ...thought, text: 'Audit prep needs a plan' }] },
}, NOW).state!

beforeEach(() => {
  vi.clearAllMocks()
  stage(seeded())
})
afterEach(() => vi.unstubAllEnvs())

describe('stage off (default): byte-identical queue', () => {
  it('serves the stored prompt, stamps nothing, posts nothing, adds no output key', async () => {
    vi.stubEnv('KAIROS_STAGE', '')
    vi.mocked(claimNextJob).mockResolvedValue(job('cortex'))
    const res = await claimThinkingJob(USER, { kinds: ['cortex'] })
    expect(res.job?.prompt).toBe('prompt')
    expect(mergeJobOutput).not.toHaveBeenCalled()

    vi.mocked(findJobById).mockResolvedValue(job('cortex'))
    await new ThinkingQueue([handler('cortex')]).submit(USER, 'job-cortex', TOKEN, 'x', NOW)
    expect(completeJob).toHaveBeenCalledWith(USER, 'job-cortex', TOKEN, { memoryIds: ['mem-1'], answeredBy: 'routine', chars: 1 }, 'routine')
    expect(readKairosStage).not.toHaveBeenCalled()
    expect(mutateKairosStage).not.toHaveBeenCalled()
  })
})

describe('stage on', () => {
  beforeEach(() => vi.stubEnv('KAIROS_STAGE', '1'))

  it('prepends the block to a reader\'s prompt (never the system) and stamps lineage', async () => {
    vi.mocked(claimNextJob).mockResolvedValue(job('cortex'))
    const res = await claimThinkingJob(USER, { kinds: ['cortex'] })
    expect(res.job?.system).toBe('sys')
    expect(res.job?.prompt).toMatch(/^## Stage[\s\S]*BEGIN STAGE DATA\nI, now: Audit prep needs a plan\nEND STAGE DATA\n\nprompt$/)
    expect(mergeJobOutput).toHaveBeenCalledWith(USER, 'job-cortex', { stage: { cycle: expect.stringMatching(/T\d{2}$/), given: [stored.coalitions[0].id] } })
  })

  it.each(['belief_extract', 'idea_judge', 'chat', 'daily_message'] as const)('leaves %s alone (blind or self-injected)', async (kind) => {
    vi.mocked(claimNextJob).mockResolvedValue(job(kind))
    const res = await claimThinkingJob(USER, { kinds: [kind] })
    expect(res.job?.prompt).toBe('prompt')
    expect(mergeJobOutput).not.toHaveBeenCalled()
  })

  it('goal_propose sees only deep-backed coalitions', async () => {
    stage(seeded('light'))
    vi.mocked(claimNextJob).mockResolvedValue(job('goal_propose'))
    expect((await claimThinkingJob(USER, { kinds: ['goal_propose'] })).job?.prompt).toBe('prompt')
  })

  it('posts the outcome\'s thoughts after apply and keeps lineage on the completed output', async () => {
    vi.mocked(findJobById).mockResolvedValue(job('reflect', { output: { stage: { cycle: '2026-10-03T10', given: ['c_00000000'] } } }))
    const res = await new ThinkingQueue([handler('reflect')]).submit(USER, 'job-reflect', TOKEN, 'x', NOW)
    expect(res.ok).toBe(true)
    expect(stored.postedJobs).toContain('job-reflect')
    expect(stored.coalitions.map((c) => c.text)).toContain('Billing migration is slipping')
    expect(completeJob).toHaveBeenCalledWith(USER, 'job-reflect', TOKEN, {
      stage: { cycle: '2026-10-03T10', given: ['c_00000000'], posted: 1, merged: 0 },
      memoryIds: ['mem-1'], answeredBy: 'routine', chars: 1,
    }, 'routine')
  })

  it('a failing stage write never fails the job', async () => {
    vi.mocked(mutateKairosStage).mockRejectedValue(new Error('lock timeout'))
    vi.mocked(findJobById).mockResolvedValue(job('reflect'))
    const res = await new ThinkingQueue([handler('reflect')]).submit(USER, 'job-reflect', TOKEN, 'x', NOW)
    expect(res.ok).toBe(true)
    expect(completeJob).toHaveBeenCalledWith(USER, 'job-reflect', TOKEN, expect.objectContaining({ stage: { posted: 0, merged: 0 } }), 'routine')
  })

  it('sweep fallbacks get the block in memory only, and record lineage with the fallback', async () => {
    const pending = job('weekly_review', { status: 'expired' })
    vi.mocked(listPendingFallbacks).mockResolvedValue([pending])
    const h = handler('weekly_review')
    await new ThinkingQueue([h]).sweep(USER, NOW, createSweepBudget({ maxFallbacks: 1, budgetMs: 60_000 }))
    const served = vi.mocked(h.fallback).mock.calls[0][0]
    expect(served.input.prompt).toMatch(/^## Stage[\s\S]*\n\nprompt$/)
    expect(served.input.system).toBe('sys')
    expect(pending.input.prompt).toBe('prompt')
    expect(recordFallback).toHaveBeenCalledWith(USER, pending.id, expect.objectContaining({
      ok: true, output: { stage: expect.objectContaining({ given: [expect.stringMatching(/^c_/)], posted: 1 }) },
    }), NOW)
  })
})

describe('stage observe', () => {
  beforeEach(() => vi.stubEnv('KAIROS_STAGE', 'observe'))

  it('posts and records counts, but never injects', async () => {
    vi.mocked(claimNextJob).mockResolvedValue(job('cortex'))
    expect((await claimThinkingJob(USER, { kinds: ['cortex'] })).job?.prompt).toBe('prompt')
    expect(mergeJobOutput).not.toHaveBeenCalled()
    vi.mocked(findJobById).mockResolvedValue(job('cortex'))
    await new ThinkingQueue([handler('cortex')]).submit(USER, 'job-cortex', TOKEN, 'x', NOW)
    expect(completeJob).toHaveBeenCalledWith(USER, 'job-cortex', TOKEN, expect.objectContaining({ stage: { posted: 1, merged: 0 } }), 'routine')
  })
})
