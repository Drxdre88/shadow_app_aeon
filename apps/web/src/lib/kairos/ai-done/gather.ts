import { listAiDoneBoards, listAiDoneCitedSessionIds, findTaskIdsOnBoard } from '@/lib/data/ai-done'
import { listChecklistForTasks, listLabelNamesForTasks } from '@/lib/data/board-feed'
import { listTriagePool } from '@/lib/data/card-triage'
import { findDominionsByUser, listReposForUser } from '@/lib/data/dominions'
import { findLabels } from '@/lib/data/labels'
import { listRepoGitDigestsBetween, listSessionSummariesBetween, type RepoSessionRow } from '@/lib/data/repo-memory'
import { normalizeRepoSlug } from '@/lib/kairos/living/repo-slug'
import { resolveRepo } from '@/lib/kairos/repo-memory/aliases'
import type { RepoGitDigest } from '@/lib/kairos/repo-memory/git-digest'
import { londonDateHour, londonDayStart } from '@/lib/kairos/thinking/deadlines'
import type { AiDoneJobBoard, AiDoneJobBoardCard, AiDoneJobInput, AiDoneJobSession } from './prompt'
import { AI_DONE_MAX_BOARD_CARDS, AI_DONE_MAX_BOARDS, AI_DONE_MAX_SESSIONS } from './types'

// The afternoon's inputs: today's (London) session summaries from every repo
// the owner worked in (core repos only add their Dominion name for dom:
// labels), and per switched-on board the sessions not yet on it — not
// anchored to one of its cards and not cited by an earlier AI DONE card —
// plus the board's open and recently done cards for dedup.

const DONE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
const DIGEST_LOOKBACK_MS = 24 * 60 * 60 * 1000
const MAX_DIGESTS = 10
const POOL_LIMIT = 300

/** A repo name in any spelling → its folder slug, or null for junk. */
export function coreSlug(raw: string | null | undefined): string | null {
  const slug = normalizeRepoSlug(raw)
  return slug ? resolveRepo(slug)?.slug ?? null : null
}

/** Core repo slug → the name of its Dominion (first mapping wins). */
export function coreRepoIndex(
  repos: ReadonlyArray<{ dominionId: string; repoSlug: string }>,
  dominions: ReadonlyArray<{ id: string; name: string }>,
): Map<string, string | null> {
  const names = new Map(dominions.map((d) => [d.id, d.name]))
  const out = new Map<string, string | null>()
  for (const r of repos) {
    const slug = coreSlug(r.repoSlug)
    if (slug && !out.has(slug)) out.set(slug, names.get(r.dominionId) ?? null)
  }
  return out
}

/** Sessions not yet on a board: not anchored to one of its cards, not cited by an AI DONE card. */
export function sessionsForBoard<T extends Pick<RepoSessionRow, 'id' | 'taskId'>>(
  sessions: readonly T[],
  cardsOnBoard: ReadonlySet<string>,
  cited: ReadonlySet<string>,
): T[] {
  return sessions.filter((s) => !cited.has(s.id) && !(s.taskId && cardsOnBoard.has(s.taskId)))
}

interface CoreSession { row: RepoSessionRow; slug: string; dominion: string | null }

async function boardCards(projectId: string, now: Date): Promise<{ titles: string[]; cards: AiDoneJobBoardCard[] }> {
  const pool = await listTriagePool(projectId, new Date(now.getTime() - DONE_LOOKBACK_MS), POOL_LIMIT)
  const shown = pool.slice(0, AI_DONE_MAX_BOARD_CARDS)
  const ids = shown.map((c) => c.id)
  const [checklist, labelRows] = await Promise.all([listChecklistForTasks(ids), listLabelNamesForTasks(ids)])
  const cards = shown.map((c, i) => ({
    h: `E${i + 1}`,
    title: c.name,
    done: c.status === 'done',
    labels: labelRows.filter((l) => l.taskId === c.id).map((l) => l.name),
    checklist: checklist.filter((item) => item.taskId === c.id).map((item) => item.title),
  }))
  return { titles: pool.map((c) => c.name), cards }
}

export async function gatherAiDone(userId: string, now: Date): Promise<AiDoneJobInput | null> {
  const boards = await listAiDoneBoards(userId, AI_DONE_MAX_BOARDS)
  if (boards.length === 0) return null
  const dayStart = londonDayStart(now)
  const [rows, repos, dominions] = await Promise.all([
    listSessionSummariesBetween(userId, dayStart, now),
    listReposForUser(userId),
    findDominionsByUser(userId),
  ])
  const core = coreRepoIndex(repos, dominions)
  const sessions: CoreSession[] = rows.flatMap((row) => {
    const slug = coreSlug(row.repo) ?? normalizeRepoSlug(row.repo)
    return slug ? [{ row, slug, dominion: core.get(slug) ?? null }] : []
  }).slice(0, AI_DONE_MAX_SESSIONS).reverse()
  if (sessions.length === 0) return null

  const perBoard: Array<{ board: { id: string; name: string }; ids: Set<string> }> = []
  for (const board of boards) {
    const taskIds = [...new Set(sessions.flatMap((s) => (s.row.taskId ? [s.row.taskId] : [])))]
    const [onBoard, cited] = await Promise.all([findTaskIdsOnBoard(board.id, taskIds), listAiDoneCitedSessionIds(board.id)])
    const eligible = sessionsForBoard(sessions.map((s) => s.row), onBoard, cited)
    if (eligible.length > 0) perBoard.push({ board, ids: new Set(eligible.map((s) => s.id)) })
  }
  if (perBoard.length === 0) return null

  const used = sessions.filter((s) => perBoard.some((b) => b.ids.has(s.row.id)))
  const handle = new Map(used.map((s, i) => [s.row.id, `S${i + 1}`]))
  const jobSessions: AiDoneJobSession[] = used.map((s) => ({
    h: handle.get(s.row.id)!,
    id: s.row.id,
    repo: s.slug,
    dominion: s.dominion,
    title: s.row.title,
    summary: s.row.summary,
    body: s.row.body,
    client: s.row.client,
    createdAt: s.row.createdAt,
    facts: s.row.facts ?? null,
  }))

  const jobBoards: AiDoneJobBoard[] = []
  for (const [i, { board, ids }] of perBoard.entries()) {
    const [{ titles, cards }, boardLabels] = await Promise.all([boardCards(board.id, now), findLabels(board.id, 200)])
    jobBoards.push({
      h: `B${i + 1}`,
      projectId: board.id,
      name: board.name,
      labels: boardLabels.map((l) => ({ id: l.id, name: l.name })),
      titles,
      cards,
      sessions: used.filter((s) => ids.has(s.row.id)).map((s) => handle.get(s.row.id)!),
    })
  }

  const slugs = new Set(used.map((s) => s.slug))
  const digests: RepoGitDigest[] = (await listRepoGitDigestsBetween(userId, new Date(dayStart.getTime() - DIGEST_LOOKBACK_MS), now))
    .filter((d) => slugs.has(coreSlug(d.slug) ?? normalizeRepoSlug(d.slug) ?? ''))
    .slice(0, MAX_DIGESTS)

  return { day: londonDateHour(now).date, boards: jobBoards, sessions: jobSessions, digests }
}
