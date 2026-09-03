/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Hold-to-move placement from a column: only a tap on the column's OWN
// surface appends the lifted card. A tap on a card belongs to the card
// (before/after), and the column's controls keep their own meaning.
//
// Plus the touch route into the column menu: a header ⋯ button, always visible
// on a coarse pointer, opening the same menu the right click opens.

const place = vi.fn()

vi.mock('../VirtualizedTaskList', () => ({
  VirtualizedTaskList: ({ tasks }: { tasks: { id: string; name: string }[] }) => (
    <div>
      {tasks.map((t) => (
        <div key={t.id} data-task-id={t.id}>{t.name}</div>
      ))}
    </div>
  ),
}))
vi.mock('../ColumnContextMenu', () => ({
  ColumnContextMenu: ({ columnId, position }: { columnId: string; position: { x: number; y: number } }) => (
    <div data-testid="column-menu" data-column={columnId} data-x={position.x} data-y={position.y} />
  ),
}))
vi.mock('../ColumnDeleteModal', () => ({ ColumnDeleteModal: () => null }))
vi.mock('../useHoldToMove', () => ({
  useHoldToMoveActions: () => ({ place, cancel: vi.fn() }),
}))

import { KanbanColumn } from '../KanbanColumn'
import { useBoardStore } from '@/lib/store/boardStore'

const COLUMN = { id: 'col-doing', projectId: 'p1', name: 'Doing', color: 'purple', icon: null, orderIndex: 0 }

const card = (id: string) => ({
  id,
  name: `card ${id}`,
  status: 'todo',
  color: 'purple',
  priority: 'medium' as const,
  labels: [],
  onTimeline: false,
})

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

function renderColumn(movingTaskId: string | null, dragHandleProps?: Record<string, unknown>) {
  useBoardStore.setState({ movingTaskId })
  const onAddTask = vi.fn()
  render(<KanbanColumn column={COLUMN} projectId="p1" tasks={[card('a'), card('b')]} onAddTask={onAddTask} dragHandleProps={dragHandleProps} />)
  const menuButton = document.querySelector('[data-column-menu]') as HTMLButtonElement
  menuButton.getBoundingClientRect = () => ({ x: 300, y: 60, left: 300, top: 60, right: 328, bottom: 88, width: 28, height: 28, toJSON: () => ({}) })
  return { onAddTask, menuButton, surface: document.querySelector('[data-column-id="col-doing"]') as HTMLElement }
}

beforeEach(() => {
  place.mockClear()
  stubPointer(true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useBoardStore.setState({ movingTaskId: null })
})

describe('KanbanColumn — hold-to-move placement', () => {
  it('a tap on the column surface appends the lifted card', () => {
    const { surface } = renderColumn('a')
    fireEvent.click(surface)
    expect(place).toHaveBeenCalledTimes(1)
    expect(place).toHaveBeenCalledWith({ columnId: 'col-doing', kind: 'end' })
  })

  it('a tap on a card is the card\'s to handle, not the column\'s', () => {
    renderColumn('a')
    fireEvent.click(screen.getByText('card b'))
    expect(place).not.toHaveBeenCalled()
  })

  it('the add-card button keeps its own meaning', () => {
    const { onAddTask } = renderColumn('a')
    fireEvent.click(screen.getByTitle('Add card'))
    expect(place).not.toHaveBeenCalled()
    expect(onAddTask).toHaveBeenCalledTimes(1)
  })

  it('does nothing while no card is lifted', () => {
    const { surface } = renderColumn(null)
    fireEvent.click(surface)
    expect(place).not.toHaveBeenCalled()
  })
})

describe('KanbanColumn — touch menu button', () => {
  it('opens the column menu anchored under the button', () => {
    const { menuButton } = renderColumn(null)
    expect(screen.queryByTestId('column-menu')).toBeNull()

    fireEvent.click(menuButton)

    const menu = screen.getByTestId('column-menu')
    expect(menu.getAttribute('data-column')).toBe('col-doing')
    expect(menu.getAttribute('data-x')).toBe('300')
    expect(menu.getAttribute('data-y')).toBe('92')

    fireEvent.click(menuButton)
    expect(screen.queryByTestId('column-menu')).toBeNull()
  })

  it('never reaches the header drag handle underneath', () => {
    const onPointerDown = vi.fn()
    const onTouchStart = vi.fn()
    const { menuButton } = renderColumn(null, { onPointerDown, onTouchStart })

    fireEvent.pointerDown(menuButton)
    fireEvent.touchStart(menuButton, { touches: [{ clientX: 300, clientY: 60 }] })
    fireEvent.click(menuButton)

    expect(onPointerDown).not.toHaveBeenCalled()
    expect(onTouchStart).not.toHaveBeenCalled()
    expect(screen.getByTestId('column-menu')).toBeTruthy()
  })

  it('is always visible on a coarse pointer and hover-revealed on a fine one', () => {
    const { menuButton } = renderColumn(null)
    expect(menuButton.className).toContain('opacity-100')
    expect(menuButton.className).not.toContain('group-hover:opacity-100')

    cleanup()
    stubPointer(false)
    const fine = renderColumn(null)
    expect(fine.menuButton.className).toContain('opacity-0')
    expect(fine.menuButton.className).toContain('group-hover:opacity-100')
  })
})
