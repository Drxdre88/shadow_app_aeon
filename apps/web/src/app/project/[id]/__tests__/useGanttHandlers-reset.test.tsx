/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'

// A timeline reset wipes the dates on every on-timeline card of the project.
// The store must drop them immediately, put them back if the server refuses,
// and — on success — leave an undo entry that restores the SERVER's snapshot
// (which can include cards this client never saw on the timeline).

const resetGanttData = vi.fn()
const updateBoardTask = vi.fn()

vi.mock('@/lib/actions/ganttViews', () => ({
  resetGanttData: (...a: unknown[]) => resetGanttData(...a),
  createGanttView: vi.fn(),
  updateGanttView: vi.fn(),
  deleteGanttView: vi.fn(),
  reflowGanttView: vi.fn(),
}))
vi.mock('@/lib/actions/gantt', () => ({
  createGanttTask: vi.fn(),
  updateGanttTask: vi.fn(),
  deleteGanttTask: vi.fn(),
  updateRow: vi.fn(),
}))
vi.mock('@/lib/actions/bridge', () => ({ pushToGantt: vi.fn() }))
vi.mock('@/lib/actions/board', () => ({
  updateBoardTask: (...a: unknown[]) => updateBoardTask(...a),
}))

import { useGanttHandlers } from '../useGanttHandlers'
import { ToastContainer } from '@/components/ui/Toast'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useUndoStore } from '@/lib/store/undoStore'

const PROJECT_ID = 'p1'

const task = (id: string, extra: Partial<BoardTask> = {}): BoardTask => ({
  id,
  projectId: PROJECT_ID,
  name: id,
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
  ...extra,
})

const A_START = '2026-09-01T00:00:00.000Z'
const A_END = '2026-09-03T00:00:00.000Z'
const B_START = '2026-09-04T00:00:00.000Z'
const D_START = '2026-09-10T00:00:00.000Z'

const seed = () => useBoardStore.setState({
  tasks: [
    task('a', { onTimeline: true, startDate: A_START, endDate: A_END }),
    task('b', { onTimeline: true, startDate: B_START, ganttTaskId: 'bar-b' }),
    task('c', { onTimeline: false, ganttTaskId: 'bar-c' }),
    task('d', { onTimeline: false, startDate: D_START }),
  ],
})

const findTask = (id: string) => useBoardStore.getState().tasks.find((t) => t.id === id)!

const Wrapper = ({ children }: { children: ReactNode }) => (
  <>
    <ToastContainer />
    {children}
  </>
)

function setup() {
  const triggerReload = vi.fn()
  const setActiveTab = vi.fn()
  const hook = renderHook(() => useGanttHandlers(PROJECT_ID, setActiveTab, triggerReload), { wrapper: Wrapper })
  return { hook, triggerReload }
}

beforeEach(() => {
  seed()
  useUndoStore.setState({ stack: [] })
  useGanttStore.getState().setViews([{ id: 'v1', projectId: PROJECT_ID, name: 'View', groupBy: 'column', filters: {} } as never])
  updateBoardTask.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('handleGanttReset — confirmation gate', () => {
  it('opens and closes the modal without touching the server', () => {
    const { hook } = setup()
    expect(hook.result.current.ganttResetOpen).toBe(false)
    act(() => hook.result.current.openGanttReset())
    expect(hook.result.current.ganttResetOpen).toBe(true)
    act(() => hook.result.current.closeGanttReset())
    expect(hook.result.current.ganttResetOpen).toBe(false)
    expect(resetGanttData).not.toHaveBeenCalled()
  })
})

describe('handleGanttReset — optimistic reset', () => {
  it('drops dates on timeline-linked cards only, leaving hand-dated board cards alone', async () => {
    let resolve!: (v: unknown) => void
    resetGanttData.mockImplementation(() => new Promise((r) => { resolve = r }))
    const { hook } = setup()

    act(() => hook.result.current.handleGanttReset())

    expect(findTask('a')).toMatchObject({ onTimeline: false, startDate: undefined, endDate: undefined })
    expect(findTask('b')).toMatchObject({ onTimeline: false, startDate: undefined, ganttTaskId: null })
    expect(findTask('c')).toMatchObject({ onTimeline: false, ganttTaskId: null })
    expect(findTask('d')).toMatchObject({ onTimeline: false, startDate: D_START })
    expect(useGanttStore.getState().views).toEqual([])
    expect(hook.result.current.isGanttResetting).toBe(true)
    expect(resetGanttData).toHaveBeenCalledWith(PROJECT_ID)

    await act(async () => { resolve([]) })
    expect(hook.result.current.isGanttResetting).toBe(false)
  })

  it('puts the dates back and reloads when the server refuses', async () => {
    resetGanttData.mockRejectedValue(new Error('nope'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { hook, triggerReload } = setup()

    await act(async () => { hook.result.current.handleGanttReset() })

    expect(findTask('a')).toMatchObject({ onTimeline: true, startDate: A_START, endDate: A_END })
    expect(findTask('b')).toMatchObject({ onTimeline: true, startDate: B_START })
    expect(findTask('d')).toMatchObject({ startDate: D_START })
    expect(triggerReload).toHaveBeenCalled()
    expect(useUndoStore.getState().stack).toHaveLength(0)
    expect(hook.result.current.isGanttResetting).toBe(false)
    consoleError.mockRestore()
  })
})

describe('handleGanttReset — undo', () => {
  it('registers one undo entry that restores the server snapshot through the update action', async () => {
    const serverSnapshot = [
      { id: 'a', startDate: A_START, endDate: A_END, onTimeline: true },
      { id: 'b', startDate: B_START, endDate: null, onTimeline: true },
      { id: 'c', startDate: null, endDate: null, onTimeline: false },
      { id: 'z', startDate: '2026-09-20T00:00:00.000Z', endDate: null, onTimeline: true },
    ]
    resetGanttData.mockResolvedValue(serverSnapshot)
    const { hook, triggerReload } = setup()
    act(() => hook.result.current.openGanttReset())

    await act(async () => { hook.result.current.handleGanttReset() })

    expect(hook.result.current.ganttResetOpen).toBe(false)
    expect(triggerReload).toHaveBeenCalledTimes(1)
    const stack = useUndoStore.getState().stack
    expect(stack).toHaveLength(1)
    expect(stack[0].description).toMatch(/4 cards/)

    triggerReload.mockClear()
    await act(async () => { stack[0].undo() })

    expect(findTask('a')).toMatchObject({ onTimeline: true, startDate: A_START, endDate: A_END })
    expect(findTask('b')).toMatchObject({ onTimeline: true, startDate: B_START, endDate: undefined })
    expect(findTask('c')).toMatchObject({ onTimeline: false, startDate: undefined })

    expect(updateBoardTask).toHaveBeenCalledTimes(4)
    for (const t of serverSnapshot) {
      expect(updateBoardTask).toHaveBeenCalledWith(t.id, PROJECT_ID, {
        onTimeline: t.onTimeline,
        startDate: t.startDate,
        endDate: t.endDate,
      })
    }
    await waitFor(() => expect(triggerReload).toHaveBeenCalledTimes(1))
  })

  it('registers no undo when nothing was on the timeline', async () => {
    useBoardStore.setState({ tasks: [task('d', { startDate: D_START })] })
    resetGanttData.mockResolvedValue([])
    const { hook } = setup()

    await act(async () => { hook.result.current.handleGanttReset() })

    expect(useUndoStore.getState().stack).toHaveLength(0)
    expect(updateBoardTask).not.toHaveBeenCalled()
  })
})
