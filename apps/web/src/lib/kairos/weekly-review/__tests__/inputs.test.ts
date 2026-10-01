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
  listBeliefDiffOps: vi.fn(),
  listSurvivorsSince: vi.fn(),
  listIdeaOutcomes: vi.fn(),
  weeklyIdeaDiversity: vi.fn(),
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
vi.mock('@/lib/data/belief-diff', () => ({ BELIEF_DIFF_ROW_CAP: 500, listBeliefDiffOps: data.listBeliefDiffOps }))
vi.mock('@/lib/data/ideas', () => ({ listSurvivorsSince: data.listSurvivorsSince, listIdeaOutcomes: data.listIdeaOutcomes }))
vi.mock('@/lib/kairos/ideas/diversity', () => ({ weeklyIdeaDiversity: data.weeklyIdeaDiversity }))

import { buildBeliefDiff, classifyBeliefOp, fedMemoryIds, gatherWeeklyReviewInputs, hasReviewSignal, reviewWindow } from '../inputs'

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
  data.listBeliefDiffOps.mockResolvedValue([])
  data.listSurvivorsSince.mockResolvedValue([])
  data.listIdeaOutcomes.mockResolvedValue([])
  data.weeklyIdeaDiversity.mockResolvedValue({ survivors: 0, meanDistance: null, alarm: false, weekStart: '2026-09-28' })
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

describe('ideas and lessons (G11)', () => {
  const survivor = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: `Idea ${id}`, claim: `Claim ${id}`, survivedBecause: 'won 3 of 3', elo: 1060, direction: 'ops',
    tournamentDate: '2026-09-30', status: 'pending', createdAt: IN_WEEK, ...over,
  })

  it('lists the week\'s survivors with outcomes, the diversity reading and 30-day lessons', async () => {
    data.listSurvivorsSince.mockResolvedValue([
      survivor('idea-a'),
      survivor('idea-b', { status: 'promoted' }),
      survivor('idea-c', { status: 'dismissed' }),
      survivor('idea-late', { createdAt: new Date('2026-10-05T03:00:00Z') }),
    ])
    data.listIdeaOutcomes.mockResolvedValue([
      { id: 'idea-a', title: 'Idea idea-a', direction: 'ops', claim: 'Claim idea-a', outcome: 'accepted' },
      { id: 'idea-old', title: 'Old', direction: 'health', claim: 'Old claim', outcome: 'dismissed' },
    ])
    data.weeklyIdeaDiversity.mockResolvedValue({ survivors: 3, meanDistance: 0.11, alarm: true, weekStart: '2026-09-28' })

    const inputs = await gatherWeeklyReviewInputs(USER, MONDAY)
    const w = reviewWindow(MONDAY)
    expect(data.listSurvivorsSince).toHaveBeenCalledWith(USER, w.start, 21)
    expect(data.listIdeaOutcomes).toHaveBeenCalledWith(USER, 30)
    expect(data.weeklyIdeaDiversity).toHaveBeenCalledWith(USER, new Date(w.end.getTime() - 1))
    expect(inputs.ideas?.survivors.map((s) => [s.id, s.outcome])).toEqual([
      ['idea-a', 'accepted'], ['idea-b', 'accepted'], ['idea-c', 'dismissed'],
    ])
    expect(inputs.ideas?.diversity).toEqual({ survivors: 3, meanDistance: 0.11, alarm: true })
    expect(inputs.ideaLessons).toMatchObject({ days: 30, acceptedCount: 1, dismissedCount: 1 })
    expect(fedMemoryIds(inputs)).toEqual(expect.arrayContaining(['idea-a', 'idea-b', 'idea-c', 'idea-old']))
    expect(inputs.errors).toEqual([])
  })

  it('keeps going when the idea reads fail', async () => {
    data.listSurvivorsSince.mockRejectedValue(new Error('down'))
    data.listIdeaOutcomes.mockRejectedValue(new Error('down'))
    const inputs = await gatherWeeklyReviewInputs(USER, MONDAY)
    expect(inputs.ideas).toBeNull()
    expect(inputs.ideaLessons).toBeNull()
    expect(inputs.errors.map((e) => e.split(':')[0])).toEqual(expect.arrayContaining(['ideas', 'idea_outcomes']))
    expect(inputs.boardPages).toHaveLength(2)
  })
})

describe('belief diff (G13)', () => {
  const op = (over: Record<string, unknown>) => ({
    opId: 'op', memoryId: 'b-1', step: 'beliefs', op: 'promote', reason: 'r', after: {}, createdAt: IN_WEEK,
    domain: 'health', mind: 'aligned', claim: 'Sleep matters', ...over,
  })

  it('classifies every ledger op kind', () => {
    expect(classifyBeliefOp(op({}))).toBe('created')
    expect(classifyBeliefOp(op({ after: { supersedes: 'b-0' } }))).toBe('replaced')
    expect(classifyBeliefOp(op({ op: 'feedback' }))).toBe('reinforced')
    expect(classifyBeliefOp(op({ op: 'feedback', after: { reaffirmed: true } }))).toBe('cleared')
    expect(classifyBeliefOp(op({ op: 'retire' }))).toBe('retired')
    expect(classifyBeliefOp(op({ op: 'decay' }))).toBe('retired')
    expect(classifyBeliefOp(op({ step: 'recheck', op: 'recheck' }))).toBe('flagged')
    expect(classifyBeliefOp(op({ step: 'recheck', op: 'retire' }))).toBe('retired')
    expect(classifyBeliefOp(op({ step: 'recheck', op: 'feedback', after: { normalised: true } }))).toBe('normalised')
    expect(classifyBeliefOp(op({ step: 'recheck', op: 'feedback', after: { remapped: [] } }))).toBe('remapped')
    expect(classifyBeliefOp(op({ op: 'score' }))).toBeNull()
  })

  it('counts everything, shows the 15 most significant grouped by domain', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => op({ memoryId: `n-${i}`, step: 'recheck', op: 'feedback', after: { normalised: true }, domain: 'work' })),
      op({ memoryId: 'rep', after: { supersedes: 'old' }, domain: 'work', reason: 'new evidence; replaces old' }),
      op({ memoryId: 'flag', step: 'recheck', op: 'recheck', domain: null }),
    ]
    const diff = buildBeliefDiff(rows, false)!
    expect(diff.total).toBe(22)
    expect(diff.counts).toEqual({ normalised: 20, replaced: 1, flagged: 1 })
    expect(diff.changes).toHaveLength(15)
    expect(diff.changes.map((c) => c.domain)).toEqual(['general', ...Array(14).fill('work')])
    expect(diff.changes[1]).toMatchObject({ memoryId: 'rep', kind: 'replaced', reason: 'new evidence; replaces old' })
    expect(buildBeliefDiff([op({ op: 'score' })], false)).toBeNull()
  })

  it('reads the window, feeds shown belief ids as evidence and counts as signal', async () => {
    for (const fn of Object.values(data)) fn.mockResolvedValue([])
    data.findDominionsByUser.mockResolvedValue([])
    data.getLatestMindCompare.mockResolvedValue(null)
    data.weeklyIdeaDiversity.mockResolvedValue({ survivors: 0, meanDistance: null, alarm: false, weekStart: '' })
    data.listBeliefDiffOps.mockResolvedValue([op({ memoryId: 'b-9', op: 'retire' })])
    const inputs = await gatherWeeklyReviewInputs(USER, MONDAY)
    const w = reviewWindow(MONDAY)
    expect(data.listBeliefDiffOps).toHaveBeenCalledWith(USER, w.start, w.end)
    expect(inputs.beliefDiff?.changes[0]).toMatchObject({ memoryId: 'b-9', kind: 'retired', domain: 'health' })
    expect(fedMemoryIds(inputs)).toContain('b-9')
    expect(hasReviewSignal(inputs)).toBe(true)
  })
})