/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { fuseSources, nextSelection, pointerDownClearsSelection, selectModifiersFromEvent } from '../cardSelection'
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
    expect(fuseSources(task('t'), ['a', 't', 'ghost', 'far', 'b'], tasks).map((t) => t.id)).toEqual(['a', 'b'])
    expect(fuseSources(task('t'), [], tasks)).toEqual([])
    expect(fuseSources(task('t'), ['t'], tasks)).toEqual([])
  })
})

describe('pointerDownClearsSelection', () => {
  const el = (attrs: Record<string, string>, parent?: HTMLElement) => {
    const node = document.createElement('div')
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    ;(parent ?? document.body).appendChild(node)
    return node
  }
  const press = (target: EventTarget | null, extra: Partial<{ button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
    pointerDownClearsSelection({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target, ...extra })

  it('clears on a plain primary press on empty space, never on a modified or secondary press', () => {
    const space = el({ 'data-board-columns': '' })
    expect(press(space)).toBe(true)
    expect(press(space, { ctrlKey: true })).toBe(false)
    expect(press(space, { metaKey: true })).toBe(false)
    expect(press(space, { shiftKey: true })).toBe(false)
    expect(press(space, { button: 2 })).toBe(false)
  })

  it('keeps the selection when the press lands on a card, a board menu or a dialog (portals included)', () => {
    const card = el({ 'data-task-id': 'a' })
    const inCard = el({}, card)
    const menu = el({ 'data-board-menu': '' })
    const inMenu = el({}, menu)
    const dialog = el({ role: 'dialog' })
    const inDialog = el({}, dialog)
    expect(press(inCard)).toBe(false)
    expect(press(inMenu)).toBe(false)
    expect(press(inDialog)).toBe(false)
    expect(press(null)).toBe(true)
  })
})
