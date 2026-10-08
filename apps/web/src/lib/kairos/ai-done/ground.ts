import { boardText } from '@/lib/kairos/card-tree/prompt'
import { repoLabelNames, resolveRepo } from '@/lib/kairos/repo-memory/aliases'
import {
  AI_DONE_DESCRIPTION_MAX,
  AI_DONE_GROUP_MAX,
  AI_DONE_ITEM_MAX,
  AI_DONE_MAX_CARDS,
  AI_DONE_MAX_GROUPS,
  AI_DONE_MAX_ITEMS,
  AI_DONE_TITLE_MAX,
  normTitle,
  type AiDoneAnswer,
  type AiDoneBoardCards,
  type AiDoneCard,
  type AiDoneContext,
  type AiDoneContextBoard,
  type AiDoneContextSession,
  type AiDoneGroup,
} from './types'

// Grounding a model answer onto the boards: unknown boards and session
// handles are dropped, cards with no valid session, an "alreadyOn" mark, no
// checklist or a title already on the board (or earlier in the batch) are
// dropped, everything is clipped to the owner-style caps, and labels are only
// ever existing board labels (repo:<label>, dom:<Dominion>).

export interface AiDoneDropped {
  cards: number
  alreadyOn: number
  sessions: number
}

export interface GroundAiDoneResult {
  boards: AiDoneBoardCards[]
  dropped: AiDoneDropped
}

const DEFAULT_GROUP = 'Checklist'

function groupsOf(raw: Array<{ name: string; items: string[] } | null>): AiDoneGroup[] {
  const groups: AiDoneGroup[] = []
  for (const g of raw) {
    if (!g) continue
    const name = boardText(g.name, AI_DONE_GROUP_MAX) || DEFAULT_GROUP
    let group = groups.find((x) => normTitle(x.name) === normTitle(name))
    if (!group) {
      if (groups.length >= AI_DONE_MAX_GROUPS) continue
      group = { name, items: [] }
      groups.push(group)
    }
    for (const item of g.items) {
      const text = boardText(item, AI_DONE_ITEM_MAX)
      if (!text || group.items.length >= AI_DONE_MAX_ITEMS) continue
      if (!group.items.some((i) => normTitle(i) === normTitle(text))) group.items.push(text)
    }
  }
  return groups.filter((g) => g.items.length > 0)
}

const resolvedSlug = (raw: string | undefined) => (raw ? resolveRepo(raw)?.slug ?? null : null)

function repoFor(modelRepo: string | undefined, cited: AiDoneContextSession[]): AiDoneContextSession {
  const wanted = resolvedSlug(modelRepo)
  return cited.find((s) => s.repo === wanted) ?? cited[0]!
}

function labelIdsFor(session: AiDoneContextSession, board: AiDoneContextBoard): string[] {
  const resolved = resolveRepo(session.repo)
  const wanted = [...(resolved ? repoLabelNames(resolved) : []), ...(session.dominion ? [`dom:${session.dominion}`] : [])]
  const ids: string[] = []
  for (const name of wanted) {
    const label = board.labels.find((l) => normTitle(l.name) === normTitle(name))
    if (label && !ids.includes(label.id)) ids.push(label.id)
  }
  return ids
}

export function groundAiDone(answer: AiDoneAnswer, ctx: AiDoneContext): GroundAiDoneResult {
  const sessionByHandle = new Map(ctx.sessions.map((s) => [s.h.toUpperCase(), s]))
  const boardByHandle = new Map(ctx.boards.map((b) => [b.h.toUpperCase(), b]))
  const dropped: AiDoneDropped = { cards: 0, alreadyOn: 0, sessions: 0 }
  const out = new Map<string, AiDoneBoardCards>()

  for (const rawBoard of answer.boards) {
    if (!rawBoard) continue
    const board = boardByHandle.get(rawBoard.boardHandle.trim().toUpperCase())
    if (!board) {
      dropped.cards += rawBoard.cards.filter(Boolean).length
      continue
    }
    const allowed = new Set(board.sessions.map((h) => h.toUpperCase()))
    const entry = out.get(board.projectId) ?? { projectId: board.projectId, cards: [] }
    out.set(board.projectId, entry)
    const taken = new Set([...board.titles.map(normTitle), ...entry.cards.map((c) => normTitle(c.title))])

    for (const raw of rawBoard.cards) {
      if (!raw) continue
      if (raw.alreadyOn && raw.alreadyOn.trim()) {
        dropped.alreadyOn++
        continue
      }
      const cited: AiDoneContextSession[] = []
      for (const h of raw.sessions) {
        const key = h.trim().toUpperCase()
        const session = allowed.has(key) ? sessionByHandle.get(key) : undefined
        if (!session) dropped.sessions++
        else if (!cited.includes(session)) cited.push(session)
      }
      const title = boardText(raw.title, AI_DONE_TITLE_MAX)
      const groups = groupsOf(raw.groups)
      if (cited.length === 0 || !title || groups.length === 0 || taken.has(normTitle(title)) || entry.cards.length >= AI_DONE_MAX_CARDS) {
        dropped.cards++
        continue
      }
      const repo = repoFor(raw.repo, cited)
      taken.add(normTitle(title))
      const card: AiDoneCard = {
        title,
        description: boardText(raw.description ?? '', AI_DONE_DESCRIPTION_MAX),
        repo: repo.repo,
        labelIds: labelIdsFor(repo, board),
        groups,
        sessionIds: cited.map((s) => s.id),
      }
      entry.cards.push(card)
    }
  }
  return { boards: [...out.values()].filter((b) => b.cards.length > 0), dropped }
}
