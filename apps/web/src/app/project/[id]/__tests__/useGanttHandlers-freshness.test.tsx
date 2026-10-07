/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'

// Timeline writes re-date a card on the server and bump its version. The
// board has to record that version, or the next card drag reads as stale.

const updateGanttTask = vi.fn()
const pushToGantt = vi.fn()

vi.mock('@/lib/actions/ganttViews', () => ({
  resetGanttData: vi.fn(),
  restoreTimelineSnapshot: vi.fn(),
  createGanttView: vi.fn(),
  updateGanttView: vi.fn(),
  deleteGanttView: vi.fn(),
  reflowGanttView: vi.fn(),
}))
vi.mock('@/lib/actions/gantt', () => ({
  createGanttTask: vi.fn(),
  updateGanttTask: (...a: unknown[]) => updateGanttTask(...a),
  deleteGanttTask: vi.fn(),
  updateRow: vi.fn(),
}))
vi.mock('@/lib/actions/bridge', () => ({ pushToGantt: (...a: unknown[]) => pushToGantt(...a) }))
vi.mock('@/lib/actions/board', () => ({ updateBoardTask: vi.fn() }))

import { useGanttHandlers } from '../useGanttHandlers'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { useGanttStore } from '@/lib/store/ganttStore'

const PROJECT_ID = 'p1'
const OLD = '2026-10-01T00:00:00.000Z'
const NEW = '2026-10-07T06:00:00.000Z'

const card = (id: string): BoardTask => ({
  id,
  projectId: PROJECT_ID,
  name: id,
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
  updatedAt: OLD,
})

const versionOf = (id: string) => useBoardStore.getState().tasks.find((t) => t.id === id)?.updatedAt

beforeEach(() => {
  vi.clearAllMocks()
  useBoardStore.setState({ tasks: [card('c1'), card('c2')], isDirty: false })
  useGanttStore.setState({ activeViewId: 'view-1', tasks: [] })
})

afterEach(() => cleanup())

describe('useGanttHandlers card versions', () => {
  it('a bar drag records the version the server stamped on its card', async () => {
    updateGanttTask.mockResolvedValue({ id: 'bar-1', boardTask: { boardTaskId: 'c1', updatedAt: NEW } })
    const { result } = renderHook(() => useGanttHandlers(PROJECT_ID, vi.fn(), vi.fn()))

    act(() => { result.current.handleGanttTaskUpdate('bar-1', { startDate: OLD, endDate: NEW }) })

    await waitFor(() => expect(versionOf('c1')).toBe(NEW))
    expect(versionOf('c2')).toBe(OLD)
  })

  it('a bar edit without a linked card leaves versions alone', async () => {
    updateGanttTask.mockResolvedValue({ id: 'bar-1', boardTask: null })
    const { result } = renderHook(() => useGanttHandlers(PROJECT_ID, vi.fn(), vi.fn()))

    await act(async () => { result.current.handleGanttTaskUpdate('bar-1', { name: 'x' }) })

    expect(versionOf('c1')).toBe(OLD)
  })

  it('pushing a card to the timeline records its new version', async () => {
    pushToGantt.mockResolvedValue({
      id: 'bar-9', projectId: PROJECT_ID, rowId: 'row-1', name: 'c1',
      startDate: new Date(OLD), endDate: new Date(NEW), color: 'purple', progress: 0,
      boardTaskUpdatedAt: NEW,
    })
    const { result } = renderHook(() => useGanttHandlers(PROJECT_ID, vi.fn(), vi.fn()))

    act(() => { result.current.handlePushToGantt('c1') })

    await waitFor(() => expect(versionOf('c1')).toBe(NEW))
    expect(useBoardStore.getState().tasks.find((t) => t.id === 'c1')?.onTimeline).toBe(true)
  })
})
