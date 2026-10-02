import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/goals', () => ({
  withGoalLock: vi.fn(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn('TX')),
  findGoal: vi.fn(),
  countOpenGoals: vi.fn(),
  casGoalUpdate: vi.fn(),
  hasGoalProposedOn: vi.fn(),
  insertGoalProposal: vi.fn(),
  listStaleGoals: vi.fn(),
}))

import {
  casGoalUpdate,
  countOpenGoals,
  findGoal,
  hasGoalProposedOn,
  insertGoalProposal,
  listStaleGoals,
  withGoalLock,
  type GoalRecord,
} from '@/lib/data/goals'
import type { GoalMeta } from '../parse'
import { approveGoal, closeGoal, expireStaleGoals, proposeGoal, vetoGoal } from '../transitions'

const USER = 'user-1'
const ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-02T09:00:00.000Z')
const OP = { kind: 'operator', via: 'telegram' } as const
const DAY = 86_400_000

const meta = (over: Partial<GoalMeta> = {}): GoalMeta => ({
  v: 1,
  state: 'proposed',
  kind: 'investigation',
  question: 'What blocks go-live?',
  why: 'Seeded by an idea.',
  successCheck: { type: 'owner_confirm', text: 'You agree.' },
  dueInDays: 7,
  dueAt: null,
  seeds: [{ kind: 'idea', id: 'seed-1' }],
  proposedOn: '2026-10-02',
  proposedAt: '2026-10-02T03:30:00.000Z',
  expiresAt: '2026-10-05T03:30:00.000Z',
  jobId: 'job-1',
  answeredBy: 'routine',
  decidedAt: null,
  decidedVia: null,
  vetoNote: null,
  closedAt: null,
  closedBy: null,
  closeNote: null,
  telegram: null,
  history: [],
  ...over,
})

const goal = (over: Partial<GoalMeta> = {}, row: Partial<GoalRecord> = {}): GoalRecord => ({
  id: ID, title: 'Why the desk stalls', type: 'inbound', dominionId: null, archivedAt: null, createdAt: NOW, meta: meta(over), ...row,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(countOpenGoals).mockResolvedValue({ active: 0, pending: 1 })
  vi.mocked(casGoalUpdate).mockImplementation(async (_u, _id, _from, set) => goal({ ...(set.goal as Partial<GoalMeta>) }))
})

describe('approveGoal', () => {
  it('refuses agents, kairos and the system before touching the DB', async () => {
    for (const kind of ['agent', 'kairos', 'system'] as const) {
      await expect(approveGoal(USER, ID, { kind })).resolves.toEqual({ ok: false, reason: 'forbidden_actor' })
    }
    expect(withGoalLock).not.toHaveBeenCalled()
  })

  it('treats a malformed id as not_found', async () => {
    await expect(approveGoal(USER, 'nope', OP)).resolves.toEqual({ ok: false, reason: 'not_found' })
  })

  it('activates under the lock with dueAt = now + dueInDays, then runs onApproved after commit', async () => {
    vi.mocked(findGoal).mockResolvedValue(goal())
    const onApproved = vi.fn(async () => {})
    const res = await approveGoal(USER, ID, OP, { now: NOW, onApproved })
    expect(res.ok).toBe(true)
    expect(withGoalLock).toHaveBeenCalledWith(USER, expect.any(Function))
    expect(findGoal).toHaveBeenCalledWith(USER, ID, 'TX')
    const [, , from, set, , q] = vi.mocked(casGoalUpdate).mock.calls[0]
    expect(from).toBe('proposed')
    expect(q).toBe('TX')
    expect(set).toMatchObject({
      status: 'accepted',
      type: 'kairos_goal',
      goal: { state: 'active', dueAt: new Date(NOW.getTime() + 7 * DAY).toISOString(), decidedAt: NOW.toISOString(), decidedVia: 'operator:telegram' },
    })
    expect(set.goal.history?.at(-1)).toEqual({ at: NOW.toISOString(), event: 'approve', from: 'proposed', to: 'active', actor: 'operator', via: 'telegram' })
    expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({ id: ID }))
  })

  it('a repeat tap on an active goal does nothing', async () => {
    vi.mocked(findGoal).mockResolvedValue(goal({ state: 'active' }))
    const onApproved = vi.fn(async () => {})
    await expect(approveGoal(USER, ID, OP, { now: NOW, onApproved })).resolves.toEqual({ ok: false, reason: 'already_resolved' })
    expect(casGoalUpdate).not.toHaveBeenCalled()
    expect(onApproved).not.toHaveBeenCalled()
  })

  it('refuses a proposal past its 72h expiry, even before the sweep', async () => {
    vi.mocked(findGoal).mockResolvedValue(goal({ expiresAt: '2026-10-02T08:59:59.000Z' }))
    await expect(approveGoal(USER, ID, OP, { now: NOW })).resolves.toEqual({ ok: false, reason: 'expired' })
    vi.mocked(findGoal).mockResolvedValue(goal({ state: 'expired' }))
    await expect(approveGoal(USER, ID, OP, { now: NOW })).resolves.toEqual({ ok: false, reason: 'expired' })
  })

  it('re-checks the open-goal cap under the lock', async () => {
    vi.mocked(findGoal).mockResolvedValue(goal())
    vi.mocked(countOpenGoals).mockResolvedValue({ active: 2, pending: 1 })
    await expect(approveGoal(USER, ID, OP, { now: NOW })).resolves.toEqual({ ok: false, reason: 'cap_reached' })
    expect(countOpenGoals).toHaveBeenCalledWith(USER, NOW, 'TX')
    expect(casGoalUpdate).not.toHaveBeenCalled()
  })

  it('reports a lost compare-and-set as already_resolved', async () => {
    vi.mocked(findGoal).mockResolvedValue(goal())
    vi.mocked(casGoalUpdate).mockResolvedValue(null)
    await expect(approveGoal(USER, ID, OP, { now: NOW })).resolves.toEqual({ ok: false, reason: 'already_resolved' })
  })

  it('keeps the approval when onApproved throws, and says so', async () => {
    vi.mocked(findGoal).mockResolvedValue(goal())
    const res = await approveGoal(USER, ID, OP, { now: NOW, onApproved: async () => { throw new Error('promise cap') } })
    expect(res).toMatchObject({ ok: true, onApprovedError: 'promise cap' })
  })
})

describe('vetoGoal', () => {
  it('vetoes and archives with the trimmed note', async () => {
    vi.mocked(findGoal).mockResolvedValue(goal())
    const res = await vetoGoal(USER, ID, OP, { now: NOW, note: '  not now  ' })
    expect(res.ok).toBe(true)
    const [, , from, set] = vi.mocked(casGoalUpdate).mock.calls[0]
    expect(from).toBe('proposed')
    expect(set).toMatchObject({ status: 'dismissed', archive: true, goal: { state: 'vetoed', vetoNote: 'not now', decidedVia: 'operator:telegram' } })
  })

  it('refuses agents and settled goals', async () => {
    await expect(vetoGoal(USER, ID, { kind: 'agent', via: 'mcp' })).resolves.toEqual({ ok: false, reason: 'forbidden_actor' })
    vi.mocked(findGoal).mockResolvedValue(goal({ state: 'vetoed' }))
    await expect(vetoGoal(USER, ID, OP, { now: NOW })).resolves.toEqual({ ok: false, reason: 'already_resolved' })
  })

  it('re-reads after a lost race to say what the goal became', async () => {
    vi.mocked(findGoal).mockResolvedValueOnce(goal()).mockResolvedValueOnce(goal({ state: 'expired' }))
    vi.mocked(casGoalUpdate).mockResolvedValue(null)
    await expect(vetoGoal(USER, ID, OP, { now: NOW })).resolves.toEqual({ ok: false, reason: 'expired' })
  })
})

describe('closeGoal', () => {
  it.each([['done', 'done'], ['fail', 'failed'], ['abandon', 'abandoned']] as const)('%s closes an active goal as %s', async (outcome, to) => {
    vi.mocked(findGoal).mockResolvedValue(goal({ state: 'active' }))
    const res = await closeGoal(USER, ID, outcome, { kind: 'operator', via: 'session' }, { now: NOW, note: 'checked' })
    expect(res.ok).toBe(true)
    const [, , from, set] = vi.mocked(casGoalUpdate).mock.calls[0]
    expect(from).toBe('active')
    expect(set.goal).toMatchObject({ state: to, closedAt: NOW.toISOString(), closedBy: 'operator:session', closeNote: 'checked' })
  })

  it('refuses closing a proposal and any non-operator', async () => {
    vi.mocked(findGoal).mockResolvedValue(goal())
    await expect(closeGoal(USER, ID, 'done', OP)).resolves.toEqual({ ok: false, reason: 'not_active' })
    await expect(closeGoal(USER, ID, 'done', { kind: 'kairos' })).resolves.toEqual({ ok: false, reason: 'forbidden_actor' })
  })
})

describe('expireStaleGoals', () => {
  it('expires unanswered proposals and fails overdue goals, as the system', async () => {
    vi.mocked(listStaleGoals).mockResolvedValue([goal(), goal({ state: 'active', dueAt: '2026-09-20T00:00:00.000Z' }, { id: 'g-2' })])
    const res = await expireStaleGoals(USER, NOW)
    expect(res).toEqual({ expired: [ID], timedOut: ['g-2'] })
    const [first, second] = vi.mocked(casGoalUpdate).mock.calls
    expect(first[2]).toBe('proposed')
    expect(first[3]).toMatchObject({ status: 'expired', archive: true, goal: { state: 'expired' } })
    expect(first[3].goal.history?.at(-1)).toMatchObject({ event: 'expire', actor: 'system' })
    expect(second[2]).toBe('active')
    expect(second[3]).toMatchObject({ goal: { state: 'failed', closedBy: 'system:goal-expiry' } })
  })

  it('skips rows another sweep already moved', async () => {
    vi.mocked(listStaleGoals).mockResolvedValue([goal()])
    vi.mocked(casGoalUpdate).mockResolvedValue(null)
    await expect(expireStaleGoals(USER, NOW)).resolves.toEqual({ expired: [], timedOut: [] })
  })
})

describe('proposeGoal', () => {
  const input = {
    candidate: { title: ' Why the desk stalls ', question: 'What blocks go-live?', why: 'Seeded.', seedIds: ['seed-1'], successCheck: 'You agree.', dueInDays: 5, dominionId: null },
    seeds: [{ kind: 'idea' as const, id: 'seed-1' }],
    jobId: 'job-1',
    answeredBy: 'routine',
    embedding: null,
    proposedOn: '2026-10-02',
    now: NOW,
  }
  const KAIROS = { kind: 'kairos', via: 'thinking:goal_propose' } as const

  it('only kairos proposes', async () => {
    await expect(proposeGoal(USER, OP, input)).resolves.toEqual({ ok: false, reason: 'forbidden_actor' })
  })

  it('one a night and at most two open, both re-checked under the lock', async () => {
    vi.mocked(hasGoalProposedOn).mockResolvedValue(true)
    await expect(proposeGoal(USER, KAIROS, input)).resolves.toEqual({ ok: false, reason: 'daily_limit' })
    expect(hasGoalProposedOn).toHaveBeenCalledWith(USER, '2026-10-02', 'TX')
    vi.mocked(hasGoalProposedOn).mockResolvedValue(false)
    vi.mocked(countOpenGoals).mockResolvedValue({ active: 1, pending: 1 })
    await expect(proposeGoal(USER, KAIROS, input)).resolves.toEqual({ ok: false, reason: 'cap_reached' })
    expect(insertGoalProposal).not.toHaveBeenCalled()
  })

  it('writes a proposal expiring in 72h with a propose history entry', async () => {
    vi.mocked(hasGoalProposedOn).mockResolvedValue(false)
    vi.mocked(countOpenGoals).mockResolvedValue({ active: 1, pending: 0 })
    vi.mocked(insertGoalProposal).mockResolvedValue('g-new')
    const res = await proposeGoal(USER, KAIROS, input)
    expect(res).toMatchObject({ ok: true, goal: { id: 'g-new', title: 'Why the desk stalls' } })
    const [, values, q] = vi.mocked(insertGoalProposal).mock.calls[0]
    expect(q).toBe('TX')
    expect(values.meta).toMatchObject({
      state: 'proposed',
      kind: 'investigation',
      dueInDays: 5,
      dueAt: null,
      expiresAt: new Date(NOW.getTime() + 72 * 3_600_000).toISOString(),
      successCheck: { type: 'owner_confirm', text: 'You agree.' },
      history: [{ event: 'propose', from: null, to: 'proposed', actor: 'kairos', via: 'thinking:goal_propose' }],
    })
    expect(values.citations).toEqual(['seed-1'])
    expect(values.bodyMd).toContain('What blocks go-live?')
  })
})
