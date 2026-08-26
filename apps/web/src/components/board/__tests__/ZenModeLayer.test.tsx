/** @vitest-environment jsdom */
import { type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'

// dnd-kit's pointer sensors need real layout, which jsdom has none of. Rather
// than fake a drag, we intercept the DndContext the layer renders and invoke
// its onDragEnd with the drop dnd-kit would have reported — the reorder MATH
// (and the durable write it produces) is what matters here.
const dnd = vi.hoisted(() => ({ onDragEnd: null as ((e: DragEndEvent) => void) | null }))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      if (props.onDragEnd) dnd.onDragEnd = props.onDragEnd
      return createElement(actual.DndContext, props)
    },
  }
})

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
import { useZenModeStore, type ZenRect } from '@/lib/store/zenModeStore'
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

/** Five cards in the column — the store's FULL truth for the reorder tests. */
const FIVE = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((n, i) => makeTask(`task-${i + 1}`, `${n} card`, i))

const ORIGINAL_CLEAR = useZenModeStore.getState().clear

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
  useZenModeStore.setState({ clear: ORIGINAL_CLEAR })
  dnd.onDragEnd = null
  document.querySelectorAll('[data-column-id]').forEach((el) => el.remove())
})

function ZenHarness(props: {
  escapeDisabled?: boolean
  onTaskEdit?: (taskId: string) => void
  onTaskMove?: ComponentProps<typeof ZenModeLayer>['onTaskMove']
  tasks?: BoardTask[]
}) {
  const columnId = useZenModeStore((s) => s.columnId)
  if (columnId !== COLUMN.id) return null
  return (
    <ZenModeLayer
      column={COLUMN}
      projectId={PROJECT_ID}
      tasks={props.tasks ?? TASKS}
      escapeDisabled={props.escapeDisabled}
      onTaskEdit={props.onTaskEdit}
      onTaskMove={props.onTaskMove}
    />
  )
}

async function renderZenOpen(props: Parameters<typeof ZenHarness>[0] = {}, sourceRect: ZenRect | null = null) {
  act(() => useZenModeStore.getState().enter(COLUMN.id, sourceRect))
  const result = render(<ZenHarness {...props} />)
  await act(async () => {})
  return result
}

/** A column sitting on the board behind Zen, with a measurable rect. */
function mountBoardColumn(rect: Partial<DOMRect> = { left: 40, top: 90, width: 320, height: 620 }) {
  const el = document.createElement('div')
  el.setAttribute('data-column-id', COLUMN.id)
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}), ...rect }) as DOMRect
  document.body.appendChild(el)
  return el
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

// The only DURABLE thing Zen mode writes. A wrong orderIndex here is not a
// visual glitch — it is a persisted column scramble that survives reload.
describe('ZenModeLayer reorder', () => {
  const FILTERED = [FIVE[0], FIVE[2], FIVE[4]] // as if a label filter hid Beta + Delta

  async function openFiltered(onTaskMove = vi.fn()) {
    act(() => useBoardStore.setState({ tasks: FIVE.map((t) => ({ ...t })), columns: [COLUMN], labels: [] }))
    await renderZenOpen({ tasks: FILTERED, onTaskMove })
    expect(dnd.onDragEnd).toBeTypeOf('function')
    return onTaskMove
  }

  const orderedStoreIds = () =>
    useBoardStore
      .getState()
      .tasks.filter((t) => t.columnId === COLUMN.id)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((t) => t.id)

  it('computes the move against the FULL column, so filtered-out cards keep their place', async () => {
    const onTaskMove = await openFiltered()

    // Only three cards are on screen; the user drags the first onto the last.
    act(() => dnd.onDragEnd!({ active: { id: 'task-1' }, over: { id: 'task-5' } } as DragEndEvent))

    expect(onTaskMove).toHaveBeenCalledTimes(1)
    const [updates, snapshot] = onTaskMove.mock.calls[0]

    // Every card in the column is re-indexed — including task-2 and task-4,
    // which the filter hid. Had the move been computed from the three visible
    // cards it would have emitted three rows over indices 0..2 and buried the
    // hidden pair under duplicate indices.
    expect(updates.map((u: { id: string }) => u.id).sort()).toEqual(['task-1', 'task-2', 'task-3', 'task-4', 'task-5'])
    expect(updates.map((u: { orderIndex: number }) => u.orderIndex).sort((a: number, b: number) => a - b)).toEqual([0, 1, 2, 3, 4])

    // The dragged card carries the extra fields the write path needs.
    const moved = updates.find((u: { id: string }) => u.id === 'task-1')
    expect(moved).toEqual({ id: 'task-1', orderIndex: 4, columnId: COLUMN.id, name: 'Alpha card' })

    // Snapshot is the PRE-move state, for undo.
    expect(snapshot).toEqual([
      { id: 'task-1', columnId: COLUMN.id, orderIndex: 0 },
      { id: 'task-2', columnId: COLUMN.id, orderIndex: 1 },
      { id: 'task-3', columnId: COLUMN.id, orderIndex: 2 },
      { id: 'task-4', columnId: COLUMN.id, orderIndex: 3 },
      { id: 'task-5', columnId: COLUMN.id, orderIndex: 4 },
    ])

    // …and the optimistic store update agrees with what was persisted.
    expect(orderedStoreIds()).toEqual(['task-2', 'task-3', 'task-4', 'task-5', 'task-1'])
  })

  it('a short hop only rewrites the cards that actually shifted', async () => {
    const onTaskMove = await openFiltered()
    // Gamma (index 2) dropped onto Epsilon (index 4): Alpha and Beta don't move.
    act(() => dnd.onDragEnd!({ active: { id: 'task-3' }, over: { id: 'task-5' } } as DragEndEvent))

    const [updates] = onTaskMove.mock.calls[0]
    expect(updates).toEqual([
      // task-4 is hidden by the filter and still gets its new index.
      { id: 'task-4', orderIndex: 2 },
      { id: 'task-5', orderIndex: 3 },
      { id: 'task-3', orderIndex: 4, columnId: COLUMN.id, name: 'Gamma card' },
    ])
    expect(orderedStoreIds()).toEqual(['task-1', 'task-2', 'task-4', 'task-5', 'task-3'])
  })

  it('dragging a card upward re-indexes the span it jumped over', async () => {
    const onTaskMove = await openFiltered()
    act(() => dnd.onDragEnd!({ active: { id: 'task-5' }, over: { id: 'task-1' } } as DragEndEvent))

    const [updates] = onTaskMove.mock.calls[0]
    expect(updates.map((u: { id: string; orderIndex: number }) => [u.id, u.orderIndex])).toEqual([
      ['task-5', 0],
      ['task-1', 1],
      ['task-2', 2],
      ['task-3', 3],
      ['task-4', 4],
    ])
    expect(orderedStoreIds()).toEqual(['task-5', 'task-1', 'task-2', 'task-3', 'task-4'])
  })

  it('a drop on itself, or outside any card, writes nothing', async () => {
    const onTaskMove = await openFiltered()
    act(() => dnd.onDragEnd!({ active: { id: 'task-1' }, over: { id: 'task-1' } } as DragEndEvent))
    act(() => dnd.onDragEnd!({ active: { id: 'task-1' }, over: null } as DragEndEvent))
    // A card that vanished from the column mid-drag (peer delete) is inert too.
    act(() => dnd.onDragEnd!({ active: { id: 'ghost' }, over: { id: 'task-3' } } as DragEndEvent))

    expect(onTaskMove).not.toHaveBeenCalled()
    expect(orderedStoreIds()).toEqual(['task-1', 'task-2', 'task-3', 'task-4', 'task-5'])
  })

  it('cards belonging to other columns are never touched', async () => {
    const other = { ...makeTask('task-9', 'Elsewhere', 0), columnId: 'col-2' }
    act(() => useBoardStore.setState({ tasks: [...FIVE.map((t) => ({ ...t })), other], columns: [COLUMN], labels: [] }))
    const onTaskMove = vi.fn()
    await renderZenOpen({ tasks: FILTERED, onTaskMove })

    act(() => dnd.onDragEnd!({ active: { id: 'task-1' }, over: { id: 'task-5' } } as DragEndEvent))

    const [updates] = onTaskMove.mock.calls[0]
    expect(updates.map((u: { id: string }) => u.id)).not.toContain('task-9')
    expect(useBoardStore.getState().tasks.find((t) => t.id === 'task-9')?.orderIndex).toBe(0)
  })
})

// Zen's exit is the one place the app can strand itself: if teardown never
// runs the user is left behind a full-screen blur with no way out.
describe('ZenModeLayer exit teardown', () => {
  let clearSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    clearSpy = vi.fn(ORIGINAL_CLEAR)
    useZenModeStore.setState({ clear: clearSpy })
    useThemeStore.setState({ smoothUiRenders: true })
    mountBoardColumn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openFlying() {
    return renderZenOpen({}, { left: 40, top: 90, width: 320, height: 620 })
  }

  it('the fallback timer tears Zen down even if the flight never reports completion', async () => {
    await openFlying()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Exit Zen mode' })) })

    // Still up: this is an animated exit, not the instant path.
    expect(useZenModeStore.getState().columnId).toBe(COLUMN.id)
    expect(clearSpy).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(700) })
    expect(clearSpy).toHaveBeenCalledTimes(1)
    expect(useZenModeStore.getState().columnId).toBeNull()
    expect(useZenModeStore.getState().sourceRect).toBeNull()
  })

  it('a double-click on Exit arms only ONE teardown', async () => {
    await openFlying()
    const exit = screen.getByRole('button', { name: 'Exit Zen mode' })

    act(() => { fireEvent.click(exit) })
    const armed = vi.getTimerCount()
    act(() => { fireEvent.click(exit) })
    expect(vi.getTimerCount()).toBe(armed)

    act(() => { vi.advanceTimersByTime(700) })
    expect(clearSpy).toHaveBeenCalledTimes(1)
  })

  it('a second exit path (backdrop, Escape) during the flight is also swallowed', async () => {
    await openFlying()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Exit Zen mode' })) })
    act(() => { fireEvent.click(document.querySelector('[data-zen-backdrop]')!) })
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })

    act(() => { vi.advanceTimersByTime(700) })
    expect(clearSpy).toHaveBeenCalledTimes(1)
  })

  it('unmounting mid-flight cancels the pending teardown instead of firing it later', async () => {
    const { unmount } = await openFlying()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Exit Zen mode' })) })
    act(() => { unmount() })

    act(() => { vi.advanceTimersByTime(2000) })
    expect(clearSpy).not.toHaveBeenCalled()
  })

  it('with the column gone from the board, exit falls back to the stored source rect', async () => {
    document.querySelectorAll('[data-column-id]').forEach((el) => el.remove())
    await openFlying()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Exit Zen mode' })) })

    // Still an animated exit (the stored entry rect is a valid landing site).
    expect(clearSpy).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(700) })
    expect(useZenModeStore.getState().columnId).toBeNull()
  })

  it('reduce-motion skips the flight and tears down on the spot', async () => {
    act(() => useThemeStore.setState({ smoothUiRenders: false }))
    await openFlying()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Exit Zen mode' })) })

    expect(clearSpy).toHaveBeenCalledTimes(1)
    expect(useZenModeStore.getState().columnId).toBeNull()
  })
})
