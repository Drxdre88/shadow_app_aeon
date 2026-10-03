import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import type { GoalRecord } from '@/lib/data/goals'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(), listJobs: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ listRecentMemories: vi.fn(), captureMemory: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({
  todayEnabled: vi.fn(() => true),
  loadTodayDigest: vi.fn(async () => null),
  appendTodayNotes: vi.fn(async () => undefined),
  countTodayEntriesSince: vi.fn(async () => 0),
}))

import { hasJobWithKeyLike, listJobs } from '@/lib/data/thinking-jobs'
import { captureMemory, listRecentMemories } from '@/lib/data/memories'
import { listOpenGoals } from '@/lib/data/goals'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { appendTodayNotes, countTodayEntriesSince } from '@/lib/kairos/today'
import { reflectHandler } from '../handlers/reflect'

const USER = 'user-1'
// 10:40Z on 1 Oct 2026 = 11:40 London (BST).
const NOW = new Date('2026-10-01T10:40:00.000Z')
const SLOT = 'reflect:2026-10-01:11'
const EVENT = { id: 'mem-ev-1', title: 'Captured session: pricing refactor', createdAt: NOW, streamClass: 'execution' }

function goal(id: string, state = 'active'): GoalRecord {
  return {
    id, title: `Goal ${id}`, type: 'kairos_goal', dominionId: null, archivedAt: null, createdAt: NOW,
    meta: { state, question: 'Why do pricing cards stall?', dueAt: '2026-10-08T00:00:00.000Z' },
  } as unknown as GoalRecord
}

function reflectJob(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: 'job-r', userId: USER, kind: 'reflect', dominionId: null, externalKey: SLOT, status: 'claimed',
    input: {
      system: 's', prompt: 'p', validMemoryIds: ['mem-ev-1', 'goal-1'],
      context: { slot: SLOT, goals: [{ id: 'goal-1', title: 'Pricing stalls' }], eventIds: ['mem-ev-1'] },
    },
    output: null, claimedBy: 'routine:brain', claimToken: 't', claimedAt: NOW, deadlineAt: new Date(NOW.getTime() + 50 * 60_000),
    completedAt: null, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  }
}

const doneToday = (n: number, goals: string[] = []) => Array.from({ length: n }, (_, i) => reflectJob({
  id: `done-${i}`, status: 'done', externalKey: `reflect:2026-10-01:${String(8 + i).padStart(2, '0')}`,
  createdAt: new Date(Date.parse('2026-10-01T06:40:00.000Z') + i * 3_600_000),
  input: { system: 's', prompt: 'p', context: { slot: 'x', goals: goals.map((id) => ({ id, title: id })), eventIds: [] } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_DAYTIME_THINKING = '1'
  delete process.env.KAIROS_REFLECT_MAX_PER_DAY
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(listOpenGoals).mockResolvedValue([])
  vi.mocked(countTodayEntriesSince).mockResolvedValue(3)
  vi.mocked(listRecentMemories).mockResolvedValue([EVENT])
  vi.mocked(readKairosPromises).mockResolvedValue({ v: 1, nextSeq: 2, open: [{ seq: 1, outcome: 'Ship the pricing fix', dueDate: '2026-10-03' }], closed: [] } as never)
  vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'mem-reflection' }, created: true } as never)
})
afterEach(() => {
  delete process.env.KAIROS_DAYTIME_THINKING
  delete process.env.KAIROS_REFLECT_MAX_PER_DAY
})

describe('reflect plan — gates', () => {
  it('flag off: plans nothing and reads nothing', async () => {
    delete process.env.KAIROS_DAYTIME_THINKING
    expect(await reflectHandler.plan(USER, NOW)).toEqual([])
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
  })

  it.each([
    ['07:40 London', '2026-10-01T06:40:00.000Z'],
    ['22:40 London', '2026-10-01T21:40:00.000Z'],
    ['02:40 London', '2026-10-01T01:40:00.000Z'],
  ])('closed window (%s): plans nothing', async (_label, iso) => {
    expect(await reflectHandler.plan(USER, new Date(iso))).toEqual([])
  })

  it('duplicate slot: plans nothing', async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValue(true)
    expect(await reflectHandler.plan(USER, NOW)).toEqual([])
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'reflect', SLOT)
  })

  it('daily cap: six finished reflections today → nothing; the cap is configurable', async () => {
    vi.mocked(listJobs).mockResolvedValue(doneToday(6))
    expect(await reflectHandler.plan(USER, NOW)).toEqual([])
    process.env.KAIROS_REFLECT_MAX_PER_DAY = '2'
    vi.mocked(listJobs).mockResolvedValue(doneToday(2))
    expect(await reflectHandler.plan(USER, NOW)).toEqual([])
  })

  it('no new activity and every active goal already reflected on: nothing', async () => {
    vi.mocked(listJobs).mockResolvedValue(doneToday(1, ['goal-1']))
    vi.mocked(listOpenGoals).mockResolvedValue([goal('goal-1')])
    vi.mocked(countTodayEntriesSince).mockResolvedValue(0)
    vi.mocked(listRecentMemories).mockResolvedValue([])
    expect(await reflectHandler.plan(USER, NOW)).toEqual([])
  })

  it('no activity but an active goal not yet reflected on today: plans', async () => {
    vi.mocked(listOpenGoals).mockResolvedValue([goal('goal-1'), goal('goal-p', 'proposed')])
    vi.mocked(countTodayEntriesSince).mockResolvedValue(0)
    vi.mocked(listRecentMemories).mockResolvedValue([])
    const [spec] = await reflectHandler.plan(USER, NOW)
    expect(spec).toMatchObject({ kind: 'reflect', externalKey: SLOT, deadlineMinutes: 50 })
    expect(spec.input.validMemoryIds).toEqual(['goal-1'])
    expect(countTodayEntriesSince).not.toHaveBeenCalled()
  })

  it('new activity: one 50-minute job with events, goals and promises in the prompt', async () => {
    vi.mocked(listOpenGoals).mockResolvedValue([goal('goal-1')])
    const [spec] = await reflectHandler.plan(USER, NOW)
    expect(spec).toMatchObject({ kind: 'reflect', externalKey: SLOT, deadlineMinutes: 50 })
    expect(spec.input.validMemoryIds).toEqual(['mem-ev-1', 'goal-1'])
    expect(spec.input.prompt).toContain('[mem-ev-1]')
    expect(spec.input.prompt).toContain('[goal-1]')
    expect(spec.input.prompt).toContain('P1 by 2026-10-03: Ship the pricing fix')
  })
})

describe('reflect apply — one grounded observation, nothing else', () => {
  it('writes one agentic observation, keeping only grounded goal notes and evidence', async () => {
    const answer = JSON.stringify({
      thought: 'The pricing refactor keeps coming back; it seems the stall is review, not code.',
      goalNotes: [{ goalId: 'goal-1', note: 'Today’s session suggests review is the bottleneck.' }, { goalId: 'goal-x', note: 'invented' }],
      evidenceIds: ['mem-ev-1', 'made-up'],
    })
    const res = await reflectHandler.apply(reflectJob(), answer, 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['mem-reflection'] })
    expect(captureMemory).toHaveBeenCalledTimes(1)
    const [, input] = vi.mocked(captureMemory).mock.calls[0]
    expect(input).toMatchObject({ type: 'observation', streamClass: 'agentic', tags: ['reflection'], dominionId: null })
    expect(input.links?.map((l) => l.target)).toEqual(['goal-1', 'mem-ev-1'])
    expect(input.sourceMetadata).toMatchObject({ externalId: SLOT, kind: 'reflection', jobId: 'job-r' })
    expect(input.bodyMd).toContain('Pricing stalls: Today’s session suggests review is the bottleneck.')
    expect(appendTodayNotes).not.toHaveBeenCalled()
    expect(res.ok && res.output).toMatchObject({ goalNotes: 1, dropped: 2 })
  })

  it('a null thought writes nothing', async () => {
    const res = await reflectHandler.apply(reflectJob(), '{"thought": null}', 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: [], output: { skipped: 'no_thought' } })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('wave-2 fields (followUps, predictions) are accepted and ignored', async () => {
    const answer = JSON.stringify({ thought: 'Noted.', followUps: [{ what: 'check' }], predictions: [{ claim: 'x' }, 1, 2, 3, 4, 5, 6] })
    const res = await reflectHandler.apply(reflectJob(), answer, 'routine')
    expect(res).toMatchObject({ ok: true, output: { wave2: { followUps: 1, predictions: 5 } } })
    expect(captureMemory).toHaveBeenCalledTimes(1)
  })

  it('flag switched off before the answer: writes nothing', async () => {
    delete process.env.KAIROS_DAYTIME_THINKING
    const res = await reflectHandler.apply(reflectJob(), '{"thought": "x"}', 'routine')
    expect(res).toMatchObject({ ok: true, output: { skipped: 'daytime_off' } })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('has no fallback', async () => {
    expect(await reflectHandler.fallback(reflectJob())).toEqual({ ok: false, reason: 'no fallback — a missed hour is fine' })
  })
})
