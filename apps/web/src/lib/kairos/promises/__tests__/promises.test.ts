import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KairosPromise, KairosPromisesState } from '@/lib/data/validators/kairos-promises'

// In-memory stand-in for the data layer: mutateKairosPromises runs the pure
// mutation against `h.state` and validates what it would write.
const h = vi.hoisted(() => ({
  state: null as unknown as KairosPromisesState,
  writes: 0,
  findPromiseTask: vi.fn(),
  listPromiseDoneEvents: vi.fn(),
  verifyProjectAccess: vi.fn(),
  deliverKairosSpeak: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
  writeCronFailureTrace: vi.fn(),
}))

vi.mock('@/lib/data/kairos-promises', async () => {
  const { kairosPromisesStateSchema } = await import('@/lib/data/validators/kairos-promises')
  return {
    readKairosPromises: vi.fn(async () => h.state),
    mutateKairosPromises: vi.fn(async (_u: string, fn: (s: KairosPromisesState) => { state: KairosPromisesState | null; result: unknown }) => {
      const { state, result } = fn(h.state)
      if (state) { h.state = kairosPromisesStateSchema.parse(state); h.writes++ }
      return result
    }),
    findPromiseTask: h.findPromiseTask,
    listPromiseDoneEvents: h.listPromiseDoneEvents,
  }
})
vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess: h.verifyProjectAccess }))
vi.mock('@/lib/kairos/auto-capture', () => ({ DONE_COLUMN_NAMES: new Set(['done', 'vault']) }))
vi.mock('@/lib/kairos/speak', () => ({ deliverKairosSpeak: h.deliverKairosSpeak }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: h.writeCronSuccessTrace, writeCronFailureTrace: h.writeCronFailureTrace }))

import { createKairosPromises } from '../create'
import { closeKairosPromise, renegotiateKairosPromise, type PromiseCloser } from '../close'
import { verifyOpenPromises } from '../check'
import { buildPromiseNudgeMessage, runPromiseNudges } from '../nudge'
import { buildPromiseLine, PROMISE_LINE_MAX_CHARS } from '@/lib/kairos/daily-message-prompt'

const USER = 'user-1'
const NOW = new Date('2026-10-01T05:00:00.000Z') // 06:00 London, 2026-10-01
const NOON = new Date('2026-10-01T11:00:00.000Z') // 12:00 London
const PROJECT = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'
const EVENT = '33333333-3333-4333-8333-333333333333'
const SOURCE = { kind: 'weekly_review' as const, jobId: 'job-1', isoWeek: '2026-W40' }

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function promise(seq: number, over: Partial<KairosPromise> = {}): KairosPromise {
  return {
    id: uuid(seq),
    seq,
    outcome: `Outcome ${seq} shipped to beta`,
    dueDate: '2026-10-10',
    createdAt: '2026-09-25T05:00:00.000Z',
    source: { kind: 'weekly_review', jobId: 'old-job' },
    check: { kind: 'owner_confirm' },
    status: 'open',
    renegotiations: 0,
    dueHistory: [],
    ...over,
  }
}

function seed(open: KairosPromise[] = [], closed: KairosPromise[] = []) {
  h.state = { v: 1, nextSeq: Math.max(0, ...open.map((p) => p.seq), ...closed.map((p) => p.seq)) + 1, open, closed }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KAIROS_INITIATIVE
  h.writes = 0
  seed()
  h.findPromiseTask.mockResolvedValue(null)
  h.verifyProjectAccess.mockResolvedValue({ role: 'owner' })
  h.listPromiseDoneEvents.mockResolvedValue([])
  h.deliverKairosSpeak.mockResolvedValue({ status: 200, body: { id: 'speak-1', delivered: { inbox: true, telegram: true } } })
})

describe('createKairosPromises', () => {
  it('creates an open, numbered owner_confirm promise from a valid proposal', async () => {
    seed([], [promise(4, { status: 'kept' })])
    const res = await createKairosPromises(USER, [{ outcome: 'Login fix shipped to beta users', dueDate: '2026-10-08' }], SOURCE, NOW)
    expect(res.rejected).toEqual([])
    expect(res.created).toHaveLength(1)
    expect(res.created[0]).toMatchObject({ seq: 5, status: 'open', check: { kind: 'owner_confirm' }, source: SOURCE, renegotiations: 0 })
    expect(h.state.open).toHaveLength(1)
    expect(h.state.nextSeq).toBe(6)
  })

  it('is strict: a caller cannot set status, seq or check', async () => {
    const res = await createKairosPromises(USER, [
      { outcome: 'Login fix shipped to beta users', dueDate: '2026-10-08', status: 'kept' },
      { outcome: 'Login fix shipped to beta users', dueDate: '2026-10-08', check: { kind: 'card_done' } },
    ], SOURCE, NOW)
    expect(res.created).toEqual([])
    expect(res.rejected).toEqual([{ index: 0, reason: 'invalid' }, { index: 1, reason: 'invalid' }])
    expect(h.writes).toBe(0)
  })

  it.each(['Look into the flaky sync tests', 'Explore a new pricing page', 'Think about the onboarding copy'])('rejects a vague outcome: %s', async (outcome) => {
    const res = await createKairosPromises(USER, [{ outcome, dueDate: '2026-10-08' }], SOURCE, NOW)
    expect(res.rejected).toEqual([{ index: 0, reason: 'vague_outcome' }])
  })

  it('accepts London tomorrow..+28 days only', async () => {
    const at = (dueDate: string) => ({ outcome: `Shipped release for ${dueDate}`, dueDate })
    const res = await createKairosPromises(USER, [at('2026-10-01'), at('2026-10-02'), at('2026-10-29')], SOURCE, NOW)
    expect(res.rejected).toEqual([{ index: 0, reason: 'due_out_of_window' }])
    expect(res.created.map((p) => p.dueDate)).toEqual(['2026-10-02', '2026-10-29'])
    const late = await createKairosPromises(USER, [at('2026-10-30')], { kind: 'goal', goalId: 'g-1' }, NOW)
    expect(late.rejected).toEqual([{ index: 0, reason: 'due_out_of_window' }])
  })

  it('takes at most 3 per call and counts the overflow', async () => {
    const proposals = [1, 2, 3, 4].map((i) => ({ outcome: `Release ${i} shipped to beta`, dueDate: '2026-10-08' }))
    const res = await createKairosPromises(USER, proposals, SOURCE, NOW)
    expect(res.created).toHaveLength(3)
    expect(res.overflow).toBe(1)
    expect(res.rejected).toEqual([{ index: 3, reason: 'over_per_call_cap' }])
  })

  it('caps open promises at 12', async () => {
    seed(Array.from({ length: 11 }, (_, i) => promise(i + 1)))
    const res = await createKairosPromises(USER, [
      { outcome: 'First new outcome shipped', dueDate: '2026-10-08' },
      { outcome: 'Second new outcome shipped', dueDate: '2026-10-08' },
    ], SOURCE, NOW)
    expect(res.created).toHaveLength(1)
    expect(res.overflow).toBe(1)
    expect(res.rejected).toEqual([{ index: 1, reason: 'over_open_cap' }])
    expect(h.state.open).toHaveLength(12)
  })

  it('is idempotent per source job and skips an outcome already open', async () => {
    const p = { outcome: 'Login fix shipped to beta users', dueDate: '2026-10-08' }
    await createKairosPromises(USER, [p], SOURCE, NOW)
    const again = await createKairosPromises(USER, [p], SOURCE, NOW)
    expect(again.created).toEqual([])
    expect(again.rejected).toEqual([{ index: 0, reason: 'duplicate_source' }])
    const other = await createKairosPromises(USER, [{ ...p, outcome: '  login FIX shipped to beta users ' }], { kind: 'goal', goalId: 'g-9' }, NOW)
    expect(other.rejected).toEqual([{ index: 0, reason: 'duplicate' }])
    expect(h.state.open).toHaveLength(1)
  })

  describe('taskId → card_done only for a live card the owner can reach', () => {
    const p = { outcome: 'Login fix card finished', dueDate: '2026-10-08', taskId: TASK }
    const live = { id: TASK, projectId: PROJECT, status: 'todo', completedAt: null, archivedAt: null, columnName: 'Live' }

    it('live + accessible → card_done', async () => {
      h.findPromiseTask.mockResolvedValue(live)
      const res = await createKairosPromises(USER, [p], SOURCE, NOW)
      expect(res.created[0].check).toEqual({ kind: 'card_done', projectId: PROJECT, taskId: TASK })
      expect(h.verifyProjectAccess).toHaveBeenCalledWith(PROJECT, USER)
    })

    it.each([
      ['missing', null, true],
      ['already done', { ...live, status: 'done' }, true],
      ['archived', { ...live, archivedAt: new Date() }, true],
      ['in the Done column', { ...live, columnName: ' Done ' }, true],
      ['not accessible', live, false],
    ])('%s → owner_confirm', async (_label, task, access) => {
      h.findPromiseTask.mockResolvedValue(task)
      h.verifyProjectAccess.mockResolvedValue(access ? { role: 'owner' } : null)
      const res = await createKairosPromises(USER, [p], SOURCE, NOW)
      expect(res.created[0].check).toEqual({ kind: 'owner_confirm' })
    })
  })
})

describe('closeKairosPromise', () => {
  it('owner keeps or drops; a second close is already_closed; unknown is not_found', async () => {
    seed([promise(1), promise(2)])
    const kept = await closeKairosPromise(USER, uuid(1), { kind: 'owner', via: 'session', verdict: 'kept' }, NOW)
    expect(kept).toMatchObject({ ok: true, promise: { status: 'kept', closedBy: { kind: 'owner', via: 'session' }, closedAt: NOW.toISOString() } })
    const dropped = await closeKairosPromise(USER, uuid(2), { kind: 'owner', via: 'telegram', verdict: 'dropped' }, NOW)
    expect(dropped).toMatchObject({ ok: true, promise: { status: 'dropped', closedBy: { kind: 'owner', via: 'telegram' } } })
    expect(await closeKairosPromise(USER, uuid(1), { kind: 'owner', via: 'session', verdict: 'kept' }, NOW)).toEqual({ ok: false, reason: 'already_closed' })
    expect(await closeKairosPromise(USER, uuid(9), { kind: 'owner', via: 'session', verdict: 'kept' }, NOW)).toEqual({ ok: false, reason: 'not_found' })
    expect(h.state.open).toEqual([])
    expect(h.state.closed.map((p) => p.seq)).toEqual([2, 1])
  })

  it.each([
    { kind: 'agent', via: 'mcp' },
    { kind: 'owner', via: 'mcp', verdict: 'kept' },
    { kind: 'owner', via: 'session', verdict: 'lapsed' },
    { kind: 'kairos' },
  ])('refuses any other closer: %o', async (closer) => {
    seed([promise(1)])
    expect(await closeKairosPromise(USER, uuid(1), closer as unknown as PromiseCloser, NOW)).toEqual({ ok: false, reason: 'forbidden_closer' })
    expect(h.writes).toBe(0)
  })

  it('a check closer only closes card_done promises; the lapse rule only after 14 days', async () => {
    seed([promise(1, { dueDate: '2026-09-20' })])
    const check: PromiseCloser = { kind: 'check', activityEventId: EVENT, actorId: USER, at: NOW.toISOString() }
    expect(await closeKairosPromise(USER, uuid(1), check, NOW)).toEqual({ ok: false, reason: 'not_eligible' })
    expect(await closeKairosPromise(USER, uuid(1), { kind: 'rule', reason: 'lapsed_14d' }, NOW)).toEqual({ ok: false, reason: 'not_eligible' })
    seed([promise(1, { dueDate: '2026-09-17' })])
    expect(await closeKairosPromise(USER, uuid(1), { kind: 'rule', reason: 'lapsed_14d' }, NOW)).toMatchObject({ ok: true, promise: { status: 'lapsed', closedBy: { kind: 'rule', reason: 'lapsed_14d' } } })
  })
})

describe('renegotiateKairosPromise (owner only)', () => {
  it('moves the due date and records the history', async () => {
    seed([promise(1)])
    const res = await renegotiateKairosPromise(USER, uuid(1), '2026-10-20', { kind: 'owner', via: 'telegram' }, NOW)
    expect(res).toMatchObject({ ok: true, promise: { dueDate: '2026-10-20', renegotiations: 1, dueHistory: [{ dueDate: '2026-10-10', via: 'telegram' }] } })
  })

  it('refuses non-owners, bad dates and out-of-window dates', async () => {
    seed([promise(1)])
    expect(await renegotiateKairosPromise(USER, uuid(1), '2026-10-20', { kind: 'agent' } as never, NOW)).toEqual({ ok: false, reason: 'forbidden_closer' })
    expect(await renegotiateKairosPromise(USER, uuid(1), '2026-02-30', { kind: 'owner', via: 'session' }, NOW)).toEqual({ ok: false, reason: 'invalid_date' })
    expect(await renegotiateKairosPromise(USER, uuid(1), '2026-11-30', { kind: 'owner', via: 'session' }, NOW)).toEqual({ ok: false, reason: 'due_out_of_window' })
    expect(await renegotiateKairosPromise(USER, uuid(1), '2026-10-10', { kind: 'owner', via: 'session' }, NOW)).toEqual({ ok: false, reason: 'unchanged' })
    expect(h.writes).toBe(0)
  })
})

describe('verifyOpenPromises (06:00 check)', () => {
  const card = (seq: number, over: Partial<KairosPromise> = {}) =>
    promise(seq, { check: { kind: 'card_done', projectId: PROJECT, taskId: TASK }, ...over })
  const event = (over: Record<string, unknown> = {}) => ({
    id: EVENT, entityId: TASK, projectId: PROJECT, actorId: USER, actorType: 'user', createdAt: new Date('2026-09-28T10:00:00Z'), ...over,
  })

  it('does nothing (no query, no trace) with no open promises', async () => {
    expect(await verifyOpenPromises(USER, NOW, { persist: true })).toMatchObject({ open: 0, kept: [], persisted: false })
    expect(h.listPromiseDoneEvents).not.toHaveBeenCalled()
    expect(h.writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('a user completing the card after the promise keeps it via the check closer', async () => {
    seed([card(1)])
    h.listPromiseDoneEvents.mockResolvedValue([event()])
    const res = await verifyOpenPromises(USER, NOW, { persist: true })
    expect(res.kept).toEqual([uuid(1)])
    expect(h.listPromiseDoneEvents).toHaveBeenCalledWith([TASK], new Date('2026-09-25T05:00:00.000Z'), ['done', 'vault'])
    expect(h.state.closed[0]).toMatchObject({ status: 'kept', closedBy: { kind: 'check', activityEventId: EVENT, actorId: USER } })
    expect(h.writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'promise-check', details: expect.objectContaining({ kept: 1 }) }))
  })

  it('an agent completing the card only stamps agentDoneSeenAt', async () => {
    seed([card(1)])
    h.listPromiseDoneEvents.mockResolvedValue([event({ actorType: 'agent' })])
    const res = await verifyOpenPromises(USER, NOW, { persist: true })
    expect(res.kept).toEqual([])
    expect(res.agentSeen).toEqual([uuid(1)])
    expect(h.state.open[0]).toMatchObject({ status: 'open', agentDoneSeenAt: '2026-09-28T10:00:00.000Z' })
  })

  it('ignores events before the promise or on another project', async () => {
    seed([card(1)])
    h.listPromiseDoneEvents.mockResolvedValue([
      event({ createdAt: new Date('2026-09-20T00:00:00Z') }),
      event({ projectId: '44444444-4444-4444-8444-444444444444' }),
    ])
    expect((await verifyOpenPromises(USER, NOW, { persist: true })).kept).toEqual([])
    expect(h.state.open).toHaveLength(1)
  })

  it('owner_confirm never auto-closes, but anything 14+ days late lapses', async () => {
    seed([promise(1, { dueDate: '2026-09-18' }), promise(2, { dueDate: '2026-09-17' }), card(3, { dueDate: '2026-09-10' })])
    const res = await verifyOpenPromises(USER, NOW, { persist: true })
    expect(res.lapsed).toEqual([uuid(2), uuid(3)])
    expect(h.state.open.map((p) => p.seq)).toEqual([1])
    expect(h.state.closed.every((p) => p.closedBy?.kind === 'rule')).toBe(true)
  })

  it('persist:false only plans', async () => {
    seed([card(1)])
    h.listPromiseDoneEvents.mockResolvedValue([event()])
    expect(await verifyOpenPromises(USER, NOW, { persist: false })).toMatchObject({ kept: [uuid(1)], persisted: false })
    expect(h.writes).toBe(0)
    expect(h.writeCronSuccessTrace).not.toHaveBeenCalled()
  })
})

describe('runPromiseNudges (12:00 London, at most once per promise)', () => {
  it('no-ops with the initiative off or outside the noon hour', async () => {
    seed([promise(1, { dueDate: '2026-09-20' })])
    expect(await runPromiseNudges(USER, NOON)).toEqual({ status: 'skipped', reason: 'initiative_off' })
    process.env.KAIROS_INITIATIVE = '1'
    expect(await runPromiseNudges(USER, NOW)).toEqual({ status: 'skipped', reason: 'not_nudge_hour' })
    expect(h.deliverKairosSpeak).not.toHaveBeenCalled()
  })

  it('claims ≥3-days-late promises first, batches them into one forced message, never twice', async () => {
    process.env.KAIROS_INITIATIVE = '1'
    seed([promise(1, { dueDate: '2026-09-28' }), promise(2, { dueDate: '2026-09-29' }), promise(3, { dueDate: '2026-09-25' })])
    const first = await runPromiseNudges(USER, NOON)
    expect(first).toEqual({ status: 'sent', promiseIds: [uuid(1), uuid(3)] })
    expect(h.deliverKairosSpeak).toHaveBeenCalledTimes(1)
    const [, input] = h.deliverKairosSpeak.mock.calls[0]
    expect(input).toMatchObject({ force: true, digest: false, externalId: `kairos-promise-nudge:${uuid(1)}` })
    expect(input.message).toContain('P1 · 3 days late')
    expect(input.message).toContain('P3 · 6 days late')
    expect(input.message).not.toContain('P2')
    expect(h.state.open.find((p) => p.seq === 1)?.nudge).toMatchObject({ delivered: true, memoryId: 'speak-1' })

    expect(await runPromiseNudges(USER, new Date(NOON.getTime() + 10 * 60 * 1000))).toEqual({ status: 'none' })
    expect(h.deliverKairosSpeak).toHaveBeenCalledTimes(1)
  })

  it('a failed send still counts as the one nudge (claimed before sending)', async () => {
    process.env.KAIROS_INITIATIVE = '1'
    seed([promise(1, { dueDate: '2026-09-20' })])
    h.deliverKairosSpeak.mockRejectedValueOnce(new Error('telegram down'))
    expect(await runPromiseNudges(USER, NOON)).toEqual({ status: 'failed', promiseIds: [uuid(1)] })
    expect(h.state.open[0].nudge).toMatchObject({ delivered: false })
    expect(await runPromiseNudges(USER, NOON)).toEqual({ status: 'none' })
  })

  it('message names how to answer', () => {
    expect(buildPromiseNudgeMessage([promise(3, { dueDate: '2026-09-27' })], NOON)).toBe(
      "A promise is overdue:\nP3 · 4 days late · Outcome 3 shipped to beta\nReply 'P3 kept', 'drop P3' or 'P3 by 08/10'.",
    )
  })
})

describe('buildPromiseLine (06:00)', () => {
  const d = (seq: number, dueDate: string, status: 'open' | 'kept' | 'dropped' | 'lapsed' = 'open', outcome = `Outcome ${seq}`) =>
    ({ seq, outcome, dueDate, status })

  it("is '' when nothing is late, due today or freshly closed", () => {
    expect(buildPromiseLine(null, NOW)).toBe('')
    expect(buildPromiseLine({ open: [d(1, '2026-10-05')], closedSince: [d(2, '2026-10-01', 'dropped')] }, NOW)).toBe('')
  })

  it('lists late (most late first), due today and kept / lapsed, plus how to reply', () => {
    const line = buildPromiseLine({
      open: [d(5, '2026-10-01'), d(3, '2026-09-28'), d(7, '2026-10-09')],
      closedSince: [d(2, '2026-09-30', 'kept'), d(4, '2026-09-15', 'lapsed')],
    }, NOW)
    expect(line).toBe("Promises (3 open): P3 · 3 days late · Outcome 3 · P5 · due today · Outcome 5 · ✓ P2 kept · ✗ P4 lapsed. Reply 'P3 kept', 'drop P3' or 'P3 by 08/10'.")
  })

  it('stays within 300 characters however much is due', () => {
    const long = 'x'.repeat(160)
    const open = Array.from({ length: 12 }, (_, i) => d(i + 1, '2026-09-20', 'open', long))
    const line = buildPromiseLine({ open, closedSince: [] }, NOW)
    expect(line.length).toBeLessThanOrEqual(PROMISE_LINE_MAX_CHARS)
    expect(line.startsWith('Promises (12 open): P1')).toBe(true)
  })
})
