import { boardText } from '@/lib/kairos/card-tree/prompt'
import {
  CARD_GARDEN_ACTIONS,
  CARD_GARDEN_MAX_PROPOSALS,
  CARD_GARDEN_REASON_MAX,
  type CardGardenAction,
  type CardGardenAnswer,
  type CardGardenContext,
  type CardGardenPick,
} from './types'

// Grounding a model answer onto the week's candidates: a card id the context
// never listed, an unknown action, a "park" on a board with no backlog
// column, a merge without a valid same-board partner, and any card already
// used (as subject or merge partner) are dropped; the rest is capped at
// CARD_GARDEN_MAX_PROPOSALS.

export type GroundCardGardenResult =
  | { ok: true; picks: CardGardenPick[]; dropped: number }
  | { ok: false; reason: 'no_proposals' }

function actionOf(raw: string): CardGardenAction | null {
  const a = raw.trim().toLowerCase()
  return (CARD_GARDEN_ACTIONS as readonly string[]).includes(a) ? (a as CardGardenAction) : null
}

export function groundCardGarden(answer: CardGardenAnswer, ctx: CardGardenContext): GroundCardGardenResult {
  const cardById = new Map(ctx.cards.map((c) => [c.taskId, c]))
  const boardById = new Map(ctx.boards.map((b) => [b.projectId, b]))
  const used = new Set<string>()
  const picks: CardGardenPick[] = []
  let dropped = 0

  for (const raw of answer.proposals) {
    const card = cardById.get(raw.taskId)
    const board = card ? boardById.get(card.projectId) : undefined
    const action = actionOf(raw.action)
    if (!card || !board || !action || used.has(card.taskId) || picks.length >= CARD_GARDEN_MAX_PROPOSALS) {
      dropped++
      continue
    }
    if (action === 'park' && !board.parkColumn) {
      dropped++
      continue
    }
    let mergeWith: CardGardenPick['mergeWith'] = null
    if (action === 'merge') {
      const partner = raw.mergeWithTaskId ? cardById.get(raw.mergeWithTaskId) : undefined
      if (!partner || partner.taskId === card.taskId || partner.projectId !== card.projectId || used.has(partner.taskId)) {
        dropped++
        continue
      }
      mergeWith = { taskId: partner.taskId, name: partner.name }
      used.add(partner.taskId)
    }
    used.add(card.taskId)
    picks.push({
      isoWeek: ctx.isoWeek,
      taskId: card.taskId,
      taskName: card.name,
      projectId: card.projectId,
      projectName: board.projectName,
      columnName: card.columnName,
      ageDays: card.ageDays,
      action,
      reason: boardText(raw.reason, CARD_GARDEN_REASON_MAX),
      mergeWith,
      parkColumn: board.parkColumn,
      doneColumn: board.doneColumn,
    })
  }
  if (picks.length === 0) return { ok: false, reason: 'no_proposals' }
  return { ok: true, picks, dropped }
}
