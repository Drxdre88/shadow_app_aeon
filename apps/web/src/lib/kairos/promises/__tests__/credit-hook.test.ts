import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KairosPromise, KairosPromisesState } from '@/lib/data/validators/kairos-promises'

// closeKairosPromise → feedBackPromiseClose (spec_surprise lane 2).
const h = vi.hoisted(() => ({
  state: null as unknown as KairosPromisesState,
  closeGoal: vi.fn(),
  findGoal: vi.fn(),
  creditBackward: vi.fn(),
}))

vi.mock('@/lib/data/kairos-promises', () => ({
  mutateKairosPromises: vi.fn(async (_u: string, fn: (s: KairosPromisesState) => { state: KairosPromisesState | null; result: unknown }) => {
    const { state, result } = fn(h.state)
    if (state) h.state = state
    return result
  }),
}))
vi.mock('@/lib/kairos/goals/transitions', () => ({ closeGoal: h.closeGoal }))
vi.mock('@/lib/data/goals', () => ({ findGoal: h.findGoal }))
vi.mock('@/lib/kairos/surprise/credit', () => ({ PROMISE_SURPRISE: { kept: 0.2, lapsed: 0.6, dropped: 0.4 }, creditBackward: h.creditBackward }))

import { closeKairosPromise } from '../close'

const USER = 'user-1'
const NOW = new Date('2026-10-01T05:00:00.000Z')
const GOAL = '55555555-5555-4555-8555-555555555555'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function promise(over: Partial<KairosPromise> = {}): KairosPromise {
  return {
    id: uuid(1), seq: 1, outcome: 'Outcome shipped to beta', dueDate: '2026-10-10', createdAt: '2026-09-25T05:00:00.000Z',
    source: { kind: 'goal', goalId: GOAL }, check: { kind: 'owner_confirm' }, status: 'open', renegotiations: 0, dueHistory: [], ...over,
  } as KairosPromise
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state = { v: 1, nextSeq: 2, open: [promise()], closed: [] }
  h.closeGoal.mockResolvedValue({ ok: true })
  h.findGoal.mockResolvedValue({ id: GOAL, dominionId: 'd1', meta: { seeds: [{ kind: 'idea', id: uuid(7) }] } })
})
afterEach(() => { delete process.env.KAIROS_SURPRISE_CREDIT })

describe('feedBackPromiseClose', () => {
  it('flag off: no goal read, no walker', async () => {
    const res = await closeKairosPromise(USER, uuid(1), { kind: 'owner', via: 'session', verdict: 'kept' }, NOW)
    expect(res.ok).toBe(true)
    expect(h.findGoal).not.toHaveBeenCalled()
    expect(h.creditBackward).not.toHaveBeenCalled()
  })

  it('kept: basis = goal row + seeds, in the goal Dominion', async () => {
    process.env.KAIROS_SURPRISE_CREDIT = '1'
    await closeKairosPromise(USER, uuid(1), { kind: 'owner', via: 'session', verdict: 'kept' }, NOW)
    expect(h.creditBackward).toHaveBeenCalledWith(USER, {
      kind: 'promise', id: uuid(1), outcome: 'kept', s: 0.2, basisIds: [GOAL, uuid(7)], dominionId: 'd1', label: 'promise P1 kept',
    }, { now: NOW })
  })

  it('weekly-review promise: no basis (event only)', async () => {
    process.env.KAIROS_SURPRISE_CREDIT = 'observe'
    h.state = { v: 1, nextSeq: 2, open: [promise({ source: { kind: 'weekly_review', jobId: 'j' } })], closed: [] }
    await closeKairosPromise(USER, uuid(1), { kind: 'owner', via: 'telegram', verdict: 'dropped' }, NOW)
    expect(h.findGoal).not.toHaveBeenCalled()
    expect(h.creditBackward).toHaveBeenCalledWith(USER, expect.objectContaining({ outcome: 'dropped', basisIds: [], dominionId: null }), { now: NOW })
  })

  it('a refused close never feeds back', async () => {
    process.env.KAIROS_SURPRISE_CREDIT = '1'
    await closeKairosPromise(USER, uuid(9), { kind: 'owner', via: 'session', verdict: 'kept' }, NOW)
    expect(h.creditBackward).not.toHaveBeenCalled()
  })
})
