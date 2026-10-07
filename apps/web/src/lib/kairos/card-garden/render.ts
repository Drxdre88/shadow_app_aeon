import type { CardGardenAction, CardGardenPick } from './types'

// Plain-text rendering of a card garden proposal (Telegram body, memory body).

const VERB: Record<CardGardenAction, string> = { finish: 'Finish', park: 'Park', merge: 'Merge', kill: 'Kill' }

export const cardGardenTitle = (pick: Pick<CardGardenPick, 'action' | 'taskName'>) =>
  `Card garden: ${VERB[pick.action]} "${pick.taskName || 'a card'}"`.slice(0, 255)

/** What Approve does for this pick, in one plain sentence. */
export function cardGardenEffect(pick: Pick<CardGardenPick, 'action' | 'parkColumn' | 'doneColumn' | 'mergeWith'>): string {
  switch (pick.action) {
    case 'finish':
      return pick.doneColumn ? `Approve to mark it done and move it to ${pick.doneColumn}.` : 'Approve to mark it done.'
    case 'park':
      return pick.parkColumn ? `Approve to move it to ${pick.parkColumn}.` : 'This board has no backlog column, so approving moves nothing.'
    case 'merge':
      return `Approve to note it; then fuse it with "${pick.mergeWith?.name ?? 'the other card'}" yourself on the board. Nothing is fused for you.`
    case 'kill':
      return 'Approve to archive it (you can restore it from the archive).'
  }
}

export function renderCardGardenBody(pick: CardGardenPick): string {
  const where = [pick.projectName || 'your board', pick.columnName].filter(Boolean).join(' · ')
  const lines = [`Card: ${pick.taskName}`, `Board: ${where}`, `Untouched for ${pick.ageDays} days`]
  if (pick.action === 'merge' && pick.mergeWith) lines.push(`Merge with: ${pick.mergeWith.name}`)
  if (pick.reason) lines.push('', pick.reason)
  lines.push('', cardGardenEffect(pick), 'Nothing changes until you do.')
  return lines.join('\n')
}
