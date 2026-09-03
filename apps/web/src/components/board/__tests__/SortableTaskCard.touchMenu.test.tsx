/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// The touch route into the card's context menu. A finger never hovers and
// never fires contextmenu, so the card carries an always-visible ⋯ button on
// coarse pointers; pressing it opens the same menu the right click opens and
// must never reach the drag sensors underneath.

const sortableListeners = {
  onPointerDown: vi.fn(),
  onTouchStart: vi.fn(),
  onMouseDown: vi.fn(),
}

const holdHandlers = {
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  onPointerCancel: vi.fn(),
  onPointerLeave: vi.fn(),
}

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: sortableListeners,
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

vi.mock('../useHoldToMove', () => ({
  useCardHoldGesture: () => ({ holdHandlers, consumeHoldClick: () => false }),
  useHoldToMoveActions: () => null,
  halfFromPoint: () => 'top',
}))

vi.mock('../CardPeekPreview', () => ({ CardPeekPreview: () => null }))

vi.mock('../TaskContextMenu', () => ({
  TaskContextMenu: ({ taskId, position }: { taskId: string; position: { x: number; y: number } }) => (
    <div data-testid="task-menu" data-task={taskId} data-x={position.x} data-y={position.y} />
  ),
}))

import { SortableTaskCard } from '../SortableTaskCard'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'

const PROJECT_ID = 'project-1'
const COLUMN: BoardColumn = { id: 'col-a', projectId: PROJECT_ID, name: 'Backlog', color: '#8b5cf6', icon: null, orderIndex: 0 }

const TASK: BoardTask = {
  id: 'task-1',
  projectId: PROJECT_ID,
  name: 'Ship the touch menu',
  columnId: 'col-a',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
}

function stubPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (queryString: string) => ({
    matches: queryString.includes('pointer: coarse') ? coarse : false,
    media: queryString,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function renderCard() {
  const onEdit = vi.fn()
  render(
    <SortableTaskCard
      task={{ ...TASK, description: undefined }}
      onEdit={onEdit}
      columnGlowColor="#8b5cf6"
      animateOnMount={false}
    />,
  )
  const button = document.querySelector('[data-task-menu]') as HTMLButtonElement
  button.getBoundingClientRect = () => ({ x: 120, y: 200, left: 120, top: 200, right: 144, bottom: 224, width: 24, height: 24, toJSON: () => ({}) })
  return { onEdit, button }
}

beforeEach(() => {
  vi.clearAllMocks()
  stubPointer(true)
  useBoardStore.setState({ columns: [COLUMN], tasks: [TASK], labels: [], selectedTaskId: null, movingTaskId: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SortableTaskCard — touch menu button', () => {
  it('opens the task context menu anchored under the button', () => {
    const { button } = renderCard()
    expect(screen.queryByTestId('task-menu')).toBeNull()

    fireEvent.click(button)

    const menu = screen.getByTestId('task-menu')
    expect(menu.getAttribute('data-task')).toBe('task-1')
    expect(menu.getAttribute('data-x')).toBe('120')
    expect(menu.getAttribute('data-y')).toBe('228')

    fireEvent.click(button)
    expect(screen.queryByTestId('task-menu')).toBeNull()
  })

  it('never reaches the drag sensors or the hold gesture underneath', () => {
    const { button, onEdit } = renderCard()

    fireEvent.pointerDown(button)
    fireEvent.touchStart(button, { touches: [{ clientX: 120, clientY: 200 }] })
    fireEvent.mouseDown(button)
    fireEvent.click(button)

    expect(sortableListeners.onPointerDown).not.toHaveBeenCalled()
    expect(sortableListeners.onTouchStart).not.toHaveBeenCalled()
    expect(sortableListeners.onMouseDown).not.toHaveBeenCalled()
    expect(holdHandlers.onPointerDown).not.toHaveBeenCalled()
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-menu')).toBeTruthy()
  })

  it('is always visible on a coarse pointer and hides the hover-only controls', () => {
    const { button } = renderCard()
    expect(button.className).toContain('opacity-100')
    expect(button.className).not.toContain('group-hover:opacity-100')
    expect((document.querySelector('[data-task-edit]') as HTMLElement).parentElement?.className).toContain('hidden')
  })

  it('stays hover-revealed on a fine pointer', () => {
    stubPointer(false)
    const { button } = renderCard()
    expect(button.className).toContain('opacity-0')
    expect(button.className).toContain('group-hover:opacity-100')

    fireEvent.click(button)
    expect(screen.getByTestId('task-menu')).toBeTruthy()
  })
})
