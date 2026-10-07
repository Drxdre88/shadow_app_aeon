import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pins the on-read morning cockpit: every source is called for the caller
// only, each section is capped with its full count, Vorath's own engines are
// excluded from overnight sessions, held rows are dropped and an empty
// account gives empty sections.

const h = vi.hoisted(() => ({ held: [] as Array<{ id: string }>, wheres: [] as unknown[] }))

vi.mock('@/lib/db', () => {
  const select = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: unknown) => { h.wheres.push(w); return chain }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(h.held)
    return chain
  }
  return { db: { select: vi.fn(select) } }
})
vi.mock('@/lib/data/ask', () => ({ listOpenKairosAsks: vi.fn() }))
vi.mock('@/lib/data/board-signals', () => ({ listStaleTasks: vi.fn() }))
vi.mock('@/lib/data/inbox', () => ({ getKairosInbox: vi.fn() }))
vi.mock('@/lib/data/kairos-predictions', () => ({ listKairosPredictions: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({ listKairosPromises: vi.fn() }))
vi.mock('@/lib/data/repo-memory', () => ({ listRepoPlaybooks: vi.fn(), listSessionSummariesBetween: vi.fn() }))
vi.mock('@/lib/data/sessions', () => ({ listAgentSessions: vi.fn() }))

import { listOpenKairosAsks } from '@/lib/data/ask'
import { listStaleTasks } from '@/lib/data/board-signals'
import { getKairosInbox } from '@/lib/data/inbox'
import { listKairosPredictions } from '@/lib/data/kairos-predictions'
import { listKairosPromises } from '@/lib/data/kairos-promises'
import { listRepoPlaybooks, listSessionSummariesBetween } from '@/lib/data/repo-memory'
import { listAgentSessions } from '@/lib/data/sessions'
import { COCKPIT_CAP, overnightSince, readMorningCockpit } from '../morning-cockpit'
import { renderCockpitMarkdown } from '@/lib/kairos/cockpit/render'

const NOW = new Date('2026-10-07T06:30:00.000Z')
const USER = 'user-1'

const prediction = (seq: number, dueDate: string, status = 'open') => ({ id: `r${seq}`, seq, claim: `Claim ${seq}`, probability: 0.7, dueDate, status })
const promise = (seq: number, dueDate: string) => ({ id: `p${seq}`, seq, outcome: `Outcome ${seq}`, dueDate, status: 'open' })
const ask = (seq: number) => ({ id: `a${seq}`, seq, title: `Question ${seq}?`, summary: null, dominionId: null, createdAt: NOW, expiresAt: null, kairosAsk: { status: 'pending', askedAt: NOW.toISOString() } })
const session = (id: string, engine: string, extra: Record<string, unknown> = {}) => ({
  id, engine, goal: `Goal ${id}`, status: 'succeeded', repo: null, projectId: null, taskId: null, spawnedAt: NOW, endedAt: null, ...extra,
})

function emptySources() {
  vi.mocked(listKairosPredictions).mockResolvedValue({ predictions: [], closed: [] } as never)
  vi.mocked(listKairosPromises).mockResolvedValue([])
  vi.mocked(listOpenKairosAsks).mockResolvedValue([])
  vi.mocked(getKairosInbox).mockResolvedValue({ items: [] })
  vi.mocked(listStaleTasks).mockResolvedValue([])
  vi.mocked(listAgentSessions).mockResolvedValue([])
  vi.mocked(listSessionSummariesBetween).mockResolvedValue([])
  vi.mocked(listRepoPlaybooks).mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  h.held = []
  h.wheres = []
  emptySources()
})

describe('readMorningCockpit', () => {
  it('returns calm empty sections for an empty account', async () => {
    const c = await readMorningCockpit(USER, NOW)
    for (const s of [c.predictions, c.asks, c.promises, c.proposals, c.staleCards, c.sessions, c.repoLessons]) {
      expect(s).toEqual({ count: 0, items: [] })
    }
    expect(c.today).toBe('2026-10-07')
    expect(listRepoPlaybooks).toHaveBeenCalledWith(USER, [])
    const md = renderCockpitMarkdown(c)
    expect(md).toContain('Nothing due today.')
    expect(md).toContain('BEGIN COCKPIT DATA')
  })

  it('reads every source for the calling user only', async () => {
    await readMorningCockpit(USER, NOW)
    expect(listKairosPredictions).toHaveBeenCalledWith(USER, { scope: 'open' })
    expect(listKairosPromises).toHaveBeenCalledWith(USER, { scope: 'open' })
    expect(listOpenKairosAsks).toHaveBeenCalledWith(USER, NOW)
    expect(getKairosInbox).toHaveBeenCalledWith(USER, NOW)
    expect(listStaleTasks).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }))
    expect(listAgentSessions).toHaveBeenCalledWith(USER, expect.objectContaining({ since: overnightSince(NOW) }))
    expect(vi.mocked(listSessionSummariesBetween).mock.calls[0][0]).toBe(USER)
  })

  it('starts overnight at 18:00 London yesterday (BST and GMT)', () => {
    expect(overnightSince(NOW).toISOString()).toBe('2026-10-06T17:00:00.000Z')
    expect(overnightSince(new Date('2026-12-02T07:00:00.000Z')).toISOString()).toBe('2026-12-01T18:00:00.000Z')
  })

  it('caps each list at eight while counting everything', async () => {
    vi.mocked(listKairosPromises).mockResolvedValue(Array.from({ length: 11 }, (_, i) => promise(i + 1, '2026-10-20')) as never)
    vi.mocked(listOpenKairosAsks).mockResolvedValue(Array.from({ length: 9 }, (_, i) => ask(i + 1)) as never)
    vi.mocked(listStaleTasks).mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({
      taskId: `t${i}`, name: `Card ${i}`, projectId: 'b1', projectName: 'Board', columnName: 'Live', priority: null, ageDays: 30,
    })) as never)
    const c = await readMorningCockpit(USER, NOW)
    expect(c.promises.count).toBe(11)
    expect(c.promises.items).toHaveLength(COCKPIT_CAP)
    expect(c.asks.count).toBe(9)
    expect(c.asks.items.map((a) => a.number)[0]).toBe('Q1')
    expect(c.staleCards.count).toBe(20)
    expect(c.staleCards.items).toHaveLength(COCKPIT_CAP)
    expect(renderCockpitMarkdown(c)).toContain('…and 12 more')
  })

  it('lists only predictions due by today or awaiting a verdict', async () => {
    vi.mocked(listKairosPredictions).mockResolvedValue({
      predictions: [prediction(3, '2026-10-30'), prediction(2, '2026-10-07'), prediction(1, '2026-10-01'), prediction(4, '2026-11-01', 'needs_verdict')],
      closed: [],
    } as never)
    const c = await readMorningCockpit(USER, NOW)
    expect(c.predictions.items.map((p) => [p.number, p.overdue, p.needsVerdict])).toEqual([
      ['R1', true, false], ['R2', false, false], ['R4', false, true],
    ])
  })

  it("excludes Vorath's internal engines from overnight sessions", async () => {
    vi.mocked(listAgentSessions).mockResolvedValue([
      session('s1', 'claude', { projectId: 'b1', repo: 'Drxdre88/shadow_app_aeon' }),
      session('s2', 'kairos-chat'),
      session('s3', 'kairos-dialogue'),
      session('s4', 'codex'),
    ] as never)
    const c = await readMorningCockpit(USER, NOW)
    expect(c.sessions.items.map((s) => s.id)).toEqual(['s1', 's4'])
    expect(c.sessions.count).toBe(2)
  })

  it('keeps proposals that are goals or card plans and drops held rows', async () => {
    vi.mocked(listOpenKairosAsks).mockResolvedValue([ask(1), ask(2)] as never)
    vi.mocked(getKairosInbox).mockResolvedValue({ items: [
      { kind: 'proposal', id: 'g1', title: 'Goal', summary: null, createdAt: NOW, goal: { question: 'Ship cockpit?', why: '', successCheck: '', dueInDays: 7, expiresAt: '2026-10-09T00:00:00.000Z' } },
      { kind: 'proposal', id: 'c1', title: 'Plan', summary: null, createdAt: NOW, cardTree: { projectId: 'b1', projectName: 'Board', goal: 'Plan launch', rationale: '', cards: [], expiresAt: '2026-10-12T00:00:00.000Z' } },
      { kind: 'proposal', id: 'x1', title: 'Plain proposal', summary: null, createdAt: NOW },
      { kind: 'notify', id: 'n1', title: 'Daily', summary: null, urgency: 'normal', createdAt: NOW, daily: true },
    ] } as never)
    h.held = [{ id: 'a2' }, { id: 'c1' }]
    const c = await readMorningCockpit(USER, NOW)
    expect(c.asks.items.map((a) => a.id)).toEqual(['a1'])
    expect(c.proposals.items.map((p) => [p.id, p.kind, p.detail])).toEqual([['g1', 'goal', 'Ship cockpit?']])
    expect(h.wheres).toHaveLength(1)
  })

  it('lists repos whose playbook changed since the overnight start', async () => {
    vi.mocked(listSessionSummariesBetween).mockResolvedValue([{ id: 'm1', repo: 'swarm' }] as never)
    vi.mocked(listAgentSessions).mockResolvedValue([session('s1', 'claude', { repo: 'Drxdre88/shadow_app_aeon' })] as never)
    const lessons = [{ kind: 'worked', text: 'Run typecheck first', sourceIds: ['m1'] }]
    vi.mocked(listRepoPlaybooks).mockResolvedValue([
      { id: 'pb1', slug: 'swarm', updatedAt: new Date('2026-10-07T02:00:00.000Z'), playbook: { repo: 'swarm', lessons } },
      { id: 'pb2', slug: 'shadow_app_aeon', updatedAt: new Date('2026-10-05T02:00:00.000Z'), playbook: { repo: 'shadow_app_aeon', lessons } },
    ] as never)
    const c = await readMorningCockpit(USER, NOW)
    const slugs = vi.mocked(listRepoPlaybooks).mock.calls[0][1]
    expect([...slugs].sort()).toEqual(['shadow_app_aeon', 'swarm'])
    expect(c.repoLessons.items).toEqual([{ id: 'pb1', slug: 'swarm', lessonCount: 1, topLesson: 'Run typecheck first', updatedAt: '2026-10-07T02:00:00.000Z' }])
  })
})
