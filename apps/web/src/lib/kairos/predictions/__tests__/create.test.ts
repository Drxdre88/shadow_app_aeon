import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KairosPredictionsState } from '@/lib/data/validators/kairos-predictions'
import { BASIS, NOW, PROJECT, TASK, USER, cardCheck, prediction, state, task } from './fixtures'

const h = vi.hoisted(() => ({
  state: null as unknown as KairosPredictionsState,
  writes: 0,
  findPromiseTask: vi.fn(),
  verifyProjectAccess: vi.fn(),
}))

vi.mock('@/lib/data/kairos-predictions', async () => {
  const { kairosPredictionsStateSchema } = await import('@/lib/data/validators/kairos-predictions')
  return {
    mutateKairosPredictions: vi.fn(async (_u: string, fn: (s: KairosPredictionsState) => { state: KairosPredictionsState | null; result: unknown }) => {
      const { state: next, result } = fn(h.state)
      if (next) { h.state = kairosPredictionsStateSchema.parse(next); h.writes++ }
      return result
    }),
  }
})
vi.mock('@/lib/data/kairos-promises', () => ({ findPromiseTask: h.findPromiseTask }))
vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess: h.verifyProjectAccess }))
vi.mock('@/lib/kairos/auto-capture', () => ({ DONE_COLUMN_NAMES: new Set(['done', 'vault']) }))

import { createKairosPredictions } from '../create'

const SOURCE = { kind: 'weekly_review' as const, jobId: 'job-1', isoWeek: '2026-W40' }
const OPTS = { now: NOW, validMemoryIds: [BASIS], dominions: [{ id: 'dom-1', name: 'Aeon' }] }
const claim = (n: number) => `Release ${n} reaches all beta users before the due date`
const proposal = (n: number, over: Record<string, unknown> = {}) => ({ claim: claim(n), probability: 0.7, dueDate: '2026-10-08', topic: 'delivery', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_PREDICTIONS = '1'
  h.writes = 0
  h.state = state()
  h.findPromiseTask.mockResolvedValue(null)
  h.verifyProjectAccess.mockResolvedValue({ role: 'owner' })
})

describe('createKairosPredictions', () => {
  it('flag off: creates nothing', async () => {
    delete process.env.KAIROS_PREDICTIONS
    const res = await createKairosPredictions(USER, [proposal(1)], SOURCE, OPTS)
    expect(res).toEqual({ created: [], rejected: [{ index: 0, reason: 'disabled' }], overflow: 0 })
    expect(h.writes).toBe(0)
  })

  it('creates an open, numbered owner_verdict prediction with grounded basis and dominion', async () => {
    h.state = state([], [prediction(4, { status: 'right' })])
    const res = await createKairosPredictions(USER, [
      proposal(1, { probability: '0.72', basisIds: [BASIS.toUpperCase(), 'not-fed'], dominion: 'aeon', taskId: null, expect: null }),
    ], SOURCE, OPTS)
    expect(res.rejected).toEqual([])
    expect(res.created[0]).toMatchObject({
      seq: 5, status: 'open', probability: 0.7, check: { kind: 'owner_verdict' }, basisIds: [BASIS], dominionId: 'dom-1', source: SOURCE,
    })
    expect(h.state.nextSeq).toBe(6)
  })

  it('is strict: a caller cannot set status, seq or check', async () => {
    const res = await createKairosPredictions(USER, [proposal(1, { status: 'right' }), proposal(2, { check: { kind: 'owner_verdict' } })], SOURCE, OPTS)
    expect(res.rejected).toEqual([{ index: 0, reason: 'invalid' }, { index: 1, reason: 'invalid' }])
    expect(h.writes).toBe(0)
  })

  it.each(['The fix might land before Friday for all users', 'Beta users may adopt the new board quickly', 'The team could finish the migration on time', 'Possibly the release slips to next sprint'])(
    'rejects a hedged claim: %s', async (c) => {
      const res = await createKairosPredictions(USER, [proposal(1, { claim: c })], SOURCE, OPTS)
      expect(res.rejected).toEqual([{ index: 0, reason: 'hedged' }])
    })

  it('rejects probability outside 0.55–0.95 and snaps to 0.05 steps', async () => {
    const res = await createKairosPredictions(USER, [proposal(1, { probability: 0.5 }), proposal(2, { probability: 0.97 }), proposal(3, { probability: 0.93 })], SOURCE, OPTS)
    expect(res.rejected).toEqual([{ index: 0, reason: 'probability_out_of_range' }, { index: 1, reason: 'probability_out_of_range' }])
    expect(res.created.map((p) => p.probability)).toEqual([0.95])
  })

  it('accepts London tomorrow..+28 days only', async () => {
    const res = await createKairosPredictions(USER, [proposal(1, { dueDate: '2026-10-01' }), proposal(2, { dueDate: '2026-10-29' }), proposal(3, { dueDate: '2026-10-30' })], SOURCE, OPTS)
    expect(res.rejected).toEqual([{ index: 0, reason: 'due_out_of_window' }, { index: 2, reason: 'due_out_of_window' }])
    expect(res.created.map((p) => p.dueDate)).toEqual(['2026-10-29'])
  })

  it('takes at most 3 per weekly review and 1 per reflect', async () => {
    const weekly = await createKairosPredictions(USER, [1, 2, 3, 4].map((n) => proposal(n)), SOURCE, OPTS)
    expect(weekly.created).toHaveLength(3)
    expect(weekly.rejected).toEqual([{ index: 3, reason: 'over_per_call_cap' }])
    h.state = state()
    const reflect = await createKairosPredictions(USER, [proposal(5), proposal(6)], { kind: 'reflect', jobId: 'job-r' }, OPTS)
    expect(reflect.created).toHaveLength(1)
    expect(reflect.overflow).toBe(1)
  })

  it('card_by for a live, reachable card; a done card is rejected; an unknown card falls back', async () => {
    h.findPromiseTask.mockResolvedValueOnce(task())
    const live = await createKairosPredictions(USER, [proposal(1, { taskId: TASK, expect: 'not_done' })], SOURCE, OPTS)
    expect(live.created[0]!.check).toEqual({ kind: 'card_by', projectId: PROJECT, taskId: TASK, expect: 'not_done' })

    h.state = state()
    h.findPromiseTask.mockResolvedValueOnce(task({ columnName: 'Done' }))
    const done = await createKairosPredictions(USER, [proposal(2, { taskId: TASK })], { ...SOURCE, jobId: 'job-2' }, OPTS)
    expect(done.rejected).toEqual([{ index: 0, reason: 'card_already_done' }])

    h.findPromiseTask.mockResolvedValueOnce(task())
    h.verifyProjectAccess.mockResolvedValueOnce(null)
    const noAccess = await createKairosPredictions(USER, [proposal(3, { taskId: TASK })], { ...SOURCE, jobId: 'job-3' }, OPTS)
    expect(noAccess.created[0]!.check).toEqual({ kind: 'owner_verdict' })
  })

  it('rejects a duplicate claim or an open (taskId, expect) pair', async () => {
    h.state = state([prediction(1, { claim: claim(1), check: cardCheck('done') })])
    h.findPromiseTask.mockResolvedValue(task())
    const res = await createKairosPredictions(USER, [
      proposal(1, { claim: `  ${claim(1).toUpperCase()}.` }),
      proposal(2, { taskId: TASK, expect: 'done' }),
      proposal(3, { taskId: TASK, expect: 'not_done' }),
    ], SOURCE, OPTS)
    expect(res.rejected).toEqual([{ index: 0, reason: 'duplicate' }, { index: 1, reason: 'duplicate_task' }])
    expect(res.created).toHaveLength(1)
  })

  it('never re-creates for the same job (idempotent re-apply)', async () => {
    await createKairosPredictions(USER, [proposal(1)], SOURCE, OPTS)
    const again = await createKairosPredictions(USER, [proposal(2)], SOURCE, OPTS)
    expect(again.rejected).toEqual([{ index: 0, reason: 'duplicate_source' }])
    expect(h.state.open).toHaveLength(1)
  })

  it('caps at 5 created per London day and 20 open', async () => {
    const today = [1, 2, 3, 4].map((n) => prediction(n, { createdAt: '2026-10-01T04:00:00.000Z' }))
    h.state = state(today)
    const daily = await createKairosPredictions(USER, [proposal(11), proposal(12)], SOURCE, OPTS)
    expect(daily.created).toHaveLength(1)
    expect(daily.rejected).toEqual([{ index: 1, reason: 'over_daily_cap' }])

    h.state = state(Array.from({ length: 20 }, (_, i) => prediction(i + 1)))
    const full = await createKairosPredictions(USER, [proposal(30)], { ...SOURCE, jobId: 'job-9' }, OPTS)
    expect(full.rejected).toEqual([{ index: 0, reason: 'over_open_cap' }])
    expect(full.overflow).toBe(1)
  })
})
