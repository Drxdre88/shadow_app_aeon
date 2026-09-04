/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Multi-select on the card itself: Ctrl/Cmd-click toggles the card in the
// selection and Shift-click selects the run from the last-selected card in
// the column — neither opens the editor, a plain click still does. The menu's
// Select is the touch route into the same selection.

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

vi.mock('../useHoldToMove', () => ({
  useCardHoldGesture: () => ({ holdHandlers: {}, consumeHoldClick: () => false }),
  useHoldToMoveActions: () => null,
  halfFromPoint: () => 'top',
}))

vi.mock('../CardPeekPreview', () => ({ CardPeekPreview: () => null }))

vi.mock('../TaskContextMenu', () => ({
  TaskContextMenu: ({ taskId, onSelectTask, isSelected }: { taskId: string; onSelectTask?: (id: string | null) => void; isSelected?: boolean }) => (
    <button data-testid="menu-select" data-selected={isSelected ? '' : undefined} onClick={() => onSelectTask?.(isSelected ? null : taskId)}>select</button>
  ),
}))

import { SortableTaskCard } from '../SortableTaskCard'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'

const PROJECT_ID = 'project-1'
const COLUMN: BoardColumn = { id: 'col-a', projectId: PROJECT_ID, name: 'Backlog', color: '#8b5cf6', icon: null, orderIndex: 0 }

const task = (id: string, orderIndex: number): BoardTask => ({
  id, projectId: PROJECT_ID, name: id, columnId: 'col-a', status: 'todo', priority: 'medium', color: 'purple', labels: [], onTimeline: false, orderIndex,
})
const TASKS = [task('t1', 0), task('t2', 1), task('t3', 2), task('t4', 3)]

function stubPointer() {
  vi.stubGlobal('matchMedia', (queryString: string) => ({
    matches: false,
    media: queryString,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function renderCards(ids: string[]) {
  const onEdit = vi.fn()
  render(
    <>
      {TASKS.filter((t) => ids.includes(t.id)).map((t) => (
        <SortableTaskCard key={t.id} task={{ ...t, description: undefined }} onEdit={onEdit} columnGlowColor="#8b5cf6" animateOnMount={false} />
      ))}
    </>,
  )
  const surface = (id: string) => document.querySelector(`[data-task-id="${id}"] [data-card-surface]`) as HTMLElement
  return { onEdit, surface }
}

const selection = () => useBoardStore.getState().selectedTaskIds

beforeEach(() => {
  vi.clearAllMocks()
  stubPointer()
  useThemeStore.setState({ smoothUiRenders: false })
  useBoardStore.setState({ columns: [COLUMN], tasks: TASKS, labels: [], selectedTaskId: null, selectedTaskIds: [], movingTaskId: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SortableTaskCard — multi-select', () => {
  it('Ctrl-click toggles the card in the selection without opening it; Cmd-click too', () => {
    const { onEdit, surface } = renderCards(['t1', 't3'])
    fireEvent.click(surface('t1'), { ctrlKey: true })
    expect(selection()).toEqual(['t1'])
    fireEvent.click(surface('t3'), { metaKey: true })
    expect(selection()).toEqual(['t1', 't3'])
    fireEvent.click(surface('t1'), { ctrlKey: true })
    expect(selection()).toEqual(['t3'])
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('Shift-click selects the run from the last-selected card in the column, including cards not rendered by a filter', () => {
    const { onEdit, surface } = renderCards(['t1', 't4'])
    fireEvent.click(surface('t1'), { ctrlKey: true })
    fireEvent.click(surface('t4'), { shiftKey: true })
    expect(selection()).toEqual(['t1', 't2', 't3', 't4'])
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('a plain click still opens the card and leaves the selection alone', () => {
    useBoardStore.setState({ selectedTaskIds: ['t3'] })
    const { onEdit, surface } = renderCards(['t1'])
    fireEvent.click(surface('t1'))
    expect(onEdit).toHaveBeenCalledWith('t1')
    expect(selection()).toEqual(['t3'])
  })

  it('the menu\'s Select adds the card to the selection and Deselect removes it, alongside the keyboard selection', () => {
    const { surface } = renderCards(['t1'])
    fireEvent.contextMenu(surface('t1'), { clientX: 5, clientY: 5 })
    const menuSelect = screen.getByTestId('menu-select')
    expect(menuSelect.hasAttribute('data-selected')).toBe(false)

    fireEvent.click(menuSelect)
    expect(selection()).toEqual(['t1'])
    expect(useBoardStore.getState().selectedTaskId).toBe('t1')
    expect(screen.getByTestId('menu-select').hasAttribute('data-selected')).toBe(true)

    fireEvent.click(screen.getByTestId('menu-select'))
    expect(selection()).toEqual([])
    expect(useBoardStore.getState().selectedTaskId).toBeNull()
  })

  it('Deselect on one card never drops a keyboard selection pointing at another', () => {
    useBoardStore.setState({ selectedTaskIds: ['t1'], selectedTaskId: 't3' })
    const { surface } = renderCards(['t1'])
    fireEvent.contextMenu(surface('t1'), { clientX: 5, clientY: 5 })
    fireEvent.click(screen.getByTestId('menu-select'))
    expect(selection()).toEqual([])
    expect(useBoardStore.getState().selectedTaskId).toBe('t3')
  })

  it('a modified click on one card cancels a pending single-click open on another', () => {
    vi.useFakeTimers()
    try {
      useThemeStore.setState({ smoothUiRenders: true })
      const { onEdit, surface } = renderCards(['t1', 't3'])
      fireEvent.click(surface('t1'))
      fireEvent.click(surface('t3'), { ctrlKey: true })
      vi.advanceTimersByTime(400)
      expect(onEdit).not.toHaveBeenCalled()
      expect(selection()).toEqual(['t3'])
      // The cancelled card's next plain click is a fresh first click, not the second half of a double-click.
      fireEvent.click(surface('t1'))
      vi.advanceTimersByTime(400)
      expect(onEdit).toHaveBeenCalledWith('t1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a card selected only through multi-select still wears the selected ring', () => {
    useBoardStore.setState({ selectedTaskIds: ['t1'] })
    const { surface } = renderCards(['t1'])
    fireEvent.contextMenu(surface('t1'), { clientX: 5, clientY: 5 })
    expect(screen.getByTestId('menu-select').hasAttribute('data-selected')).toBe(true)
  })
})
