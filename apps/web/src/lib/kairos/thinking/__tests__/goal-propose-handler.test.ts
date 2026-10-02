import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({
  countOpenGoals: vi.fn(),
  listFailedGoals: vi.fn(),
  listGoalSimilarities: vi.fn(),
  listOpenGoals: vi.fn(),
}))
vi.mock('@/lib/data/ideas', () => ({ listIdeaOutcomes: vi.fn() }))
vi.mock('@/lib/data/idea-inputs', () => ({ listActiveDominions: vi.fn(), listOpenObjectives: vi.fn() }))
vi.mock('@/lib/kairos/embeddings', () => ({ embedOne: vi.fn() }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: vi.fn() }))
vi.mock('@/lib/kairos/goals/transitions', () => ({ expireStaleGoals: vi.fn(), proposeGoal: vi.fn() }))
vi.mock('@/lib/kairos/proposal-telegram', () => ({ announceGoalProposal: vi.fn(async () => true) }))

import { countOpenGoals, listFailedGoals, listGoalSimilarities, listOpenGoals } from '@/lib/data/goals'
import { announceGoalProposal } from '@/lib/kairos/proposal-telegram'
import { listIdeaOutcomes } from '@/lib/data/ideas'
import { listActiveDominions, listOpenObjectives } from '@/lib/data/idea-inputs'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { embedOne } from '@/lib/kairos/embeddings'
import { expireStaleGoals, proposeGoal } from '@/lib/kairos/goals/transitions'
import { goalProposeHandler } from '../handlers/goal-propose'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM = '22222222-2222-4222-8222-222222222222'
const IDEA = '33333333-3333-4333-8333-333333333333'
const FAILED = '44444444-4444-4444-8444-444444444444'
const DAY = '2026-10-02'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)

const candidate = {
  title: 'Why the DE PPA desk stalls',
  question: 'What is blocking the DE PPA go-live each week?',
  why: 'The accepted idea suggests the blocker is upstream of the desk.',
  seedIds: [IDEA],
  successCheck: 'You agree the blocker list is right.',
  dueInDays: 7,
  dominionId: DOM,
}
const answer = (goal: unknown) => JSON.stringify({ goal })

function jobRow(context: Record<string, unknown> = {}): ThinkingJobRow {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    userId: USER,
    kind: 'goal_propose',
    dominionId: null,
    externalKey: `goal_propose:${DAY}`,
    status: 'claimed',
    input: {
      system: 's',
      prompt: 'p',
      validMemoryIds: [IDEA, FAILED],
      context: {
        date: DAY,
        seeds: [{ id: IDEA, kind: 'idea' }, { id: FAILED, kind: 'failed_goal' }],
        validDominionIds: [DOM],
        objectiveTitles: ['Close Q4 hedging plan'],
        ...context,
      },
    },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('03:40'),
    deadlineAt: at('04:28'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('03:20'),
    updatedAt: at('03:20'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KAIROS_INITIATIVE', '1')
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(countOpenGoals).mockResolvedValue({ active: 0, pending: 0 })
  vi.mocked(listIdeaOutcomes).mockResolvedValue([
    { id: IDEA, title: 'Cut the DE scope', direction: 'd', claim: 'Upstream blocks it', outcome: 'accepted' },
    { id: 'dismissed-idea', title: 'No', direction: 'd', claim: 'x', outcome: 'dismissed' },
  ])
  vi.mocked(listFailedGoals).mockResolvedValue([{ id: FAILED, title: 'Old goal', question: 'Did X happen?' }])
  vi.mocked(listActiveDominions).mockResolvedValue([{ id: DOM, name: 'Trading' }])
  vi.mocked(listOpenObjectives).mockResolvedValue([{ dominionId: DOM, title: 'Close Q4 hedging plan', status: 'active', targetDate: null }])
  vi.mocked(listOpenGoals).mockResolvedValue([])
  vi.mocked(expireStaleGoals).mockResolvedValue({ expired: [], timedOut: [] })
  vi.mocked(embedOne).mockResolvedValue([0.1, 0.2])
  vi.mocked(listGoalSimilarities).mockResolvedValue([{ id: 'g-old', state: 'vetoed', similarity: 0.5 }])
  vi.useFakeTimers()
  vi.setSystemTime(at('03:45'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('goal_propose plan', () => {
  it('plans nothing — and reads nothing — while the initiative switch is off', async () => {
    vi.stubEnv('KAIROS_INITIATIVE', '')
    expect(await goalProposeHandler.plan(USER, at('03:45'))).toEqual([])
    expect(expireStaleGoals).not.toHaveBeenCalled()
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
  })

  it('plans nothing outside the 03:15–04:28 UTC window', async () => {
    expect(await goalProposeHandler.plan(USER, at('03:14'))).toEqual([])
    expect(await goalProposeHandler.plan(USER, at('04:28'))).toEqual([])
  })

  it('expires stale goals first, then plans one job with seeds and the do-not-duplicate context', async () => {
    const [spec, ...rest] = await goalProposeHandler.plan(USER, at('03:45'))
    expect(rest).toEqual([])
    expect(expireStaleGoals).toHaveBeenCalledWith(USER, at('03:45'))
    expect(spec).toMatchObject({ kind: 'goal_propose', dominionId: null, externalKey: `goal_propose:${DAY}` })
    expect(spec.deadlineMinutes).toBeCloseTo(43)
    expect(spec.input.validMemoryIds).toEqual([IDEA, FAILED])
    expect(spec.input.prompt).toContain(`[${IDEA}] (accepted idea)`)
    expect(spec.input.prompt).toContain(`[${FAILED}] (failed goal)`)
    expect(spec.input.prompt).not.toContain('dismissed-idea')
    expect(spec.input.prompt).toContain('Close Q4 hedging plan')
    expect(spec.input.context).toEqual({
      date: DAY,
      seeds: [{ id: IDEA, kind: 'idea' }, { id: FAILED, kind: 'failed_goal' }],
      validDominionIds: [DOM],
      objectiveTitles: ['Close Q4 hedging plan'],
    })
  })

  it('plans nothing when tonight already has a job, two goals are open, or there are no seeds', async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValueOnce(true)
    expect(await goalProposeHandler.plan(USER, at('03:45'))).toEqual([])
    vi.mocked(countOpenGoals).mockResolvedValueOnce({ active: 1, pending: 1 })
    expect(await goalProposeHandler.plan(USER, at('03:45'))).toEqual([])
    vi.mocked(listIdeaOutcomes).mockResolvedValueOnce([])
    vi.mocked(listFailedGoals).mockResolvedValueOnce([])
    expect(await goalProposeHandler.plan(USER, at('03:45'))).toEqual([])
  })
})

describe('goal_propose apply', () => {
  it('writes one proposal through proposeGoal as kairos', async () => {
    vi.mocked(proposeGoal).mockResolvedValue({ ok: true, goal: { id: 'g-new' } as never })
    const res = await goalProposeHandler.apply(jobRow(), answer(candidate), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: ['g-new'], output: { goalId: 'g-new', answeredBy: 'routine' } })
    expect(proposeGoal).toHaveBeenCalledWith(USER, { kind: 'kairos', via: 'thinking:goal_propose' }, expect.objectContaining({
      candidate,
      seeds: [{ id: IDEA, kind: 'idea' }],
      jobId: '66666666-6666-4666-8666-666666666666',
      answeredBy: 'routine',
      embedding: [0.1, 0.2],
      proposedOn: DAY,
    }))
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'goal-propose', outcome: 'ok' }))
    // Ask first: the new proposal goes straight to Telegram with its buttons.
    expect(announceGoalProposal).toHaveBeenCalledWith(USER, { id: 'g-new' }, expect.any(Date))
  })

  it('a Telegram send failure never fails the written proposal', async () => {
    vi.mocked(proposeGoal).mockResolvedValue({ ok: true, goal: { id: 'g-new' } as never })
    vi.mocked(announceGoalProposal).mockRejectedValueOnce(new Error('telegram down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await goalProposeHandler.apply(jobRow(), answer(candidate), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['g-new'] })
    errorSpy.mockRestore()
  })

  it('"none" is a fine answer: skipped, traced, nothing written', async () => {
    const res = await goalProposeHandler.apply(jobRow(), answer(null), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: [], output: { skipped: 'no_goal', answeredBy: 'routine' } })
    expect(proposeGoal).not.toHaveBeenCalled()
    expect(announceGoalProposal).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'goal-propose', outcome: 'skipped', skipReason: 'no_goal' }))
  })

  it.each([
    ['forbidden_topic', { ...candidate, why: 'It would protect my memory continuity.' }],
    ['unknown_seed', { ...candidate, seedIds: ['invented'] }],
    ['due_out_of_range', { ...candidate, dueInDays: 30 }],
    ['not_an_investigation', { ...candidate, title: 'Deploy the hedge tool' }],
  ])('a policy rejection (%s) is skipped and traced, never written', async (reason, goal) => {
    const res = await goalProposeHandler.apply(jobRow(), answer(goal), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: [], output: { skipped: reason } })
    expect(proposeGoal).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ outcome: 'skipped', skipReason: reason }))
  })

  it('fails closed on novelty when the goal cannot be embedded, and on a near-duplicate', async () => {
    vi.mocked(embedOne).mockRejectedValueOnce(new Error('provider down'))
    expect(await goalProposeHandler.apply(jobRow(), answer(candidate), 'routine')).toMatchObject({ output: { skipped: 'novelty_unchecked' } })
    vi.mocked(listGoalSimilarities).mockResolvedValueOnce([{ id: 'g-old', state: 'active', similarity: 0.91 }])
    expect(await goalProposeHandler.apply(jobRow(), answer(candidate), 'routine')).toMatchObject({ output: { skipped: 'duplicate_goal' } })
    expect(proposeGoal).not.toHaveBeenCalled()
  })

  it('a lost cap/day re-check under the lock is a skip', async () => {
    vi.mocked(proposeGoal).mockResolvedValue({ ok: false, reason: 'cap_reached' })
    expect(await goalProposeHandler.apply(jobRow(), answer(candidate), 'routine')).toMatchObject({ ok: true, memoryIds: [], output: { skipped: 'cap_reached' } })
  })

  it('rejects malformed output, stale jobs and bad context', async () => {
    expect(await goalProposeHandler.apply(jobRow(), answer({ ...candidate, extra: 1 }), 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed/) })
    vi.setSystemTime(new Date('2026-10-03T00:10:00.000Z'))
    expect(await goalProposeHandler.apply(jobRow(), answer(candidate), 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^stale_job/) })
    vi.setSystemTime(at('03:45'))
    expect(await goalProposeHandler.apply(jobRow({ seeds: 'nope' }), answer(candidate), 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^bad_job/) })
  })

  it('writes nothing if the switch was turned off after planning', async () => {
    vi.stubEnv('KAIROS_INITIATIVE', '0')
    expect(await goalProposeHandler.apply(jobRow(), answer(candidate), 'routine')).toMatchObject({ ok: true, memoryIds: [], output: { skipped: 'initiative_off' } })
    expect(proposeGoal).not.toHaveBeenCalled()
  })

  it('has no fallback', async () => {
    expect(await goalProposeHandler.fallback(jobRow())).toEqual({ ok: false, reason: 'no fallback — none is fine' })
  })
})
