/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

// "Move all cards to…" on the column menu: lists the OTHER columns of the same
// project, moves every card to the end of the chosen one in their existing
// order (optimistically, then via the bulk action), reverts on failure, and is
// inert when the column is empty.

vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

vi.mock('@/lib/actions/transfer', () => ({
  listProjectsForTransfer: vi.fn().mockResolvedValue([]),
  copyColumnToProject: vi.fn(),
  moveColumnToProject: vi.fn(),
}))

vi.mock('@/lib/actions/board', () => ({
  reorderBoardTasks: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/actions/boardBulk', () => ({
  moveAllTasksToColumnAction: vi.fn().mockResolvedValue([]),
}))

import { ColumnContextMenu } from '../ColumnContextMenu'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { moveAllTasksToColumnAction } from '@/lib/actions/boardBulk'
import { reorderBoardTasks } from '@/lib/actions/board'
import { toast } from '@/components/ui/Toast'

const PROJECT_ID = 'project-1'
const col = (id: string, name: string, orderIndex: number, projectId = PROJECT_ID): BoardColumn =>
  ({ id, projectId, name, color: '#8b5cf6', icon: null, orderIndex })
const COLUMNS = [col('col-a', 'Backlog', 0), col('col-b', 'Doing', 1), col('col-c', 'Done', 2), col('col-x', 'Elsewhere', 0, 'project-2')]

const task = (id: string, columnId: string, orderIndex: number): BoardTask => ({
  id,
  projectId: PROJECT_ID,
  name: id,
  columnId,
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex,
})

const placement = () =>
  Object.fromEntries(useBoardStore.getState().tasks.map((t) => [t.id, [t.columnId, t.orderIndex]]))

function renderMenu(columnId = 'col-a') {
  const onClose = vi.fn()
  render(
    <ColumnContextMenu
      columnId={columnId}
      position={{ x: 10, y: 10 }}
      onClose={onClose}
      onRename={() => {}}
    />,
  )
  return onClose
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(moveAllTasksToColumnAction).mockResolvedValue([])
  useBoardStore.setState({
    columns: COLUMNS,
    tasks: [task('a1', 'col-a', 0), task('a2', 'col-a', 1), task('a3', 'col-a', 2), task('b1', 'col-b', 5)],
    labels: [],
  })
})

afterEach(() => cleanup())

describe('ColumnContextMenu — move all cards', () => {
  it('shows the card count and lists only the other columns of this project', () => {
    renderMenu()

    fireEvent.click(screen.getByText('Move all 3 cards to...'))

    const submenu = screen.getByRole('menu', { name: 'Move all cards to' })
    const names = Array.from(submenu.querySelectorAll('button')).map((b) => b.textContent)
    expect(names).toEqual(['Doing', 'Done'])
  })

  it('is disabled when the column is empty', () => {
    useBoardStore.setState({ tasks: [task('b1', 'col-b', 5)] })
    renderMenu()

    const entry = screen.getByText('Move all cards to...').closest('button')!
    expect(entry.disabled).toBe(true)
    fireEvent.click(entry)
    expect(screen.queryByRole('menu', { name: 'Move all cards to' })).toBeNull()
  })

  it('moves every card to the end of the target in order, calls the action and closes', async () => {
    const onClose = renderMenu()

    fireEvent.click(screen.getByText('Move all 3 cards to...'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Doing' }))

    // Optimistic: all three land after b1 (index 5), in their old order.
    expect(placement()).toEqual({ a1: ['col-b', 6], a2: ['col-b', 7], a3: ['col-b', 8], b1: ['col-b', 5] })
    expect(onClose).toHaveBeenCalled()
    expect(moveAllTasksToColumnAction).toHaveBeenCalledWith(PROJECT_ID, 'col-a', 'col-b')

    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(vi.mocked(toast).mock.calls[0][0]).toBe('Moved 3 cards to Doing')
    expect(useBoardStore.getState().isDirty).toBe(false)
  })

  it('a rejected write puts every card back where it was', async () => {
    vi.mocked(moveAllTasksToColumnAction).mockRejectedValue(new Error('Viewers cannot modify this project'))
    renderMenu()

    fireEvent.click(screen.getByText('Move all 3 cards to...'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Done' }))
    expect(placement().a1).toEqual(['col-c', 0])

    await waitFor(() => expect(placement().a1).toEqual(['col-a', 0]))
    expect(placement()).toEqual({ a1: ['col-a', 0], a2: ['col-a', 1], a3: ['col-a', 2], b1: ['col-b', 5] })
    expect(vi.mocked(toast).mock.calls[0][0]).toContain('Viewers cannot modify')
  })

  it('Undo restores the original placement and persists it through the reorder action', async () => {
    renderMenu()

    fireEvent.click(screen.getByText('Move all 3 cards to...'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Doing' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())

    const onUndo = (vi.mocked(toast).mock.calls[0][1] as { onUndo: () => void }).onUndo
    await act(async () => { onUndo() })

    expect(placement()).toEqual({ a1: ['col-a', 0], a2: ['col-a', 1], a3: ['col-a', 2], b1: ['col-b', 5] })
    expect(reorderBoardTasks).toHaveBeenCalledWith(PROJECT_ID, [
      { id: 'a1', orderIndex: 0, columnId: 'col-a' },
      { id: 'a2', orderIndex: 1, columnId: 'col-a' },
      { id: 'a3', orderIndex: 2, columnId: 'col-a' },
    ])
  })
})
