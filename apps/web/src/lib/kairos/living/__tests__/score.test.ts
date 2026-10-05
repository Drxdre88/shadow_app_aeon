import { describe, expect, it } from 'vitest'
import { capPerGroup, focusStateFor, scoreActivity, type ActivityInputs } from '../score'
import { CARD_WEIGHTS, cardEventWeight, classifyMemory, decay, type CardEventSignal } from '../signals'
import { normalizeRepoSlug } from '../repo-slug'

const NOW = new Date('2026-10-05T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

const A = 'dom-a'
const B = 'dom-b'

function inputs(over: Partial<ActivityInputs> = {}): ActivityInputs {
  return {
    now: NOW,
    dormantDays: 21,
    dominions: [
      { id: A, createdAt: daysAgo(200), lastActiveAt: null, pinned: false },
      { id: B, createdAt: daysAgo(200), lastActiveAt: null, pinned: false },
    ],
    boards: [
      { id: 'b1', name: 'Board One', dominionId: A },
      { id: 'b2', name: 'Board Two', dominionId: null },
    ],
    members: [],
    repoMappings: [],
    cardEvents: [],
    sessions: [],
    notes: [],
    ...over,
  }
}

const card = (over: Partial<CardEventSignal> = {}): CardEventSignal => ({
  boardId: 'b1', entityType: 'task', action: 'completed', actorType: 'user', at: NOW, ...over,
})

const dom = (r: ReturnType<typeof scoreActivity>, id: string) => r.dominions.find((d) => d.dominionId === id)!

describe('signal weights', () => {
  it('weights card events by kind and actor', () => {
    expect(cardEventWeight(card())).toBe(3)
    expect(cardEventWeight(card({ actorType: 'agent' }))).toBe(3)
    expect(cardEventWeight(card({ action: 'created' }))).toBe(1)
    expect(cardEventWeight(card({ action: 'created', actorType: 'agent' }))).toBe(0.3)
    expect(cardEventWeight(card({ action: 'moved', actorType: 'agent' }))).toBe(0.2)
    expect(cardEventWeight(card({ action: 'updated' }))).toBe(0.1)
    expect(cardEventWeight(card({ entityType: 'label', action: 'label_added' }))).toBe(0.1)
    expect(cardEventWeight(card({ entityType: 'comment', action: 'commented', actorType: 'agent' }))).toBe(0)
    expect(cardEventWeight(card({ entityType: 'comment', action: 'commented' }))).toBe(0.1)
    expect(cardEventWeight(card({ entityType: 'project', action: 'updated' }))).toBe(0)
    expect(cardEventWeight(card({ entityType: 'column', action: 'created' }))).toBe(0)
  })

  it('decays as exp(-ageDays/10) and never above 1 for future stamps', () => {
    expect(decay(NOW, NOW)).toBe(1)
    expect(decay(daysAgo(10), NOW)).toBeCloseTo(Math.exp(-1), 10)
    expect(decay(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(1)
  })
})

describe('classifyMemory', () => {
  const row = { type: 'note', source: 'manual', originKind: null, metaKind: null, repo: null, dominionId: A, createdAt: NOW }
  it('reads session summaries as sessions with their repo', () => {
    expect(classifyMemory({ ...row, type: 'session_summary', source: 'copilot', repo: 'x' })).toEqual({ kind: 'session', repo: 'x', at: NOW })
  })
  it('keeps hand-written operator notes only', () => {
    expect(classifyMemory(row)).toEqual({ kind: 'note', dominionId: A, at: NOW })
    expect(classifyMemory({ ...row, source: 'voice' })?.kind).toBe('note')
    expect(classifyMemory({ ...row, source: 'cron', originKind: 'operator' })).toBeNull()
    expect(classifyMemory({ ...row, source: 'system' })).toBeNull()
    expect(classifyMemory({ ...row, source: 'claude' })).toBeNull()
    expect(classifyMemory({ ...row, originKind: 'agent' })).toBeNull()
    expect(classifyMemory({ ...row, metaKind: 'board_day' })).toBeNull()
    expect(classifyMemory({ ...row, type: 'snapshot' })).toBeNull()
  })
})

describe('normalizeRepoSlug', () => {
  it('lowercases and strips owner/org prefixes', () => {
    expect(normalizeRepoSlug('Shadow_App_Aeon')).toBe('shadow_app_aeon')
    expect(normalizeRepoSlug('sefe/Short Term Power/stp_app_ermac')).toBe('stp_app_ermac')
    expect(normalizeRepoSlug('C:\\dev_26\\shadow_app_swarm\\')).toBe('shadow_app_swarm')
    expect(normalizeRepoSlug('Drxdre88/shadow_app_aeon.git')).toBe('shadow_app_aeon')
  })
  it('drops junk', () => {
    for (const junk of [null, undefined, '', '  ', 42, 'dev_26', '.aeon-worktrees', 'sol-high-2', 'luna-high-1', 'inferno-smoke-0929', 'run-1234', 'my-worktree']) {
      expect(normalizeRepoSlug(junk)).toBeNull()
    }
  })
})

describe('capPerGroup', () => {
  it('keeps the heaviest, then newest, per group', () => {
    const items = [
      { g: 'x', weight: 0.2, at: hoursAgo(1) },
      { g: 'x', weight: 3, at: hoursAgo(5) },
      { g: 'x', weight: 0.2, at: hoursAgo(2) },
      { g: 'y', weight: 1, at: hoursAgo(1) },
    ]
    const kept = capPerGroup(items, (i) => i.g, 2)
    expect(kept).toEqual([items[1], items[0], items[3]])
  })
})

describe('scoreActivity', () => {
  it('scores a board with decay and credits its fallback Dominion', () => {
    const r = scoreActivity(inputs({ cardEvents: [card({ at: daysAgo(10) }), card({ action: 'moved', at: NOW })] }))
    const a = dom(r, A)
    expect(a.score).toBeCloseTo(3 * Math.exp(-1) + 0.2, 2)
    expect(a.activity.boards).toEqual([{ id: 'b1', name: 'Board One', score: a.score }])
    expect(a.activity.cardsFinished).toBe(1)
    expect(a.lastActiveAt).toEqual(NOW)
    expect(dom(r, B).score).toBe(0)
  })

  it('ignores signals outside the 30-day window', () => {
    const r = scoreActivity(inputs({
      cardEvents: [card({ at: daysAgo(31) })],
      sessions: [{ repo: 'shadow_app_aeon', at: daysAgo(40) }],
      notes: [{ dominionId: A, at: daysAgo(35) }],
      repoMappings: [{ dominionId: A, repoSlug: 'shadow_app_aeon' }],
    }))
    expect(dom(r, A).score).toBe(0)
    expect(dom(r, A).lastActiveAt).toBeNull()
  })

  it('caps card events at 50 per board per day, keeping completions', () => {
    const moves = Array.from({ length: 80 }, (_, i) => card({ action: 'moved', at: new Date(NOW.getTime() - i * 1000) }))
    const r = scoreActivity(inputs({ cardEvents: [...moves, card({ at: hoursAgo(1) })] }))
    const expected = 3 * decay(hoursAgo(1), NOW) + moves.slice(0, 49).reduce((s, m) => s + 0.2 * decay(m.at, NOW), 0)
    expect(dom(r, A).score).toBeCloseTo(expected, 2)
    expect(dom(r, A).activity.cardsFinished).toBe(1)
  })

  it('caps sessions at 10 per repo per day and counts the next day separately', () => {
    const day1 = Array.from({ length: 15 }, () => ({ repo: 'shadow_app_aeon', at: NOW }))
    const day2 = Array.from({ length: 3 }, () => ({ repo: 'Shadow_App_Aeon', at: daysAgo(1) }))
    const r = scoreActivity(inputs({ sessions: [...day1, ...day2], repoMappings: [{ dominionId: B, repoSlug: 'shadow_app_aeon' }] }))
    expect(dom(r, B).score).toBeCloseTo(10 * 2 + 3 * 2 * Math.exp(-0.1), 2)
    expect(dom(r, B).activity.sessions).toBe(13)
    expect(dom(r, B).activity.repos[0].slug).toBe('shadow_app_aeon')
  })

  it('splits a board across active members by weight, overriding projects.dominion_id', () => {
    const r = scoreActivity(inputs({
      members: [
        { id: 'm1', kind: 'board', ref: 'b1', dominionId: A, weight: 1 },
        { id: 'm2', kind: 'board', ref: 'b1', dominionId: B, weight: 3 },
      ],
      cardEvents: [card({ action: 'created' })],
    }))
    expect(dom(r, A).score).toBeCloseTo(0.25, 5)
    expect(dom(r, B).score).toBeCloseTo(0.75, 5)
    expect(r.memberSignals).toEqual([{ memberId: 'm1', at: NOW }, { memberId: 'm2', at: NOW }])
  })

  it('splits a repo evenly across dominion_repos rows and prefers members when present', () => {
    const mappings = [{ dominionId: A, repoSlug: 'x_repo' }, { dominionId: B, repoSlug: 'x_repo' }]
    const even = scoreActivity(inputs({ sessions: [{ repo: 'x_repo', at: NOW }], repoMappings: mappings }))
    expect(dom(even, A).score).toBe(1)
    expect(dom(even, B).score).toBe(1)
    const member = scoreActivity(inputs({
      sessions: [{ repo: 'org/X_Repo', at: NOW }],
      repoMappings: mappings,
      members: [{ id: 'm', kind: 'repo', ref: 'X_REPO', dominionId: B, weight: 2 }],
    }))
    expect(dom(member, A).score).toBe(0)
    expect(dom(member, B).score).toBe(2)
  })

  it('ignores members of archived (non-live) Dominions and zero-weight members', () => {
    const r = scoreActivity(inputs({
      members: [
        { id: 'gone', kind: 'board', ref: 'b1', dominionId: 'archived', weight: 1 },
        { id: 'zero', kind: 'board', ref: 'b1', dominionId: B, weight: 0 },
      ],
      cardEvents: [card()],
    }))
    expect(dom(r, A).score).toBe(3)
    expect(r.memberSignals).toEqual([])
  })

  it('reports unattributed boards and repos', () => {
    const r = scoreActivity(inputs({
      boards: [{ id: 'b2', name: 'Loose', dominionId: null }, { id: 'b3', name: 'Theirs', dominionId: 'someone-elses' }],
      cardEvents: [card({ boardId: 'b2' }), card({ boardId: 'b3', action: 'moved' })],
      sessions: [{ repo: 'stp_app_ermac', at: NOW }, { repo: 'dev_26', at: NOW }],
    }))
    expect(r.unattributed.boards).toEqual([{ id: 'b2', name: 'Loose', score: 3 }, { id: 'b3', name: 'Theirs', score: 0.2 }])
    expect(r.unattributed.repos).toEqual([{ slug: 'stp_app_ermac', score: 2 }])
    expect(r.unattributed.scoredAt).toBe(NOW.toISOString())
    expect(dom(r, A).score + dom(r, B).score).toBe(0)
  })

  it('adds hand-written notes to their Dominion only', () => {
    const r = scoreActivity(inputs({ notes: [{ dominionId: B, at: NOW }, { dominionId: null, at: NOW }, { dominionId: 'other', at: NOW }] }))
    expect(dom(r, B).score).toBe(0.5)
    expect(dom(r, B).activity.notes).toBe(1)
    expect(dom(r, B).lastActiveAt).toEqual(NOW)
  })

  it('never moves lastActiveAt backwards', () => {
    const stored = hoursAgo(1)
    const r = scoreActivity(inputs({
      dominions: [{ id: A, createdAt: daysAgo(200), lastActiveAt: stored, pinned: false }],
      cardEvents: [card({ at: daysAgo(3) })],
    }))
    expect(dom(r, A).lastActiveAt).toEqual(stored)
  })

  it('goes dormant after dormantDays of quiet, unless pinned', () => {
    const quiet = { id: A, createdAt: daysAgo(200), lastActiveAt: daysAgo(22), pinned: false }
    const r = scoreActivity(inputs({ dominions: [quiet, { ...quiet, id: B, pinned: true }] }))
    expect(dom(r, A).focusState).toBe('dormant')
    expect(dom(r, B).focusState).toBe('active')
  })

  it('uses createdAt when never active, and wakes on new activity', () => {
    const fresh = { id: A, createdAt: daysAgo(5), lastActiveAt: null, pinned: false }
    const old = { id: B, createdAt: daysAgo(60), lastActiveAt: daysAgo(40), pinned: false }
    const r = scoreActivity(inputs({
      dominions: [fresh, old],
      repoMappings: [{ dominionId: B, repoSlug: 'r' }],
      sessions: [{ repo: 'r', at: daysAgo(2) }],
    }))
    expect(dom(r, A).focusState).toBe('active')
    expect(dom(r, B).focusState).toBe('active')
    expect(dom(r, B).lastActiveAt).toEqual(daysAgo(2))
  })
})

describe('focusStateFor', () => {
  it('treats exactly dormantDays as still active', () => {
    expect(focusStateFor({ pinned: false, createdAt: daysAgo(100) }, daysAgo(21), NOW, 21)).toBe('active')
    expect(focusStateFor({ pinned: false, createdAt: daysAgo(100) }, daysAgo(21.01), NOW, 21)).toBe('dormant')
  })
})

describe('weights table', () => {
  it('matches the approved design', () => {
    expect(CARD_WEIGHTS).toEqual({ completed: 3, createdByOwner: 1, createdByAgent: 0.3, moved: 0.2, other: 0.1 })
  })
})
