/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Hold-to-move placement from a column: only a tap on the column's OWN
// surface appends the lifted card. A tap on a card belongs to the card
// (before/after), and the column's controls keep their own meaning.

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
vi.mock('../ColumnContextMenu', () => ({ ColumnContextMenu: () => null }))
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

function renderColumn(movingTaskId: string | null) {
  useBoardStore.setState({ movingTaskId })
  const onAddTask = vi.fn()
  render(<KanbanColumn column={COLUMN} projectId="p1" tasks={[card('a'), card('b')]} onAddTask={onAddTask} />)
  return { onAddTask, surface: document.querySelector('[data-column-id="col-doing"]') as HTMLElement }
}

beforeEach(() => {
  place.mockClear()
})

afterEach(() => {
  cleanup()
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
