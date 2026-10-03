import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KairosAgendaItem } from '@/lib/data/validators/kairos-agenda'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

// agenda_due handler: plans one job per claimed item (key agenda_due:<id>),
// and apply only ever writes a thought, an ask (backlog < 10) or a message
// (force:false; 429 → thought, downgraded). Cancelled since planning →
// nothing. abandon → missed.

const h = vi.hoisted(() => ({
  planAgendaDue: vi.fn(),
  readFiredAgendaItem: vi.fn(),
  settleAgendaItem: vi.fn(),
  markAgendaMissed: vi.fn(),
  createAgendaItems: vi.fn(),
  captureMemory: vi.fn(),
  findMemoriesByIds: vi.fn(),
  findGoal: vi.fn(),
  listOpenKairosAsks: vi.fn(),
  createKairosAskMemory: vi.fn(),
  deliverKairosSpeak: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/kairos/agenda/fire', async (orig) => ({
  ...(await orig<typeof import('@/lib/kairos/agenda/fire')>()),
  planAgendaDue: h.planAgendaDue,
  readFiredAgendaItem: h.readFiredAgendaItem,
  settleAgendaItem: h.settleAgendaItem,
  markAgendaMissed: h.markAgendaMissed,
}))
vi.mock('@/lib/kairos/agenda/create', () => ({ createAgendaItems: h.createAgendaItems }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: h.captureMemory, findMemoriesByIds: h.findMemoriesByIds }))
vi.mock('@/lib/data/goals', () => ({ findGoal: h.findGoal }))
vi.mock('@/lib/data/ask', () => ({ listOpenKairosAsks: h.listOpenKairosAsks, createKairosAskMemory: h.createKairosAskMemory }))
vi.mock('@/lib/kairos/ask-mine', () => ({ ASK_BACKLOG_MAX: 10 }))
vi.mock('@/lib/kairos/speak', () => ({ deliverKairosSpeak: h.deliverKairosSpeak }))

import { agendaDueHandler, applyAgendaDue } from '../../thinking/handlers/agenda-due'

const USER = 'user-1'
const ITEM_ID = '00000000-0000-4000-8000-000000000003'
const NOW = new Date('2026-10-05T09:30:00.000Z')

const item = (over: Partial<KairosAgendaItem> = {}): KairosAgendaItem => ({
  id: ITEM_ID,
  seq: 3,
  what: 'Did the fill-rate fix hold on the runs?',
  dueAt: '2026-10-05T08:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  source: { kind: 'reflect', jobId: 'job-0' },
  basisIds: ['m1'],
  dominionId: null,
  rebookDepth: 0,
  status: 'fired',
  firedAt: NOW.toISOString(),
  ...over,
})

async function plannedJob(over: Partial<KairosAgendaItem> = {}): Promise<ThinkingJobRow> {
  h.planAgendaDue.mockResolvedValueOnce([item(over)])
  const [spec] = await agendaDueHandler.plan(USER, NOW)
  return { id: 'job-1', userId: USER, kind: spec!.kind, externalKey: spec!.externalKey, input: spec!.input } as ThinkingJobRow
}

const reply = (o: Record<string, unknown>) => `\`\`\`json\n${JSON.stringify(o)}\n\`\`\``

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_INITIATIVE = '1'
  process.env.KAIROS_AGENDA = '1'
  h.findMemoriesByIds.mockResolvedValue([{ id: 'm1', title: 'Fill-rate fix', summary: 'Shipped Monday' }])
  h.findGoal.mockResolvedValue(null)
  h.readFiredAgendaItem.mockResolvedValue(item())
  h.settleAgendaItem.mockResolvedValue(true)
  h.captureMemory.mockResolvedValue({ memory: { id: 'obs-1' }, created: true })
  h.listOpenKairosAsks.mockResolvedValue([])
  h.createKairosAskMemory.mockResolvedValue('ask-1')
  h.deliverKairosSpeak.mockResolvedValue({ status: 200, body: { id: 'speak-1', delivered: { inbox: true, telegram: true } } })
  h.createAgendaItems.mockResolvedValue({ created: [{ seq: 9 }], rejected: [] })
})

describe('plan', () => {
  it('one job per claimed item, keyed by item, 8h deadline, grounded ids', async () => {
    const job = await plannedJob()
    expect(job.kind).toBe('agenda_due')
    expect(job.externalKey).toBe(`agenda_due:${ITEM_ID}`)
    expect(job.input.validMemoryIds).toEqual(['m1'])
    expect(job.input.prompt).toContain('A3')
    h.planAgendaDue.mockResolvedValueOnce([])
    expect(await agendaDueHandler.plan(USER, NOW)).toEqual([])
  })
})

describe('apply', () => {
  it('thought → one agentic observation, item settled', async () => {
    const job = await plannedJob()
    const res = await applyAgendaDue(job, reply({ result: 'thought', text: 'It held on all three runs.' }), 'routine', NOW)
    expect(res).toMatchObject({ ok: true, memoryIds: ['obs-1'] })
    expect(h.captureMemory).toHaveBeenCalledWith(USER, expect.objectContaining({
      type: 'observation', streamClass: 'agentic', tags: ['agenda'],
      sourceMetadata: expect.objectContaining({ externalId: `agenda:${ITEM_ID}` }),
    }))
    expect(h.settleAgendaItem).toHaveBeenCalledWith(USER, ITEM_ID, 'job-1', { kind: 'thought', memoryId: 'obs-1' }, NOW)
    expect(h.deliverKairosSpeak).not.toHaveBeenCalled()
  })

  it('message → speak with force:false and the item externalId', async () => {
    const job = await plannedJob()
    await applyAgendaDue(job, reply({ result: 'message', text: 'The fix held.' }), 'routine', NOW)
    expect(h.deliverKairosSpeak).toHaveBeenCalledWith(USER, expect.objectContaining({ force: false, externalId: `kairos-agenda:${ITEM_ID}` }))
    expect(h.settleAgendaItem).toHaveBeenCalledWith(USER, ITEM_ID, 'job-1', { kind: 'message', memoryId: 'speak-1' }, NOW)
  })

  it('message hitting a 429 is downgraded to a thought', async () => {
    h.deliverKairosSpeak.mockResolvedValue({ status: 429, body: { error: 'gap' } })
    const job = await plannedJob()
    await applyAgendaDue(job, reply({ result: 'message', text: 'The fix held.' }), 'routine', NOW)
    expect(h.captureMemory).toHaveBeenCalledTimes(1)
    expect(h.settleAgendaItem).toHaveBeenCalledWith(USER, ITEM_ID, 'job-1', { kind: 'thought', memoryId: 'obs-1', downgraded: true }, NOW)
  })

  it('ask → an owner question while the backlog is under 10; a full backlog → thought', async () => {
    const job = await plannedJob()
    await applyAgendaDue(job, reply({ result: 'ask', text: 'Did the Thursday runs use the new config?' }), 'routine', NOW)
    expect(h.createKairosAskMemory).toHaveBeenCalledWith(USER, expect.objectContaining({ externalId: `agenda:${ITEM_ID}`, sourceMemoryIds: ['m1'] }))
    expect(h.settleAgendaItem).toHaveBeenLastCalledWith(USER, ITEM_ID, 'job-1', { kind: 'ask', memoryId: 'ask-1' }, NOW)

    h.listOpenKairosAsks.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` })))
    h.createKairosAskMemory.mockClear()
    await applyAgendaDue(job, reply({ result: 'ask', text: 'Did the Thursday runs use the new config?' }), 'routine', NOW)
    expect(h.createKairosAskMemory).not.toHaveBeenCalled()
    expect(h.settleAgendaItem).toHaveBeenLastCalledWith(USER, ITEM_ID, 'job-1', { kind: 'thought', memoryId: 'obs-1', downgraded: true }, NOW)
  })

  it('a cancelled (no longer fired) item writes nothing', async () => {
    const job = await plannedJob()
    h.readFiredAgendaItem.mockResolvedValue(null)
    const res = await applyAgendaDue(job, reply({ result: 'message', text: 'x' }), 'routine', NOW)
    expect(res).toMatchObject({ ok: true, memoryIds: [], output: { skipped: 'not_fired' } })
    expect(h.captureMemory).not.toHaveBeenCalled()
    expect(h.deliverKairosSpeak).not.toHaveBeenCalled()
    expect(h.settleAgendaItem).not.toHaveBeenCalled()
  })

  it('flag off at apply → missed, nothing written', async () => {
    const job = await plannedJob()
    delete process.env.KAIROS_AGENDA
    const res = await applyAgendaDue(job, reply({ result: 'thought', text: 'x' }), 'routine', NOW)
    expect(res).toMatchObject({ ok: true, output: { skipped: 'agenda_off' } })
    expect(h.markAgendaMissed).toHaveBeenCalledWith(USER, ITEM_ID, 'job-1', NOW)
    expect(h.captureMemory).not.toHaveBeenCalled()
  })

  it('bad output fails the job without writing', async () => {
    const job = await plannedJob()
    expect(await applyAgendaDue(job, 'no json here', 'routine', NOW)).toMatchObject({ ok: false })
    expect(await applyAgendaDue(job, reply({ result: 'delete_card', text: 'x' }), 'routine', NOW)).toMatchObject({ ok: false })
    expect(h.captureMemory).not.toHaveBeenCalled()
    expect(h.settleAgendaItem).not.toHaveBeenCalled()
  })

  it('one rebook at depth 0 (after settling); none from a rebook', async () => {
    const job = await plannedJob()
    const res = await applyAgendaDue(job, reply({ result: 'nothing', text: '', rebook: { date: '2026-10-08', slot: 'afternoon' } }), 'routine', NOW)
    expect(h.createAgendaItems).toHaveBeenCalledWith(
      USER,
      [expect.objectContaining({ what: item().what, date: '2026-10-08', slot: 'afternoon' })],
      { kind: 'agenda_due', jobId: 'job-1' },
      expect.objectContaining({ rebookDepth: 1 }),
    )
    expect(res).toMatchObject({ ok: true, output: { rebooked: 'A9', result: { kind: 'nothing' } } })
    expect(h.settleAgendaItem.mock.invocationCallOrder[0]).toBeLessThan(h.createAgendaItems.mock.invocationCallOrder[0]!)

    h.createAgendaItems.mockClear()
    h.readFiredAgendaItem.mockResolvedValue(item({ rebookDepth: 1 }))
    await applyAgendaDue(job, reply({ result: 'nothing', text: '', rebook: { date: '2026-10-08', slot: 'afternoon' } }), 'routine', NOW)
    expect(h.createAgendaItems).not.toHaveBeenCalled()
  })
})

describe('abandon / fallback', () => {
  it('abandon marks the item missed; there is no fallback', async () => {
    const job = await plannedJob()
    expect(await agendaDueHandler.abandon!(job, 'expired')).toEqual([])
    expect(h.markAgendaMissed).toHaveBeenCalledWith(USER, ITEM_ID, 'job-1')
    expect(await agendaDueHandler.fallback(job)).toMatchObject({ ok: false })
  })
})
