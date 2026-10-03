import { beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('../registry', () => ({ getThinkingHandlers: () => [] }))
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true), PAID_BACKUP_OFF_NOTE: 'paid backup off' }))

import { claimNextJob, failJob, findJobById, releaseForFallback, upsertJob } from '@/lib/data/thinking-jobs'
import { ThinkingQueue, claimThinkingJob } from '../queue'
import { getRoutine } from '@/lib/kairos/routines/catalog'

// Daytime cadence on the queue: the pulse and reflect kinds are reached only
// through their own routine's scope, and neither has a fallback.

const USER = 'user-1'
const JOB = '22222222-2222-4222-8222-222222222222'
const TOKEN = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-10-01T10:10:00.000Z')

function job(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: JOB, userId: USER, kind: 'pulse', dominionId: null, externalKey: 'pulse:2026-10-01:11', status: 'claimed',
    input: { system: 's', prompt: 'p' }, output: null, claimedBy: 'routine:pulse', claimToken: TOKEN, claimedAt: NOW,
    deadlineAt: new Date('2026-10-01T10:55:00.000Z'), completedAt: null, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  }
}

function handler(kind: ThinkingJobKind, log: string[]): ThinkingJobHandler {
  return {
    kind,
    plan: vi.fn(async () => { log.push(kind); return [] }),
    apply: vi.fn(async () => ({ ok: true as const, memoryIds: [] })),
    fallback: vi.fn(async () => ({ ok: false as const, reason: 'no fallback' })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KAIROS_REQUIRE_ROUTINE_SCOPE
  vi.mocked(upsertJob).mockResolvedValue(null)
  vi.mocked(claimNextJob).mockResolvedValue(job())
})

describe('claims — daytime scope', () => {
  it('an unscoped (old brain prompt) claim never reaches pulse jobs', async () => {
    await claimThinkingJob(USER, {})
    const kinds = vi.mocked(claimNextJob).mock.calls[0][1]
    expect(kinds).toEqual(getRoutine('brain').allowedKinds)
    expect(kinds).toContain('reflect')
    expect(kinds).not.toContain('pulse')
  })

  it('a pulse claim claims only pulse jobs as routine:pulse', async () => {
    await claimThinkingJob(USER, { routine: 'pulse' })
    expect(claimNextJob).toHaveBeenCalledWith(USER, ['pulse'], 'routine:pulse')
  })

  it.each([
    ['pulse', ['cortex']],
    ['pulse', ['reflect']],
    ['brain', ['pulse']],
  ] as const)('a %s claim for %j is refused, nothing claimed', async (routine, kinds) => {
    expect(await claimThinkingJob(USER, { kinds: [...kinds], routine })).toMatchObject({ job: null, code: 'scope_denied' })
    expect(claimNextJob).not.toHaveBeenCalled()
  })

  it('a pulse claim plans only the pulse; a brain claim plans reflect but never the pulse', async () => {
    const log: string[] = []
    const q = new ThinkingQueue([handler('cortex', log), handler('reflect', log), handler('pulse', log)])
    await q.claim(USER, getRoutine('pulse').allowedKinds, NOW, 'pulse')
    expect(log).toEqual(['pulse'])
    log.length = 0
    await q.claim(USER, getRoutine('brain').allowedKinds, NOW, 'brain')
    expect(log).toEqual(['cortex', 'reflect'])
  })
})

describe('submit — daytime kinds have no fallback', () => {
  it.each(['pulse', 'reflect'] as const)('a late %s is failed, never released to the paid sweep', async (kind) => {
    vi.mocked(findJobById).mockResolvedValue(job({ kind, claimedBy: kind === 'pulse' ? 'routine:pulse' : 'routine:brain' }))
    const late = new Date('2026-10-01T11:00:00.000Z')
    const res = await new ThinkingQueue([handler(kind, [])]).submit(USER, JOB, TOKEN, '{}', late)
    expect(res).toMatchObject({ ok: false, code: 'deadline_passed' })
    expect(!res.ok && res.error).toContain('nothing — a missed hour is fine')
    expect(failJob).toHaveBeenCalled()
    expect(releaseForFallback).not.toHaveBeenCalled()
  })

  it('a pulse job held by routine:pulse cannot be answered as the brain', async () => {
    vi.mocked(findJobById).mockResolvedValue(job())
    const res = await new ThinkingQueue([handler('pulse', [])]).submit(USER, JOB, TOKEN, '{}', NOW, 'brain')
    expect(res).toMatchObject({ ok: false, code: 'scope_denied' })
  })
})
