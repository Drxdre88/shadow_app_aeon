import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KairosPredictionsState } from '@/lib/data/validators/kairos-predictions'
import type { PromiseTaskRow } from '@/lib/data/kairos-promises'
import { BASIS, EVENT, OTHER_TASK, TASK, USER, cardCheck, event, prediction, state, task } from './fixtures'

const h = vi.hoisted(() => ({
  state: null as unknown as KairosPredictionsState,
  writes: 0,
  findPromiseTask: vi.fn(),
  listPromiseDoneEvents: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
  reactOutcome: vi.fn(),
  creditBackward: vi.fn(),
  // Runs inside the lock before the mutation, to simulate a concurrent write.
  beforeMutate: null as null | ((s: KairosPredictionsState) => KairosPredictionsState),
}))

vi.mock('@/lib/data/kairos-predictions', async () => {
  const { kairosPredictionsStateSchema } = await import('@/lib/data/validators/kairos-predictions')
  return {
    readKairosPredictions: vi.fn(async () => h.state),
    mutateKairosPredictions: vi.fn(async (_u: string, fn: (s: KairosPredictionsState) => { state: KairosPredictionsState | null; result: unknown }) => {
      if (h.beforeMutate) h.state = h.beforeMutate(h.state)
      const { state: next, result } = fn(h.state)
      if (next) { h.state = kairosPredictionsStateSchema.parse(next); h.writes++ }
      return result
    }),
  }
})
vi.mock('@/lib/data/kairos-promises', () => ({ findPromiseTask: h.findPromiseTask, listPromiseDoneEvents: h.listPromiseDoneEvents }))
vi.mock('@/lib/kairos/auto-capture', () => ({ DONE_COLUMN_NAMES: new Set(['done', 'vault']) }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: h.writeCronSuccessTrace }))
vi.mock('@/lib/kairos/reactions', () => ({ reactOutcome: h.reactOutcome }))
vi.mock('@/lib/kairos/surprise/credit', () => ({ creditBackward: h.creditBackward }))

import { planPredictionChecks, runPredictionSettlement } from '../check'
import { settleKairosPredictionByOwner } from '../verdict'

// Due 2026-10-05 → cut-off 2026-10-06 00:00 London = 2026-10-05T23:00Z.
const BEFORE_CUTOFF = new Date('2026-10-05T12:00:00.000Z')
const AFTER_CUTOFF = new Date('2026-10-06T00:00:00.000Z')
const tasks = (row: PromiseTaskRow | null = task()) => new Map([[TASK, row]])

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_PREDICTIONS = '1'
  h.writes = 0
  h.beforeMutate = null
  h.state = state()
  h.findPromiseTask.mockResolvedValue(task())
  h.listPromiseDoneEvents.mockResolvedValue([])
})

describe('planPredictionChecks (settlement table)', () => {
  it('expect done: a user done event before the cut-off → right, traced to the event', () => {
    const p = prediction(1, { check: cardCheck('done') })
    const plan = planPredictionChecks([p], [event('2026-10-04T10:00:00.000Z')], tasks(), BEFORE_CUTOFF)
    expect(plan.settle).toEqual([{ predictionId: p.id, status: 'right', settledBy: { kind: 'check', activityEventId: EVENT, rule: 'user_done_before_due' } }])
  })

  it('agent-only evidence never settles — needs the owner', () => {
    const p = prediction(1, { check: cardCheck('done') })
    const agent = event('2026-10-04T10:00:00.000Z', 'agent')
    expect(planPredictionChecks([p], [agent], tasks(task({ status: 'done' })), BEFORE_CUTOFF)).toEqual({ settle: [], needsVerdict: [] })
    const after = planPredictionChecks([p], [agent], tasks(task({ status: 'done' })), AFTER_CUTOFF)
    expect(after).toEqual({ settle: [], needsVerdict: [{ predictionId: p.id, agentEvidenceSeenAt: '2026-10-04T10:00:00.000Z' }] })
  })

  it.each([
    ['status done', task({ status: 'done' })],
    ['completedAt set', task({ completedAt: new Date('2026-10-03T00:00:00.000Z') })],
    ['archived', task({ archivedAt: new Date('2026-10-03T00:00:00.000Z') })],
    ['in a Vault column', task({ columnName: ' Vault ' })],
  ])('REST done with no event (%s) → needs_verdict after the cut-off', (_label, row) => {
    const p = prediction(1, { check: cardCheck('done') })
    expect(planPredictionChecks([p], [], tasks(row), AFTER_CUTOFF).needsVerdict).toEqual([{ predictionId: p.id }])
  })

  it('expect done: nothing by the cut-off → wrong (no event id)', () => {
    const p = prediction(1, { check: cardCheck('done') })
    expect(planPredictionChecks([p], [], tasks(), BEFORE_CUTOFF).settle).toEqual([])
    expect(planPredictionChecks([p], [], tasks(), AFTER_CUTOFF).settle).toEqual([
      { predictionId: p.id, status: 'wrong', settledBy: { kind: 'check', activityEventId: null, rule: 'not_done_by_due' } },
    ])
  })

  it('expect not_done: still open after the cut-off → right', () => {
    const p = prediction(1, { check: cardCheck('not_done') })
    expect(planPredictionChecks([p], [], tasks(), AFTER_CUTOFF).settle).toEqual([
      { predictionId: p.id, status: 'right', settledBy: { kind: 'check', activityEventId: null, rule: 'not_done_by_due' } },
    ])
  })

  it('expect not_done: user done before the cut-off → wrong; agent/REST done → needs_verdict', () => {
    const p = prediction(1, { check: cardCheck('not_done') })
    expect(planPredictionChecks([p], [event('2026-10-02T10:00:00.000Z')], tasks(), BEFORE_CUTOFF).settle[0]).toMatchObject({ status: 'wrong' })
    expect(planPredictionChecks([p], [], tasks(task({ status: 'done' })), AFTER_CUTOFF).needsVerdict).toEqual([{ predictionId: p.id }])
  })

  it('ignores user events after the cut-off or before the prediction was made', () => {
    const p = prediction(1, { check: cardCheck('done') })
    const late = event('2026-10-06T08:00:00.000Z')
    const early = event('2026-09-27T08:00:00.000Z')
    const plan = planPredictionChecks([p], [early, late], tasks(task({ status: 'done' })), new Date('2026-10-06T09:00:00.000Z'))
    expect(plan.settle).toEqual([])
    expect(plan.needsVerdict).toEqual([{ predictionId: p.id }])
  })

  it('ignores events for another card or project', () => {
    const p = prediction(1, { check: cardCheck('done') })
    const other = event('2026-10-04T10:00:00.000Z', 'user', { entityId: OTHER_TASK })
    expect(planPredictionChecks([p], [other], tasks(), BEFORE_CUTOFF).settle).toEqual([])
  })

  it('a deleted card → void', () => {
    const p = prediction(1, { check: cardCheck('done') })
    expect(planPredictionChecks([p], [], tasks(null), BEFORE_CUTOFF).settle).toEqual([
      { predictionId: p.id, status: 'void', settledBy: { kind: 'rule', reason: 'card_gone' } },
    ])
  })

  it('owner_verdict and needs_verdict wait 7 London days past due, then → unresolved', () => {
    const owner = prediction(1)
    const flagged = prediction(2, { check: cardCheck('done'), status: 'needs_verdict' })
    const sixDays = new Date('2026-10-11T12:00:00.000Z')
    const sevenDays = new Date('2026-10-12T12:00:00.000Z')
    expect(planPredictionChecks([owner, flagged], [], tasks(), sixDays).settle).toEqual([])
    expect(planPredictionChecks([owner, flagged], [], tasks(), sevenDays).settle.map((s) => [s.predictionId, s.status, s.settledBy])).toEqual([
      [owner.id, 'unresolved', { kind: 'rule', reason: 'no_verdict_7d' }],
      [flagged.id, 'unresolved', { kind: 'rule', reason: 'no_verdict_7d' }],
    ])
  })
})

describe('runPredictionSettlement', () => {
  it('flag off: does nothing', async () => {
    delete process.env.KAIROS_PREDICTIONS
    h.state = state([prediction(1, { check: cardCheck('done') })])
    expect(await runPredictionSettlement(USER, AFTER_CUTOFF)).toEqual({ status: 'skipped', reason: 'flag_off' })
    expect(h.writes).toBe(0)
    expect(h.findPromiseTask).not.toHaveBeenCalled()
  })

  it('settles, flags and feeds a confident result back into its basis', async () => {
    const right = prediction(1, { check: cardCheck('done'), basisIds: [BASIS], probability: 0.8 })
    const flagged = prediction(2, { check: cardCheck('done', OTHER_TASK) })
    h.state = state([right, flagged])
    h.findPromiseTask.mockImplementation(async (id: string) => (id === TASK ? task() : task({ id: OTHER_TASK, status: 'done' })))
    h.listPromiseDoneEvents.mockResolvedValue([event('2026-10-04T10:00:00.000Z')])

    const res = await runPredictionSettlement(USER, AFTER_CUTOFF)
    expect(res).toEqual({ status: 'ok', open: 2, settled: [{ id: right.id, status: 'right' }], needsVerdict: [flagged.id], feedback: 1 })
    expect(h.state.open.map((p) => [p.seq, p.status])).toEqual([[2, 'needs_verdict']])
    expect(h.state.closed[0]).toMatchObject({ seq: 1, status: 'right', settledBy: { kind: 'check', activityEventId: EVENT } })
    expect(h.reactOutcome).toHaveBeenCalledWith(USER, BASIS, 'positive', 'prediction R1 right')
    expect(h.writeCronSuccessTrace).toHaveBeenCalledTimes(1)
  })

  it('no feedback below p 0.7 or for rule settlements', async () => {
    h.state = state([
      prediction(1, { check: cardCheck('done'), basisIds: [BASIS], probability: 0.65 }),
      prediction(2, { basisIds: [BASIS], dueDate: '2026-09-20' }),
    ])
    const res = await runPredictionSettlement(USER, AFTER_CUTOFF)
    expect(res).toMatchObject({ settled: [{ status: 'wrong' }, { status: 'unresolved' }], feedback: 0 })
    expect(h.reactOutcome).not.toHaveBeenCalled()
  })

  it('a concurrent owner verdict wins over the check', async () => {
    const p = prediction(1, { check: cardCheck('done') })
    h.state = state([p])
    h.beforeMutate = (s) => ({ ...s, open: [], closed: [{ ...p, status: 'void', settledAt: 'x', settledBy: { kind: 'owner', via: 'session' } }] })
    const res = await runPredictionSettlement(USER, AFTER_CUTOFF)
    expect(res).toMatchObject({ settled: [], needsVerdict: [] })
    expect(h.state.closed[0]!.status).toBe('void')
  })

  it('writes nothing when nothing changes', async () => {
    h.state = state([prediction(1, { check: cardCheck('done') })])
    await runPredictionSettlement(USER, BEFORE_CUTOFF)
    expect(h.writes).toBe(0)
    expect(h.writeCronSuccessTrace).not.toHaveBeenCalled()
  })
})

describe('settleKairosPredictionByOwner', () => {
  it('owner verdict settles a needs_verdict prediction and feeds back', async () => {
    const p = prediction(1, { status: 'needs_verdict', basisIds: [BASIS], probability: 0.9 })
    h.state = state([p])
    const res = await settleKairosPredictionByOwner(USER, p.id, 'wrong', { via: 'telegram' }, AFTER_CUTOFF)
    expect(res).toMatchObject({ ok: true, prediction: { status: 'wrong', settledBy: { kind: 'owner', via: 'telegram' } } })
    expect(h.reactOutcome).toHaveBeenCalledWith(USER, BASIS, 'negative', 'prediction R1 wrong')
  })

  it('void never feeds back; a second verdict is refused', async () => {
    const p = prediction(1, { basisIds: [BASIS] })
    h.state = state([p])
    expect((await settleKairosPredictionByOwner(USER, p.id, 'void', { via: 'session' })).ok).toBe(true)
    expect(h.reactOutcome).not.toHaveBeenCalled()
    expect(await settleKairosPredictionByOwner(USER, p.id, 'right', { via: 'session' })).toEqual({ ok: false, reason: 'already_settled' })
  })

  it('rejects a non-owner closer shape', async () => {
    const p = prediction(1)
    h.state = state([p])
    const res = await settleKairosPredictionByOwner(USER, p.id, 'right', { via: 'agent' } as never)
    expect(res).toEqual({ ok: false, reason: 'forbidden' })
    expect(h.writes).toBe(0)
  })
})

describe('backward credit hook (spec_surprise lane 2)', () => {
  it('runs after hop 1 and excludes the ids hop 1 credited', async () => {
    const p = prediction(1, { status: 'needs_verdict', basisIds: [BASIS], probability: 0.9, dominionId: 'd1' })
    h.state = state([p])
    await settleKairosPredictionByOwner(USER, p.id, 'wrong', { via: 'session' })
    expect(h.reactOutcome.mock.invocationCallOrder[0]).toBeLessThan(h.creditBackward.mock.invocationCallOrder[0]!)
    expect(h.creditBackward).toHaveBeenCalledWith(USER, expect.objectContaining({
      kind: 'prediction', id: p.id, outcome: 'wrong', s: 0.9, basisIds: [BASIS], dominionId: 'd1', probability: 0.9, excludeIds: [BASIS],
    }))
  })

  it('below p 0.7 hop 1 credits nothing, the walker still sees the settlement', async () => {
    h.state = state([prediction(1, { check: cardCheck('done'), basisIds: [BASIS], probability: 0.65 })])
    await runPredictionSettlement(USER, AFTER_CUTOFF)
    expect(h.reactOutcome).not.toHaveBeenCalled()
    expect(h.creditBackward).toHaveBeenCalledWith(USER, expect.objectContaining({ outcome: 'wrong', excludeIds: [] }))
  })

  it('void / rule settlements never reach the walker', async () => {
    const p = prediction(1, { basisIds: [BASIS] })
    h.state = state([p])
    await settleKairosPredictionByOwner(USER, p.id, 'void', { via: 'session' })
    expect(h.creditBackward).not.toHaveBeenCalled()
  })
})
