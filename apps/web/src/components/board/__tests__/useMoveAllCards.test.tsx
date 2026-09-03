/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'

// The move-all orchestration on its own, away from the menu: cards land at
// the end of the target instantly and in order, the bulk action persists
// them, a rejected write reverts, and the toast's Undo restores the previous
// placement through one batched reorder.

vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/actions/board', () => ({ reorderBoardTasks: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/actions/boardBulk', () => ({ moveAllTasksToColumnAction: vi.fn().mockResolvedValue([]) }))

import { useMoveAllCards } from '../useMoveAllCards'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { moveAllTasksToColumnAction } from '@/lib/actions/boardBulk'
import { reorderBoardTasks } from '@/lib/actions/board'
import { toast } from '@/components/ui/Toast'

const PROJECT_ID = 'project-1'

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

const ORIGINAL = { a1: ['col-a', 0], a2: ['col-a', 1], a3: ['col-a', 2], b1: ['col-b', 5] }
const DOING = { id: 'col-b', name: 'Doing' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(moveAllTasksToColumnAction).mockResolvedValue([])
  useBoardStore.setState({
    tasks: [task('a1', 'col-a', 0), task('a2', 'col-a', 1), task('a3', 'col-a', 2), task('b1', 'col-b', 5)],
    isDirty: false,
  })
})

afterEach(() => cleanup())

describe('useMoveAllCards', () => {
  it('moves every card to the end of the target in order, persists and marks clean', async () => {
    const { result } = renderHook(() => useMoveAllCards(PROJECT_ID))

    let pending!: Promise<void>
    act(() => { pending = result.current.moveAll('col-a', DOING) })
    expect(placement()).toEqual({ a1: ['col-b', 6], a2: ['col-b', 7], a3: ['col-b', 8], b1: ['col-b', 5] })
    expect(moveAllTasksToColumnAction).toHaveBeenCalledWith(PROJECT_ID, 'col-a', 'col-b')

    await act(async () => { await pending })
    expect(vi.mocked(toast).mock.calls[0][0]).toBe('Moved 3 cards to Doing')
    expect(useBoardStore.getState().isDirty).toBe(false)
  })

  it('does nothing for an empty source column', async () => {
    const { result } = renderHook(() => useMoveAllCards(PROJECT_ID))
    await act(async () => { await result.current.moveAll('col-empty', DOING) })
    expect(placement()).toEqual(ORIGINAL)
    expect(moveAllTasksToColumnAction).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('a rejected write puts every card back where it was', async () => {
    vi.mocked(moveAllTasksToColumnAction).mockRejectedValue(new Error('Viewers cannot modify this project'))
    const { result } = renderHook(() => useMoveAllCards(PROJECT_ID))

    await act(async () => { await result.current.moveAll('col-a', DOING) })
    expect(placement()).toEqual(ORIGINAL)
    expect(vi.mocked(toast).mock.calls[0][0]).toContain('Viewers cannot modify')
  })

  it('Undo restores the original placement through one batched reorder', async () => {
    const { result } = renderHook(() => useMoveAllCards(PROJECT_ID))
    await act(async () => { await result.current.moveAll('col-a', DOING) })

    const onUndo = (vi.mocked(toast).mock.calls[0][1] as { onUndo: () => void }).onUndo
    await act(async () => { onUndo() })

    expect(placement()).toEqual(ORIGINAL)
    expect(reorderBoardTasks).toHaveBeenCalledTimes(1)
    expect(reorderBoardTasks).toHaveBeenCalledWith(PROJECT_ID, [
      { id: 'a1', orderIndex: 0, columnId: 'col-a' },
      { id: 'a2', orderIndex: 1, columnId: 'col-a' },
      { id: 'a3', orderIndex: 2, columnId: 'col-a' },
    ])
    await waitFor(() => expect(useBoardStore.getState().isDirty).toBe(false))
  })

  it('a failed Undo write leaves the restored board and reports it', async () => {
    vi.mocked(reorderBoardTasks).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useMoveAllCards(PROJECT_ID))
    await act(async () => { await result.current.moveAll('col-a', DOING) })

    const onUndo = (vi.mocked(toast).mock.calls[0][1] as { onUndo: () => void }).onUndo
    await act(async () => { onUndo() })

    expect(placement()).toEqual(ORIGINAL)
    await waitFor(() => expect(vi.mocked(toast).mock.calls.at(-1)?.[0]).toBe('offline'))
  })
})
