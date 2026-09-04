import { describe, it, expect } from 'vitest'
import { fuseSources, nextSelection, selectModifiersFromEvent } from '../cardSelection'
import type { BoardTask } from '@/lib/store/boardStore'

// Multi-select rules behind Ctrl/Cmd-click, Shift-click and the "Fuse N
// cards into this one" menu item.

const column = ['a', 'b', 'c', 'd', 'e']

const task = (id: string, projectId = 'p1'): BoardTask => ({
  id, projectId, name: id, columnId: 'col', status: 'todo', priority: 'medium', color: 'purple', labels: [], onTimeline: false, orderIndex: 0,
})

describe('selectModifiersFromEvent', () => {
  it('reads Ctrl or Cmd as toggle, Shift as range, nothing as null', () => {
    expect(selectModifiersFromEvent({ ctrlKey: true, metaKey: false, shiftKey: false })).toEqual({ toggle: true, range: false })
    expect(selectModifiersFromEvent({ ctrlKey: false, metaKey: true, shiftKey: false })).toEqual({ toggle: true, range: false })
    expect(selectModifiersFromEvent({ ctrlKey: false, metaKey: false, shiftKey: true })).toEqual({ toggle: false, range: true })
    expect(selectModifiersFromEvent({ ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull()
  })
})

describe('nextSelection', () => {
  const toggle = { toggle: true, range: false }
  const range = { toggle: false, range: true }

  it('Ctrl-click adds an unselected card and removes a selected one, keeping order', () => {
    expect(nextSelection([], 'b', toggle, column)).toEqual(['b'])
    expect(nextSelection(['b'], 'd', toggle, column)).toEqual(['b', 'd'])
    expect(nextSelection(['b', 'd'], 'b', toggle, column)).toEqual(['d'])
  })

  it('Shift-click selects the run from the last-selected card in the column, in either direction', () => {
    expect(nextSelection(['b'], 'd', range, column)).toEqual(['b', 'c', 'd'])
    expect(nextSelection(['d'], 'b', range, column)).toEqual(['d', 'b', 'c'])
  })

  it('Shift-click anchors on the most recent selection from THIS column and never drops the rest', () => {
    const other = ['x', 'y']
    expect(nextSelection(['x', 'b'], 'd', range, column)).toEqual(['x', 'b', 'c', 'd'])
    expect(nextSelection(['b', 'x'], 'y', range, other)).toEqual(['b', 'x', 'y'])
  })

  it('Shift-click with no anchor in the column is a plain add, and never duplicates', () => {
    expect(nextSelection([], 'c', range, column)).toEqual(['c'])
    expect(nextSelection(['x'], 'c', range, column)).toEqual(['x', 'c'])
    expect(nextSelection(['c'], 'c', range, column)).toEqual(['c'])
  })

  it('never mutates the current selection', () => {
    const current = ['b']
    nextSelection(current, 'd', range, column)
    nextSelection(current, 'b', toggle, column)
    expect(current).toEqual(['b'])
  })
})

describe('fuseSources', () => {
  const tasks = [task('t'), task('a'), task('b'), task('far', 'p2')]

  it('returns the selected cards that are on the board and in the same project, minus the target', () => {
    expect(fuseSources(task('t'), ['a', 't', 'ghost', 'far', 'b'], null, tasks).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('counts the keyboard single selection too, once', () => {
    expect(fuseSources(task('t'), ['a'], 'b', tasks).map((t) => t.id)).toEqual(['a', 'b'])
    expect(fuseSources(task('t'), ['a'], 'a', tasks).map((t) => t.id)).toEqual(['a'])
    expect(fuseSources(task('t'), [], 't', tasks)).toEqual([])
  })
})
