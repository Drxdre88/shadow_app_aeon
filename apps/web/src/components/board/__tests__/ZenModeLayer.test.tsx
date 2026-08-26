/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'

// Pins Column Zen mode: a column lifts out of the board into a centered
// focus surface, every exit path (backdrop, exit button, Escape) tears it
// down, and normal card interactions keep working inside.

// Server-action modules pulled in transitively by the card components —
// never exercised here, but they must not touch the DB layer at import time.
vi.mock('@/lib/actions/checklist', () => ({ getChecklistItems: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/actions/comments', () => ({
  getComments: vi.fn().mockResolvedValue([]),
  addComment: vi.fn(),
  editComment: vi.fn(),
  removeComment: vi.fn(),
}))
vi.mock('@/lib/actions/projects', () => ({ updateProjectSettings: vi.fn() }))
vi.mock('@/lib/actions/board', () => ({
  createBoardTask: vi.fn(),
  updateBoardTask: vi.fn(),
  deleteBoardTask: vi.fn(),
  reorderBoardTasks: vi.fn(),
}))
vi.mock('@/lib/actions/transfer', () => ({
  listProjectsForTransfer: vi.fn().mockResolvedValue([]),
  copyColumnToProject: vi.fn(),
  moveColumnToProject: vi.fn(),
}))

import { ZenModeLayer } from '../ZenModeLayer'
import { KanbanColumn } from '../KanbanColumn'
import { ColumnContextMenu } from '../ColumnContextMenu'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { useZenModeStore } from '@/lib/store/zenModeStore'
import { useThemeStore } from '@/stores/themeStore'

const PROJECT_ID = 'project-1'
const COLUMN: BoardColumn = { id: 'col-1', projectId: PROJECT_ID, name: 'Today', color: 'purple', icon: null, orderIndex: 0 }

const makeTask = (id: string, name: string, orderIndex: number): BoardTask => ({
  id,
  projectId: PROJECT_ID,
  name,
  columnId: COLUMN.id,
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex,
})

const TASKS = [makeTask('task-1', 'Alpha card', 0), makeTask('task-2', 'Beta card', 1)]

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ObserverStub)
  vi.stubGlobal('ResizeObserver', ObserverStub)
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }))
  }
  useBoardStore.setState({ tasks: [...TASKS], columns: [COLUMN], labels: [] })
  useZenModeStore.getState().clear()
  // Instant open/close path — the flight animation is exercised in a real
  // browser, not in jsdom.
  useThemeStore.setState({ smoothUiRenders: false })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useThemeStore.setState({ smoothUiRenders: true })
})

function ZenHarness(props: { escapeDisabled?: boolean; onTaskEdit?: (taskId: string) => void }) {
  const columnId = useZenModeStore((s) => s.columnId)
  if (columnId !== COLUMN.id) return null
  return (
    <ZenModeLayer
      column={COLUMN}
      projectId={PROJECT_ID}
      tasks={TASKS}
      escapeDisabled={props.escapeDisabled}
      onTaskEdit={props.onTaskEdit}
    />
  )
}

async function renderZenOpen(props: Parameters<typeof ZenHarness>[0] = {}) {
  act(() => useZenModeStore.getState().enter(COLUMN.id, null))
  const result = render(<ZenHarness {...props} />)
  await act(async () => {})
  return result
}

describe('Zen mode entry points', () => {
  it('the always-visible header button lifts the column into Zen', async () => {
    render(
      <DndContext>
        <KanbanColumn column={COLUMN} projectId={PROJECT_ID} tasks={[]} />
      </DndContext>
    )
    fireEvent.click(screen.getByTitle('Zen mode'))
    expect(useZenModeStore.getState().columnId).toBe(COLUMN.id)
  })

  it('the column context menu offers Zen Mode', () => {
    const onZenMode = vi.fn()
    const onClose = vi.fn()
    render(
      <ColumnContextMenu
        columnId={COLUMN.id}
        position={{ x: 10, y: 10 }}
        onClose={onClose}
        onRename={() => {}}
        onZenMode={onZenMode}
      />
    )
    fireEvent.click(screen.getByText('Zen Mode'))
    expect(onZenMode).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ZenModeLayer', () => {
  it('opens as a focus surface with the column name, count and cards', async () => {
    await renderZenOpen()
    expect(screen.getByRole('dialog', { name: 'Today — Zen mode' })).toBeTruthy()
    expect(screen.getByText('Alpha card')).toBeTruthy()
    expect(screen.getByText('Beta card')).toBeTruthy()
    expect(document.querySelector('[data-zen-backdrop]')).toBeTruthy()
    expect(screen.getByText('Add card')).toBeTruthy()
  })

  it('cards stay interactive — clicking one opens the editor flow', async () => {
    const onTaskEdit = vi.fn()
    await renderZenOpen({ onTaskEdit })
    fireEvent.click(screen.getByText('Alpha card'))
    expect(onTaskEdit).toHaveBeenCalledWith('task-1')
  })

  it('clicking the blurred backdrop exits', async () => {
    await renderZenOpen()
    fireEvent.click(document.querySelector('[data-zen-backdrop]')!)
    expect(useZenModeStore.getState().columnId).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Today — Zen mode' })).toBeNull()
  })

  it('the exit button exits', async () => {
    await renderZenOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Exit Zen mode' }))
    expect(useZenModeStore.getState().columnId).toBeNull()
  })

  it('Escape exits', async () => {
    await renderZenOpen()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useZenModeStore.getState().columnId).toBeNull()
  })

  it('Escape is suppressed while another overlay owns it', async () => {
    await renderZenOpen({ escapeDisabled: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useZenModeStore.getState().columnId).toBe(COLUMN.id)
  })

  it('renders with the flight animation enabled too', async () => {
    act(() => useThemeStore.setState({ smoothUiRenders: true }))
    await renderZenOpen()
    expect(screen.getByRole('dialog', { name: 'Today — Zen mode' })).toBeTruthy()
    // With no on-board rect to fly back to (and none stored), exit falls
    // back to an instant teardown instead of a flight into nowhere.
    fireEvent.click(screen.getByRole('button', { name: 'Exit Zen mode' }))
    expect(useZenModeStore.getState().columnId).toBeNull()
  })
})
