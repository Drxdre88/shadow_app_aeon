import type { DominionActivity, ScoredBoard, ScoredRepo, UnattributedActivity } from './types'
import { Attribution, type BoardInfo, type MemberLink, type RepoMapping } from './attribution'
import { normalizeRepoSlug } from './repo-slug'
import {
  MAX_CARD_EVENTS_PER_BOARD_DAY,
  MAX_SESSIONS_PER_REPO_DAY,
  NOTE_WEIGHT,
  SESSION_WEIGHT,
  WINDOW_DAYS,
  cardEventWeight,
  decay,
  inWindow,
  utcDay,
  type CardEventSignal,
} from './signals'

// Pure nightly activity scorer (living_dominions.md §2 A/B). No DB: the data
// layer reads raw signals, this turns them into per-board, per-repo and
// per-Dominion scores, last-active dates and the active/dormant focus state.

export type FocusState = 'active' | 'dormant'

export type DominionInfo = { id: string; createdAt: Date; lastActiveAt: Date | null; pinned: boolean }
export type SessionSignal = { repo: string | null; at: Date }
export type NoteSignal = { dominionId: string | null; at: Date }

export type ActivityInputs = {
  now: Date
  dormantDays: number
  windowDays?: number
  dominions: readonly DominionInfo[]
  boards: readonly BoardInfo[]
  members: readonly MemberLink[]
  repoMappings: readonly RepoMapping[]
  cardEvents: readonly CardEventSignal[]
  sessions: readonly SessionSignal[]
  notes: readonly NoteSignal[]
}

export type DominionScore = {
  dominionId: string
  score: number
  lastActiveAt: Date | null
  focusState: FocusState
  activity: DominionActivity
}

export type ActivityResult = {
  scoredAt: Date
  dominions: DominionScore[]
  unattributed: UnattributedActivity
  memberSignals: Array<{ memberId: string; at: Date }>
}

const LIST_LIMIT = 10
const UNATTRIBUTED_LIMIT = 20
const DAY_MS = 86_400_000

type Weighted = { at: Date; weight: number }
type KeptCard = CardEventSignal & { weight: number }
type KeptSession = { slug: string; at: Date }

class Tally {
  score = 0
  lastAt: Date | null = null
  boards = new Map<string, number>()
  repos = new Map<string, number>()
  sessions = 0
  cardsFinished = 0
  notes = 0

  touch(at: Date): void {
    if (!this.lastAt || at > this.lastAt) this.lastAt = at
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Keeps at most `cap` signals per group, the heaviest (then newest) first, so
// a one-off burst cannot dominate the score and completions survive the cap.
export function capPerGroup<T extends Weighted>(items: readonly T[], key: (t: T) => string, cap: number): T[] {
  const groups = new Map<string, T[]>()
  for (const t of items) groups.set(key(t), [...(groups.get(key(t)) ?? []), t])
  return [...groups.values()].flatMap((g) =>
    [...g].sort((a, b) => b.weight - a.weight || b.at.getTime() - a.at.getTime()).slice(0, cap))
}

export function focusStateFor(
  d: Pick<DominionInfo, 'pinned' | 'createdAt'>,
  lastActiveAt: Date | null,
  now: Date,
  dormantDays: number,
): FocusState {
  if (d.pinned) return 'active'
  const since = lastActiveAt ?? d.createdAt
  return now.getTime() - since.getTime() > dormantDays * DAY_MS ? 'dormant' : 'active'
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return b > a ? b : a
}

function topList<T extends { score: number }>(items: T[], limit: number): T[] {
  return items.filter((i) => i.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
}

export function scoreActivity(input: ActivityInputs): ActivityResult {
  const { now, dormantDays } = input
  const windowDays = input.windowDays ?? WINDOW_DAYS
  const live = new Set(input.dominions.map((d) => d.id))
  const boards = new Map(input.boards.map((b) => [b.id, b]))
  const attribution = new Attribution(live, boards, input.members, input.repoMappings)
  const tallies = new Map(input.dominions.map((d) => [d.id, new Tally()]))
  const within = (at: Date) => inWindow(at, now, windowDays)

  const cards: KeptCard[] = input.cardEvents
    .filter((e) => within(e.at))
    .map((e) => ({ ...e, weight: cardEventWeight(e) }))
    .filter((e) => e.weight > 0)
  const keptCards = capPerGroup(cards, (e) => `${e.boardId}|${utcDay(e.at)}`, MAX_CARD_EVENTS_PER_BOARD_DAY)

  const sessions = input.sessions.flatMap((s): Array<KeptSession & Weighted> => {
    const slug = normalizeRepoSlug(s.repo)
    return slug && within(s.at) ? [{ slug, at: s.at, weight: SESSION_WEIGHT }] : []
  })
  const keptSessions = capPerGroup(sessions, (s) => `${s.slug}|${utcDay(s.at)}`, MAX_SESSIONS_PER_REPO_DAY)

  const boardScores = new Map<string, number>()
  const boardLast = new Map<string, Date>()
  for (const e of keptCards) {
    boardScores.set(e.boardId, (boardScores.get(e.boardId) ?? 0) + e.weight * decay(e.at, now))
  }
  for (const e of cards) boardLast.set(e.boardId, latest(boardLast.get(e.boardId) ?? null, e.at)!)

  const repoScores = new Map<string, number>()
  const repoLast = new Map<string, Date>()
  for (const s of keptSessions) repoScores.set(s.slug, (repoScores.get(s.slug) ?? 0) + s.weight * decay(s.at, now))
  for (const s of sessions) repoLast.set(s.slug, latest(repoLast.get(s.slug) ?? null, s.at)!)

  const unattributedBoards: ScoredBoard[] = []
  for (const [boardId, score] of boardScores) {
    const shares = attribution.boardShares(boardId)
    if (shares.length === 0) {
      unattributedBoards.push({ id: boardId, name: boards.get(boardId)?.name ?? boardId, score: round2(score) })
      continue
    }
    const finished = keptCards.filter((e) => e.boardId === boardId && e.action === 'completed').length
    for (const { dominionId, share } of shares) {
      const t = tallies.get(dominionId)!
      t.score += score * share
      t.boards.set(boardId, (t.boards.get(boardId) ?? 0) + score * share)
      t.cardsFinished += finished
    }
  }
  for (const [boardId, at] of boardLast) {
    for (const { dominionId } of attribution.boardShares(boardId)) tallies.get(dominionId)!.touch(at)
  }

  const unattributedRepos: ScoredRepo[] = []
  for (const [slug, score] of repoScores) {
    const shares = attribution.repoShares(slug)
    if (shares.length === 0) {
      unattributedRepos.push({ slug, score: round2(score) })
      continue
    }
    const count = keptSessions.filter((s) => s.slug === slug).length
    for (const { dominionId, share } of shares) {
      const t = tallies.get(dominionId)!
      t.score += score * share
      t.repos.set(slug, (t.repos.get(slug) ?? 0) + score * share)
      t.sessions += count
    }
  }
  for (const [slug, at] of repoLast) {
    for (const { dominionId } of attribution.repoShares(slug)) tallies.get(dominionId)!.touch(at)
  }

  for (const n of input.notes) {
    const t = n.dominionId ? tallies.get(n.dominionId) : undefined
    if (!t || !within(n.at)) continue
    t.score += NOTE_WEIGHT * decay(n.at, now)
    t.notes += 1
    t.touch(n.at)
  }

  const memberSignals: ActivityResult['memberSignals'] = []
  for (const [boardId, at] of boardLast) {
    for (const m of attribution.membersFor('board', boardId)) memberSignals.push({ memberId: m.id, at })
  }
  for (const [slug, at] of repoLast) {
    for (const m of attribution.membersFor('repo', slug)) memberSignals.push({ memberId: m.id, at })
  }

  const scoredAt = now.toISOString()
  const dominionScores = input.dominions.map((d): DominionScore => {
    const t = tallies.get(d.id)!
    const lastActiveAt = latest(d.lastActiveAt, t.lastAt)
    return {
      dominionId: d.id,
      score: round2(t.score),
      lastActiveAt,
      focusState: focusStateFor(d, lastActiveAt, now, dormantDays),
      activity: {
        windowDays,
        scoredAt,
        boards: topList([...t.boards].map(([id, s]) => ({ id, name: boards.get(id)?.name ?? id, score: round2(s) })), LIST_LIMIT),
        repos: topList([...t.repos].map(([slug, s]) => ({ slug, score: round2(s) })), LIST_LIMIT),
        sessions: t.sessions,
        cardsFinished: t.cardsFinished,
        notes: t.notes,
      },
    }
  })

  return {
    scoredAt: now,
    dominions: dominionScores,
    unattributed: {
      scoredAt,
      boards: topList(unattributedBoards, UNATTRIBUTED_LIMIT),
      repos: topList(unattributedRepos, UNATTRIBUTED_LIMIT),
    },
    memberSignals,
  }
}
