import { beforeEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({
  listRecentKairosAsks: vi.fn(),
  findDominionsByUser: vi.fn(),
  listDominionObjectives: vi.fn(),
  listPromotedBeliefsBetween: vi.fn(),
  listMemoryOps: vi.fn(),
  findMemoryById: vi.fn(),
  listMemories: vi.fn(),
  listTraceHistory: vi.fn(),
  listBeliefs: vi.fn(),
  getLatestMindCompare: vi.fn(),
}))

vi.mock('@/lib/data/ask', () => ({ listRecentKairosAsks: data.listRecentKairosAsks }))
vi.mock('@/lib/data/beliefs', () => ({ listBeliefs: data.listBeliefs, getLatestMindCompare: data.getLatestMindCompare }))
vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: data.findDominionsByUser,
  listDominionObjectives: data.listDominionObjectives,
}))
vi.mock('@/lib/data/memory-candidates', () => ({ listPromotedBeliefsBetween: data.listPromotedBeliefsBetween }))
vi.mock('@/lib/data/memory-ops', () => ({ listMemoryOps: data.listMemoryOps }))
vi.mock('@/lib/data/memories', () => ({ findMemoryById: data.findMemoryById, listMemories: data.listMemories }))
vi.mock('@/lib/data/recipes', () => ({ listTraceHistory: data.listTraceHistory }))

import { fedMemoryIds, gatherWeeklyReviewInputs, hasReviewSignal, reviewWindow } from '../inputs'

const USER = 'user-1'
// Monday of ISO 2026-W41; the week under review is W40 (Sep 28 – Oct 4).
const MONDAY = new Date('2026-10-05T05:10:00Z')
const IN_WEEK = new Date('2026-10-01T12:00:00Z')
const BEFORE_WEEK = new Date('2026-09-20T12:00:00Z')

function row(id: string, over: Record<string, unknown> = {}) {
  return { id, title: `title ${id}`, summary: null, createdAt: IN_WEEK, updatedAt: IN_WEEK, sourceMetadata: {}, ...over }
}

function belief(id: string, over: Record<string, unknown> = {}) {
  return { id, mind: 'aligned', domain: 'general', claim: `claim ${id}`, status: 'held', createdAt: IN_WEEK, updatedAt: IN_WEEK, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  data.findDominionsByUser.mockResolvedValue([
    { id: 'dom-1', name: 'Swarm', archivedAt: null },
    { id: 'dom-old', name: 'Old', archivedAt: new Date() },
  ])
  data.listDominionObjectives.mockResolvedValue([
    { title: 'Ship P2', status: 'active', updatedAt: IN_WEEK, targetDate: null },
    { title: 'Done thing', status: 'completed', updatedAt: IN_WEEK, targetDate: null },
  ])
  data.listMemories.mockImplementation(async (_u: string, opts: { type: string }) => {
    if (opts.type === 'achievement') {
      return [
        row('day-1', { sourceMetadata: { kind: 'board_day', date: '2026-10-01', finished: [{ title: 'Card A' }, { title: 'Card B' }] } }),
        row('week-1', { sourceMetadata: { kind: 'board_week', isoWeek: '2026-W40', counts: { finished: 3, created: 2, untouched: 4 } } }),
        row('day-old', { createdAt: BEFORE_WEEK, sourceMetadata: { kind: 'board_day', date: '2026-09-20', finished: [] } }),
        row('other', { sourceMetadata: { kind: 'achievement_other' } }),
      ]
    }
    return []
  })
  data.listBeliefs.mockResolvedValue([
    belief('belief-new', { claim: 'New claim', mind: 'own', domain: 'Swarm', status: 'held' }),
    belief('belief-retired', { createdAt: BEFORE_WEEK, claim: 'Old claim', mind: 'aligned', status: 'retired' }),
    belief('belief-reinforced', { createdAt: BEFORE_WEEK, status: 'held' }),
  ])
  data.getLatestMindCompare.mockResolvedValue({ id: 'mc-1', title: 'Mind compare · 2026-W40', summary: '3 agree, 1 diverge', createdAt: IN_WEEK })
  data.findMemoryById.mockResolvedValue({ bodyMd: '**Changed**\n- Finished: Big card\n- Added: New card\n- Moved: X' })
  data.listMemoryOps.mockResolvedValue([
    { op: 'promote', createdAt: IN_WEEK },
    { op: 'decay', createdAt: IN_WEEK },
    { op: 'decay', createdAt: IN_WEEK },
    { op: 'decay', createdAt: BEFORE_WEEK },
  ])
  data.listPromotedBeliefsBetween.mockResolvedValue([{ opId: 'op-1', memoryId: 'promo-1', title: 'Promoted idea' }])
  data.listRecentKairosAsks.mockResolvedValue([
    { id: 'ask-pending', title: 'Pending?', createdAt: BEFORE_WEEK, kairosAsk: { status: 'pending' } },
    { id: 'ask-expired', title: 'Expired?', createdAt: IN_WEEK, kairosAsk: { status: 'expired' } },
    { id: 'ask-answered', title: 'Answered', createdAt: IN_WEEK, kairosAsk: { status: 'answered' } },
  ])
  data.listTraceHistory.mockResolvedValue([
    row('t1', { sourceMetadata: { cronName: 'aether', reason: 'parse_failed:schema' } }),
    row('t2', { sourceMetadata: { cronName: 'aether', reason: 'empty_response' } }),
    row('t3', { sourceMetadata: { cronName: 'cortex', outcome: 'ok' } }),
  ])
})

describe('reviewWindow', () => {
  it('reviews the ISO week that ended at the latest Monday 00:00Z', () => {
    const w = reviewWindow(MONDAY)
    expect(w.isoWeek).toBe('2026-W40')
    expect(w.start.toISOString()).toBe('2026-09-28T00:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-10-05T00:00:00.000Z')
    expect(reviewWindow(new Date('2026-10-07T10:00:00Z')).isoWeek).toBe('2026-W40')
  })
})

describe('gatherWeeklyReviewInputs', () => {
  it('collects every source inside the window', async () => {
    const inputs = await gatherWeeklyReviewInputs(USER, MONDAY)
    expect(inputs.errors).toEqual([])
    expect(inputs.dominions).toEqual([{ id: 'dom-1', name: 'Swarm' }])
    expect(inputs.boardPages.map((p) => p.id)).toEqual(['day-1', 'week-1'])
    expect(inputs.boardPages[0]).toMatchObject({ finished: 2, topTitles: ['Card A', 'Card B'] })
    expect(inputs.boardPages[1]).toMatchObject({ finished: 3, created: 2, stale: 4, topTitles: ['Big card', 'New card'] })
    expect(inputs.objectives).toEqual([
      { dominionId: 'dom-1', dominionName: 'Swarm', title: 'Ship P2', status: 'active', lastTouched: '2026-10-01', targetDate: null },
    ])
    expect(inputs.beliefChanges.map((b) => [b.id, b.change])).toEqual([['belief-new', 'created'], ['belief-retired', 'retired']])
    expect(data.listBeliefs).toHaveBeenCalledWith(USER, expect.objectContaining({ status: 'all', updatedSince: reviewWindow(MONDAY).start }))
    expect(inputs.memoryOps).toEqual({ total: 3, counts: { promote: 1, decay: 2 }, promotions: [{ memoryId: 'promo-1', title: 'Promoted idea' }] })
    expect(inputs.mindCompare?.id).toBe('mc-1')
    expect(inputs.asks.map((a) => a.id)).toEqual(['ask-pending', 'ask-expired'])
    expect(inputs.asksAnswered).toBe(1)
    expect(inputs.health).toEqual([{ cronName: 'aether', failures: 2, reasons: ['parse_failed:schema', 'empty_response'] }])
    expect(fedMemoryIds(inputs).sort()).toEqual(
      ['ask-expired', 'ask-pending', 'belief-new', 'belief-retired', 'day-1', 'mc-1', 'promo-1', 'week-1'].sort(),
    )
  })

  it('takes the latest mind comparison from the canonical reader, ignoring one older than 14 days', async () => {
    const inputs = await gatherWeeklyReviewInputs(USER, MONDAY)
    expect(inputs.mindCompare).toEqual({ id: 'mc-1', title: 'Mind compare · 2026-W40', summary: '3 agree, 1 diverge', createdAt: IN_WEEK.toISOString() })
    expect(data.getLatestMindCompare).toHaveBeenCalledWith(USER)
    data.getLatestMindCompare.mockResolvedValue({ id: 'mc-0', title: 't', summary: null, createdAt: new Date('2026-09-20T00:00:00Z') })
    expect((await gatherWeeklyReviewInputs(USER, MONDAY)).mindCompare).toBeNull()
  })

  it('never fails on one source: failures are recorded and the rest still load', async () => {
    data.listMemories.mockRejectedValue(new Error('db down'))
    data.listBeliefs.mockRejectedValue(new Error('db down'))
    data.getLatestMindCompare.mockRejectedValue(new Error('db down'))
    data.listMemoryOps.mockRejectedValue(new Error('no table'))
    data.listDominionObjectives.mockRejectedValue(new Error('boom'))
    const inputs = await gatherWeeklyReviewInputs(USER, MONDAY)
    expect(inputs.boardPages).toEqual([])
    expect(inputs.beliefChanges).toEqual([])
    expect(inputs.mindCompare).toBeNull()
    expect(inputs.memoryOps).toBeNull()
    expect(inputs.objectives).toEqual([])
    expect(inputs.asks).toHaveLength(2)
    expect(inputs.health).toHaveLength(1)
    const names = inputs.errors.map((e) => e.split(':')[0])
    expect(names).toEqual(expect.arrayContaining(['board_pages', 'belief_changes', 'mind_compare', 'memory_ops', 'objectives']))
    expect(hasReviewSignal(inputs)).toBe(true)
  })

  it('survives every source failing and reports no signal', async () => {
    for (const fn of Object.values(data)) fn.mockRejectedValue(new Error('down'))
    const inputs = await gatherWeeklyReviewInputs(USER, MONDAY)
    expect(inputs.dominions).toEqual([])
    expect(hasReviewSignal(inputs)).toBe(false)
    expect(inputs.errors.length).toBeGreaterThanOrEqual(6)
  })
})
