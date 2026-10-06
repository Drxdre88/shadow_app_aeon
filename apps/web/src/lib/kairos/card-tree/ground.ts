import { boardText } from './prompt'
import {
  CARD_CHECK_ITEM_MAX,
  CARD_CHECKLIST_MAX,
  CARD_DESCRIPTION_MAX,
  CARD_NAME_MAX,
  CARD_PRIORITIES,
  CARD_TREE_MAX_CARDS,
  CARD_TREE_RATIONALE_MAX,
  type CardTree,
  type CardTreeAnswer,
  type CardTreeCard,
  type CardTreeContext,
  type CardTreePriority,
} from './types'

// Grounding a model answer onto the board: unknown labels and dependency keys
// are dropped, repeats of open cards are dropped, the tree is capped at
// CARD_TREE_MAX_CARDS, and a tree whose dependencies loop is refused whole.

const KEY_MAX = 20

export type GroundCardTreeResult =
  | { ok: true; tree: CardTree; dropped: { cards: number; labels: number; dependsOn: number } }
  | { ok: false; reason: 'no_cards' | 'cycle' }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

function priorityOf(raw: string): CardTreePriority {
  const p = raw.trim().toLowerCase()
  return (CARD_PRIORITIES as readonly string[]).includes(p) ? (p as CardTreePriority) : 'medium'
}

function checklistOf(items: string[]): string[] {
  const out: string[] = []
  for (const item of items) {
    const text = boardText(item, CARD_CHECK_ITEM_MAX)
    if (!text || out.some((o) => norm(o) === norm(text))) continue
    out.push(text)
    if (out.length >= CARD_CHECKLIST_MAX) break
  }
  return out
}

/** True when the cards' dependsOn edges contain a loop (Kahn's topological sort). */
export function hasDependencyCycle(cards: Pick<CardTreeCard, 'key' | 'dependsOn'>[]): boolean {
  const indegree = new Map(cards.map((c) => [c.key, 0]))
  const next = new Map<string, string[]>()
  for (const card of cards) {
    for (const dep of card.dependsOn) {
      if (!indegree.has(dep)) continue
      indegree.set(card.key, (indegree.get(card.key) ?? 0) + 1)
      next.set(dep, [...(next.get(dep) ?? []), card.key])
    }
  }
  const ready = [...indegree].filter(([, n]) => n === 0).map(([k]) => k)
  let seen = 0
  while (ready.length > 0) {
    const key = ready.pop()!
    seen++
    for (const after of next.get(key) ?? []) {
      const left = (indegree.get(after) ?? 0) - 1
      indegree.set(after, left)
      if (left === 0) ready.push(after)
    }
  }
  return seen < cards.length
}

export function groundCardTree(answer: CardTreeAnswer, ctx: CardTreeContext): GroundCardTreeResult {
  const labelByNorm = new Map(ctx.labels.map((l) => [norm(l), l]))
  const taken = new Set(ctx.openCards.map(norm))
  const keys = new Set<string>()
  const cards: CardTreeCard[] = []
  let droppedCards = 0
  let droppedLabels = 0

  for (const raw of answer.cards) {
    const key = boardText(raw.key, KEY_MAX)
    const name = boardText(raw.name, CARD_NAME_MAX)
    if (!key || !name || keys.has(key) || taken.has(norm(name)) || cards.length >= CARD_TREE_MAX_CARDS) {
      droppedCards++
      continue
    }
    const labels: string[] = []
    for (const l of raw.labels) {
      const known = labelByNorm.get(norm(l))
      if (!known) droppedLabels++
      else if (!labels.includes(known)) labels.push(known)
    }
    keys.add(key)
    taken.add(norm(name))
    cards.push({
      key,
      name,
      description: boardText(raw.description, CARD_DESCRIPTION_MAX),
      priority: priorityOf(raw.priority),
      labels,
      checklist: checklistOf(raw.checklist),
      dependsOn: raw.dependsOn.map((d) => boardText(d, KEY_MAX)),
    })
  }
  if (cards.length === 0) return { ok: false, reason: 'no_cards' }

  let droppedDeps = 0
  for (const card of cards) {
    const kept = [...new Set(card.dependsOn.filter((d) => d !== card.key && keys.has(d)))]
    droppedDeps += card.dependsOn.length - kept.length
    card.dependsOn = kept
  }
  if (hasDependencyCycle(cards)) return { ok: false, reason: 'cycle' }

  return {
    ok: true,
    tree: {
      projectId: ctx.projectId,
      projectName: ctx.projectName,
      goal: ctx.goal,
      rationale: boardText(answer.rationale, CARD_TREE_RATIONALE_MAX),
      cards,
    },
    dropped: { cards: droppedCards, labels: droppedLabels, dependsOn: droppedDeps },
  }
}
