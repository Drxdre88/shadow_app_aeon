import { beforeEach, describe, expect, it, vi } from 'vitest'

// Goal approval books Horae check-ins in its own try: a booking failure is
// logged and never turns the approval into an error (nor into
// onApprovedError, which is the promise's channel).

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/proposal-decision', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/proposal-decision')>()
  return {
    readDecision: actual.readDecision,
    readTelegramRef: actual.readTelegramRef,
    findProposalForDecision: vi.fn(),
    recordProposalDecision: vi.fn(async () => true),
    listExpiredTelegramProposals: vi.fn(async () => []),
    markTelegramClosed: vi.fn(async () => undefined),
  }
})
vi.mock('@/lib/data/goals', () => ({ casGoalUpdate: vi.fn() }))
vi.mock('@/lib/kairos/goals/transitions', () => ({ approveGoal: vi.fn(), vetoGoal: vi.fn(), expireStaleGoals: vi.fn() }))
vi.mock('@/lib/kairos/promises/create', () => ({ createKairosPromises: vi.fn(async () => ({ created: [{}], rejected: [], overflow: 0 })) }))
vi.mock('@/lib/kairos/reactions', () => ({ reactOutcome: vi.fn(async () => undefined) }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronFailureTrace: vi.fn(async () => undefined) }))
vi.mock('@/lib/kairos/agenda/goal-checkins', () => ({ bookGoalCheckins: vi.fn() }))

import { findProposalForDecision, recordProposalDecision } from '@/lib/data/proposal-decision'
import { approveGoal } from '@/lib/kairos/goals/transitions'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { bookGoalCheckins } from '@/lib/kairos/agenda/goal-checkins'
import { decideKairosProposal } from '@/lib/kairos/proposal-decision'

const USER = 'user-1'
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-10-02T09:00:00.000Z')
const goal = { id: GOAL_ID, title: 'Why do Monday boards drift?', type: 'kairos_goal', dominionId: null, archivedAt: null, createdAt: NOW, meta: { question: 'What makes Monday boards drift?', dueAt: '2026-10-09T09:00:00.000Z' } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findProposalForDecision).mockResolvedValue({
    id: GOAL_ID, title: goal.title, type: 'inbound', archivedAt: null,
    sourceMetadata: { kind: 'goal', status: 'pending', expiresAt: '2026-10-04T09:00:00.000Z', goal: { state: 'proposed' } },
  } as never)
  vi.mocked(approveGoal).mockImplementation(async (_u, _g, _a, opts) => {
    await opts?.onApproved?.(goal as never)
    return { ok: true, goal: goal as never }
  })
})

describe('goal approval → Horae check-ins', () => {
  it('books check-ins for the approved goal', async () => {
    vi.mocked(bookGoalCheckins).mockResolvedValue({ created: [{} as never, {} as never], rejected: [] })
    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW })
    expect(res).toMatchObject({ ok: true, verdict: 'approve' })
    expect(bookGoalCheckins).toHaveBeenCalledWith(USER, goal, NOW)
  })

  it('approval still succeeds (and records) when booking throws', async () => {
    vi.mocked(bookGoalCheckins).mockRejectedValue(new Error('lock timeout'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW })
    expect(res).toMatchObject({ ok: true, verdict: 'approve' })
    expect(recordProposalDecision).toHaveBeenCalledTimes(1)
    // Not routed through the promise-failure trace.
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
