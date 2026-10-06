import type { CardTree } from './types'

// Plain-text rendering of a card tree proposal (Telegram body, memory body).

export const cardTreeTitle = (tree: Pick<CardTree, 'projectName'>) =>
  `Card tree proposal: ${tree.projectName || 'your board'}`.slice(0, 255)

export function renderCardTreeBody(tree: CardTree): string {
  const nameOf = new Map(tree.cards.map((c) => [c.key, c.name]))
  const lines = [`Goal: ${tree.goal}`]
  if (tree.rationale) lines.push('', tree.rationale)
  lines.push('', `${tree.cards.length} ${tree.cards.length === 1 ? 'card' : 'cards'}:`)
  tree.cards.forEach((card, i) => {
    const after = card.dependsOn.map((k) => nameOf.get(k)).filter(Boolean)
    const extras = [
      card.priority !== 'medium' ? card.priority : '',
      card.labels.length > 0 ? card.labels.join(', ') : '',
      after.length > 0 ? `after ${after.join(', ')}` : '',
    ].filter(Boolean)
    lines.push(`${i + 1}. ${card.name}${extras.length > 0 ? ` (${extras.join(' · ')})` : ''}`)
  })
  lines.push('', 'Approve to create these cards on the board. Nothing is created until you do.')
  return lines.join('\n')
}
