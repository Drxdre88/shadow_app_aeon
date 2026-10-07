import { pickDoneColumn, pickParkColumn, type CardGardenAction } from './types'

// What an approved card garden action does to the card, decided in code from
// the card and its board as they are at approval time. Pure: the data layer
// runs the returned write inside the claim's transaction. A merge never writes.

export type CardGardenNote =
  | 'finished' | 'moved' | 'archived' | 'merge_suggested'
  | 'no_backlog_column' | 'already_done' | 'already_there' | 'card_gone'

export type CardGardenWrite =
  | { kind: 'none' }
  | { kind: 'archive' }
  | { kind: 'move'; columnId: string }
  | { kind: 'finish'; columnId: string | null }

export interface CardGardenStep {
  note: CardGardenNote
  write: CardGardenWrite
  toColumnId: string | null
}

export interface CardGardenTaskState {
  status: string | null
  columnId: string | null
}

export function planCardGardenStep(
  action: CardGardenAction,
  task: CardGardenTaskState | null,
  columns: ReadonlyArray<{ id: string; name: string }>,
): CardGardenStep {
  const none = (note: CardGardenNote, toColumnId: string | null = null): CardGardenStep => ({ note, write: { kind: 'none' }, toColumnId })
  if (!task) return none('card_gone')
  switch (action) {
    case 'merge':
      return none('merge_suggested')
    case 'kill':
      return { note: 'archived', write: { kind: 'archive' }, toColumnId: null }
    case 'park': {
      const park = pickParkColumn(columns)
      if (!park) return none('no_backlog_column')
      if (park.id === task.columnId) return none('already_there', park.id)
      return { note: 'moved', write: { kind: 'move', columnId: park.id }, toColumnId: park.id }
    }
    case 'finish': {
      if (task.status === 'done') return none('already_done')
      const columnId = pickDoneColumn(columns)?.id ?? task.columnId
      return { note: 'finished', write: { kind: 'finish', columnId }, toColumnId: columnId }
    }
  }
}
