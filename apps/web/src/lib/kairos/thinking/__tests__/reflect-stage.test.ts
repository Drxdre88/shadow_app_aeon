import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(), listJobs: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ listRecentMemories: vi.fn(), captureMemory: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', async (importOriginal) => ({ ...(await importOriginal<object>()), readKairosPromises: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({
  todayEnabled: vi.fn(() => true),
  loadTodayDigest: vi.fn(async () => null),
  appendTodayNotes: vi.fn(async () => undefined),
  countTodayEntriesSince: vi.fn(async () => 0),
}))
vi.mock('@/lib/kairos/stage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  stageSurpriseDue: vi.fn(async () => false),
}))

import { hasJobWithKeyLike, listJobs } from '@/lib/data/thinking-jobs'
import { captureMemory, listRecentMemories } from '@/lib/data/memories'
import { listOpenGoals } from '@/lib/data/goals'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { countTodayEntriesSince } from '@/lib/kairos/today'
import { stageSurpriseDue } from '@/lib/kairos/stage'
import { REFLECT_SYSTEM_PROMPT } from '@/lib/kairos/cadence/reflect-prompt'
import { reflectHandler } from '../handlers/reflect'

const USER = 'user-1'
// 10:40Z on 1 Oct 2026 = 11:40 London (BST).
const NOW = new Date('2026-10-01T10:40:00.000Z')
const SLOT = 'reflect:2026-10-01:11'
const EVENT = { id: 'mem-ev-1', title: 'Captured session: pricing refactor', createdAt: NOW, streamClass: 'execution' }

function reflectJob(): ThinkingJobRow {
  return {
    id: 'job-r', userId: USER, kind: 'reflect', dominionId: null, externalKey: SLOT, status: 'claimed',
    input: { system: 's', prompt: 'p', validMemoryIds: ['mem-ev-1'], context: { slot: SLOT, goals: [], eventIds: ['mem-ev-1'] } },
    output: null, claimedBy: 'routine:brain', claimToken: 't', claimedAt: NOW, deadlineAt: new Date(NOW.getTime() + 50 * 60_000),
    completedAt: null, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_DAYTIME_THINKING = '1'
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(listOpenGoals).mockResolvedValue([])
  vi.mocked(countTodayEntriesSince).mockResolvedValue(0)
  vi.mocked(listRecentMemories).mockResolvedValue([EVENT] as never)
  vi.mocked(readKairosPromises).mockResolvedValue({ v: 1, nextSeq: 1, open: [], closed: [] } as never)
  vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'mem-reflection' }, created: true } as never)
  vi.mocked(stageSurpriseDue).mockResolvedValue(false)
})
afterEach(() => {
  delete process.env.KAIROS_DAYTIME_THINKING
  delete process.env.KAIROS_STAGE
})

describe('reflect plan — early reflect on stage surprise', () => {
  it('no goal, no activity, no surprise: nothing', async () => {
    vi.mocked(listRecentMemories).mockResolvedValueOnce([])
    expect(await reflectHandler.plan(USER, NOW)).toEqual([])
    expect(stageSurpriseDue).toHaveBeenCalledWith(USER, expect.any(Date), NOW)
  })

  it('no goal, no activity, but surprise due: plans with trigger "surprise"', async () => {
    // First read = the activity probe (empty); the second feeds the prompt.
    vi.mocked(listRecentMemories).mockResolvedValueOnce([])
    vi.mocked(stageSurpriseDue).mockResolvedValue(true)
    const [spec] = await reflectHandler.plan(USER, NOW)
    expect(spec).toMatchObject({ kind: 'reflect', externalKey: SLOT })
    expect(spec.input.context).toMatchObject({ trigger: 'surprise' })
  })

  it('activity wins before the stage is consulted: trigger "activity"', async () => {
    vi.mocked(countTodayEntriesSince).mockResolvedValue(2)
    const [spec] = await reflectHandler.plan(USER, NOW)
    expect(spec.input.context).toMatchObject({ trigger: 'activity' })
    expect(stageSurpriseDue).not.toHaveBeenCalled()
  })

  it('stage off: the system prompt is byte-identical', async () => {
    vi.mocked(countTodayEntriesSince).mockResolvedValue(2)
    const [spec] = await reflectHandler.plan(USER, NOW)
    expect(spec.input.system).toBe(REFLECT_SYSTEM_PROMPT)
  })

  it('stage on: the system prompt offers the optional stage field', async () => {
    process.env.KAIROS_STAGE = '1'
    vi.mocked(countTodayEntriesSince).mockResolvedValue(2)
    const [spec] = await reflectHandler.plan(USER, NOW)
    expect(spec.input.system).toContain('Optionally add "stage"')
  })
})

describe('reflect apply — thoughts for the stage', () => {
  const answer = JSON.stringify({
    thought: 'The pricing refactor keeps coming back.',
    evidenceIds: ['mem-ev-1'],
    stage: [{ text: 'Pricing refactor is looping', surprise: 0.6, importance: 0.7 }],
  })

  it('stage off: no thoughts on the outcome', async () => {
    const res = await reflectHandler.apply(reflectJob(), answer, 'routine')
    expect(res.ok && 'thoughts' in res).toBe(false)
  })

  it('stage observe: the thought (goalRelevance .3 without goal notes) plus its stage item', async () => {
    process.env.KAIROS_STAGE = 'observe'
    const res = await reflectHandler.apply(reflectJob(), answer, 'routine')
    expect(res.ok && res.thoughts).toEqual([
      { text: 'The pricing refactor keeps coming back.', importance: 0.5, surprise: 0.3, goalRelevance: 0.3, need: 0.3, cites: ['mem-ev-1'] },
      { text: 'Pricing refactor is looping', surprise: 0.6, importance: 0.7, goalRelevance: 0, need: 0 },
    ])
  })
})
