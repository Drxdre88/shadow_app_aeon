import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KairosAgendaItem, KairosAgendaState } from '@/lib/data/validators/kairos-agenda'

// Horae library: booking rules (caps, duplicates, "a check, never an act"),
// the claim-once planning pass, owner cancel and goal check-ins. The data
// layer is an in-memory stand-in that validates every write.

const h = vi.hoisted(() => ({
  state: null as unknown as KairosAgendaState,
  writes: 0,
  findGoal: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/kairos-agenda', async () => {
  const { kairosAgendaStateSchema } = await import('@/lib/data/validators/kairos-agenda')
  return {
    readKairosAgenda: vi.fn(async () => h.state),
    mutateKairosAgenda: vi.fn(async (_u: string, fn: (s: KairosAgendaState) => { state: KairosAgendaState | null; result: unknown }) => {
      const { state, result } = fn(h.state)
      if (state) { h.state = kairosAgendaStateSchema.parse(state); h.writes++ }
      return result
    }),
    findOpenKairosAgendaBySeq: vi.fn(async (_u: string, seq: number) => h.state.open.find((i) => i.seq === seq && i.status === 'open') ?? null),
  }
})
vi.mock('@/lib/data/goals', () => ({ findGoal: h.findGoal }))

import { createAgendaItems } from '../create'
import { cancelAgendaItem } from '../cancel'
import { markAgendaMissed, planAgendaDue, planAgendaPass, settleAgendaItem } from '../fire'
import { bookGoalCheckins, planGoalCheckins } from '../goal-checkins'
import { agendaDueAt, checkAgendaWhat } from '../rules'
import { parseAgendaCommands, routeAgendaCommands } from '../telegram-commands'

const USER = 'user-1'
const NOW = new Date('2026-10-02T09:00:00.000Z') // Fri 10:00 London (BST)
const GOAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SRC = { kind: 'reflect' as const, jobId: 'job-1' }
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function item(seq: number, over: Partial<KairosAgendaItem> = {}): KairosAgendaItem {
  return {
    id: uuid(seq),
    seq,
    what: `Check whether fix ${seq} held on the runs`,
    dueAt: '2026-10-05T08:00:00.000Z',
    createdAt: '2026-09-28T09:00:00.000Z',
    source: { kind: 'reflect', jobId: `old-${seq}` },
    basisIds: [],
    dominionId: null,
    rebookDepth: 0,
    status: 'open',
    ...over,
  }
}

function seed(open: KairosAgendaItem[] = [], closed: KairosAgendaItem[] = []) {
  h.state = { v: 1, nextSeq: Math.max(0, ...open.map((i) => i.seq), ...closed.map((i) => i.seq)) + 1, open, closed }
}

const proposal = (what: string, date = '2026-10-06', slot: 'morning' | 'afternoon' = 'morning') => ({ what, date, slot })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_INITIATIVE = '1'
  process.env.KAIROS_AGENDA = '1'
  h.writes = 0
  seed()
})

describe('rules', () => {
  it('slots are 09:00 / 14:00 London across the clock change', () => {
    expect(agendaDueAt('2026-10-06', 'morning')).toBe('2026-10-06T08:00:00.000Z')
    expect(agendaDueAt('2026-11-03', 'afternoon')).toBe('2026-11-03T14:00:00.000Z')
  })

  it('accepts checks and questions; rejects acts, statements and forbidden topics', () => {
    expect(checkAgendaWhat('Check whether the fill-rate fix held')).toBeNull()
    expect(checkAgendaWhat("Did the fill-rate fix hold on Thursday's runs?")).toBeNull()
    expect(checkAgendaWhat('Deploy the fill-rate fix to production')).toBe('action_verb')
    expect(checkAgendaWhat('The fill-rate fix should be fine by then')).toBe('not_a_check')
    expect(checkAgendaWhat('Did the fix hold')).toBe('not_a_check')
    expect(checkAgendaWhat('Review whether my memory scoring is drifting')).toBe('forbidden_topic')
    expect(checkAgendaWhat('Check the cron schedule for the nightly run')).toBe('forbidden_topic')
  })
})

describe('createAgendaItems', () => {
  it('books an open A-numbered item at the slot time', async () => {
    seed([], [item(4, { status: 'done' })])
    const res = await createAgendaItems(USER, [{ ...proposal('Check whether the login fix held'), basisIds: ['m1', 'zzz'] }], SRC, { now: NOW, validBasisIds: new Set(['m1']) })
    expect(res.rejected).toEqual([])
    expect(res.created[0]).toMatchObject({ seq: 5, status: 'open', dueAt: '2026-10-06T08:00:00.000Z', basisIds: ['m1'], rebookDepth: 0, source: SRC })
    expect(h.state.open).toHaveLength(1)
  })

  it('does nothing with a flag off', async () => {
    delete process.env.KAIROS_AGENDA
    const res = await createAgendaItems(USER, [proposal('Check whether the login fix held')], SRC, { now: NOW })
    expect(res).toEqual({ created: [], rejected: [{ index: 0, reason: 'disabled' }] })
    expect(h.writes).toBe(0)
  })

  it('rejects bad text, out-of-window dates and extra fields', async () => {
    const res = await createAgendaItems(USER, [
      proposal('Ship the login fix to everyone'),
      proposal('Check whether the login fix held', '2026-10-02', 'morning'), // 09:00 London already passed
    ], SRC, { now: NOW })
    expect(res.rejected).toEqual([{ index: 0, reason: 'action_verb' }, { index: 1, reason: 'due_out_of_window' }])
    const far = await createAgendaItems(USER, [proposal('Check whether the login fix held', '2026-10-20')], { kind: 'reflect', jobId: 'j2' }, { now: NOW })
    expect(far.rejected).toEqual([{ index: 0, reason: 'due_out_of_window' }])
    const extra = await createAgendaItems(USER, [{ ...proposal('Check whether the login fix held'), status: 'done' }], { kind: 'reflect', jobId: 'j3' }, { now: NOW })
    expect(extra.rejected).toEqual([{ index: 0, reason: 'invalid' }])
    expect(h.writes).toBe(0)
  })

  it('caps: 2 per job (also across calls), 3 per London day, 8 open', async () => {
    const res = await createAgendaItems(USER, [
      proposal('Check whether fix A held'), proposal('Check whether fix B held'), proposal('Check whether fix C held'),
    ], SRC, { now: NOW })
    expect(res.created).toHaveLength(2)
    expect(res.rejected).toEqual([{ index: 2, reason: 'over_per_job_cap' }])
    const again = await createAgendaItems(USER, [proposal('Check whether fix D held')], SRC, { now: NOW })
    expect(again.rejected).toEqual([{ index: 0, reason: 'over_per_job_cap' }])

    const day = await createAgendaItems(USER, [proposal('Check whether fix E held'), proposal('Check whether fix F held')], { kind: 'reflect', jobId: 'j2' }, { now: NOW })
    expect(day.created).toHaveLength(1)
    expect(day.rejected).toEqual([{ index: 1, reason: 'over_daily_cap' }])

    seed([1, 2, 3, 4, 5, 6, 7, 8].map((n) => item(n)))
    const full = await createAgendaItems(USER, [proposal('Check whether fix G held')], { kind: 'reflect', jobId: 'j3' }, { now: NOW })
    expect(full.rejected).toEqual([{ index: 0, reason: 'over_open_cap' }])
  })

  it('rejects a duplicate of an open item (normalised)', async () => {
    seed([item(1, { what: 'Check whether the login fix held' })])
    const res = await createAgendaItems(USER, [proposal('check whether  the LOGIN fix held!')], SRC, { now: NOW })
    expect(res.rejected).toEqual([{ index: 0, reason: 'duplicate' }])
  })
})

describe('planAgendaPass / planAgendaDue', () => {
  const later = new Date('2026-10-05T09:30:00.000Z')

  it('fires at most two due items, once', async () => {
    seed([item(1), item(2), item(3), item(4, { dueAt: '2026-10-09T08:00:00.000Z' })])
    h.findGoal.mockResolvedValue(null)
    const first = await planAgendaDue(USER, later)
    expect(first.map((i) => i.seq)).toEqual([1, 2])
    expect(h.state.open.filter((i) => i.status === 'fired').map((i) => i.seq)).toEqual([1, 2])
    const second = await planAgendaDue(USER, later)
    expect(second.map((i) => i.seq)).toEqual([3])
    expect(await planAgendaDue(USER, later)).toEqual([])
  })

  it('plans nothing with a flag off', async () => {
    seed([item(1)])
    delete process.env.KAIROS_INITIATIVE
    expect(await planAgendaDue(USER, later)).toEqual([])
    expect(h.writes).toBe(0)
  })

  it('cancels an item whose goal is finished (rule goal_closed) instead of firing it', async () => {
    seed([item(1, { goalId: GOAL })])
    h.findGoal.mockResolvedValue({ id: GOAL, archivedAt: null, meta: { state: 'done' } })
    expect(await planAgendaDue(USER, later)).toEqual([])
    expect(h.state.closed[0]).toMatchObject({ seq: 1, status: 'cancelled', cancelledBy: { kind: 'rule', reason: 'goal_closed' } })
  })

  it('expires a never-fired item 48h past due and marks a stale fired item missed', () => {
    const state: KairosAgendaState = {
      v: 1, nextSeq: 3, closed: [],
      open: [item(1, { dueAt: '2026-10-01T08:00:00.000Z' }), item(2, { status: 'fired', firedAt: '2026-10-04T20:00:00.000Z' })],
    }
    const pass = planAgendaPass(state, later, new Set())
    expect(pass.fire).toEqual([])
    expect(pass.cancelled).toEqual([uuid(1)])
    expect(pass.missed).toEqual([uuid(2)])
    expect(pass.state!.closed.map((i) => i.status).sort()).toEqual(['cancelled', 'missed'])
  })

  it('settle and missed only move a fired item', async () => {
    seed([item(1, { status: 'fired', firedAt: later.toISOString() }), item(2)])
    expect(await settleAgendaItem(USER, uuid(2), 'job-x', { kind: 'nothing' }, later)).toBe(false)
    expect(await settleAgendaItem(USER, uuid(1), 'job-x', { kind: 'thought', memoryId: 'm1' }, later)).toBe(true)
    expect(h.state.closed[0]).toMatchObject({ status: 'done', firedJobId: 'job-x', result: { kind: 'thought', memoryId: 'm1' } })
    expect(await markAgendaMissed(USER, uuid(1), 'job-x', later)).toBe(false)
  })
})

describe('cancelAgendaItem', () => {
  it('owner cancels an open or fired item; refuses non-owners', async () => {
    seed([item(1), item(2, { status: 'fired', firedAt: NOW.toISOString() })])
    expect(await cancelAgendaItem(USER, uuid(1), { kind: 'owner', via: 'session' }, NOW)).toMatchObject({ ok: true, item: { status: 'cancelled', cancelledBy: { kind: 'owner', via: 'session' } } })
    expect(await cancelAgendaItem(USER, uuid(2), { kind: 'owner', via: 'telegram' }, NOW)).toMatchObject({ ok: true })
    expect(await cancelAgendaItem(USER, uuid(1), { kind: 'owner', via: 'session' }, NOW)).toEqual({ ok: false, reason: 'already_closed' })
    expect(await cancelAgendaItem(USER, uuid(9), { kind: 'owner', via: 'session' }, NOW)).toEqual({ ok: false, reason: 'not_found' })
    expect(await cancelAgendaItem(USER, uuid(9), { kind: 'agent', via: 'mcp' } as never, NOW)).toEqual({ ok: false, reason: 'forbidden_canceller' })
  })
})

describe('Telegram "cancel A3"', () => {
  it('parses full-line commands only', () => {
    expect(parseAgendaCommands('cancel A3')).toEqual([{ kind: 'cancel', seq: 3 }])
    expect(parseAgendaCommands('Cancel a12.')).toEqual([{ kind: 'cancel', seq: 12 }])
    expect(parseAgendaCommands('cancel A3\ncancel A4')).toEqual([{ kind: 'cancel', seq: 3 }, { kind: 'cancel', seq: 4 }])
    expect(parseAgendaCommands('cancel A3 please')).toBeNull()
    expect(parseAgendaCommands('cancel P3')).toBeNull()
    expect(parseAgendaCommands('cancel A3\nhow are things?')).toBeNull()
    expect(parseAgendaCommands('  ')).toBeNull()
  })

  it('cancels as the owner via telegram and acks in one line', async () => {
    seed([item(3)])
    const send = vi.fn(async () => undefined)
    expect(await routeAgendaCommands(USER, 'cancel A3\ncancel A7', send, NOW)).toBe(true)
    expect(send).toHaveBeenCalledWith('✓ A3 cancelled · A7: not on Horae')
    expect(h.state.closed[0]).toMatchObject({ seq: 3, cancelledBy: { kind: 'owner', via: 'telegram' } })
    expect(await routeAgendaCommands(USER, 'hello', send, NOW)).toBe(false)
  })
})

describe('goal check-ins', () => {
  const goal = (dueAt: string | null) => ({ id: GOAL, title: 'Why do Monday boards drift?', dominionId: null, meta: { dueAt } as never })

  it('midpoint + day before for a goal of 4+ days; day before only when shorter', () => {
    const long = planGoalCheckins(goal('2026-10-09T09:00:00.000Z'), NOW)
    expect(long.map((p) => p.date)).toEqual(['2026-10-05', '2026-10-08'])
    expect(long.every((p) => p.slot === 'morning' && p.goalId === GOAL)).toBe(true)
    expect(long.every((p) => checkAgendaWhat(p.what) === null)).toBe(true)
    expect(planGoalCheckins(goal('2026-10-05T09:00:00.000Z'), NOW).map((p) => p.date)).toEqual(['2026-10-04'])
    expect(planGoalCheckins(goal(null), NOW)).toEqual([])
  })

  it('books two goal_checkin items under the flag, none without it', async () => {
    const res = await bookGoalCheckins(USER, goal('2026-10-09T09:00:00.000Z'), NOW)
    expect(res!.created).toHaveLength(2)
    expect(res!.created[0]).toMatchObject({ source: { kind: 'goal_checkin', goalId: GOAL }, goalId: GOAL })
    delete process.env.KAIROS_AGENDA
    seed()
    expect(await bookGoalCheckins(USER, goal('2026-10-09T09:00:00.000Z'), NOW)).toBeNull()
    expect(h.state.open).toEqual([])
  })
})
