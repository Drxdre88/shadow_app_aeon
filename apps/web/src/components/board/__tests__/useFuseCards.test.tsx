/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act, cleanup, fireEvent } from '@testing-library/react'

// The board-level fusion lifecycle: a request remembers the two cards it was
// raised for, confirming merges optimistically and lands the server row, and
// the toast's Undo is the same entry Ctrl+Z pops — a failed undo puts the
// fused board back instead of leaving a phantom card behind.

vi.mock('@/lib/actions/fuse', () => ({ fuseBoardTasks: vi.fn(), unfuseBoardTasks: vi.fn() }))

import { fuseBoardTasks, unfuseBoardTasks } from '@/lib/actions/fuse'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { useUndoStore } from '@/lib/store/undoStore'
import { useThemeStore } from '@/stores/themeStore'
import { ToastContainer } from '@/components/ui/Toast'
import { useFuseCards } from '../useFuseCards'
import type { FuseSnapshot } from '@/lib/data/validators'

const task = (id: string, extra: Partial<BoardTask> = {}): BoardTask => ({
  id,
  projectId: 'p1',
  name: id,
  columnId: 'col',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
  ...extra,
})

function seed() {
  useBoardStore.setState({
    tasks: [task('s'), task('x', { description: 'extra' }), task('o')],
    dependencies: [],
    assigneesByTask: {},
    checklistSummaries: {},
    checklistPreviews: {},
    isDirty: false,
  })
}

const survivorRow = { id: 's', name: 'Fused', description: 'extra', priority: 'medium', startDate: null, endDate: null, onTimeline: false, size: null, updatedAt: new Date('2026-09-02T10:00:00.000Z') }
const snapshot = { projectId: 'p1', survivorId: 's', sourceId: 'x' } as unknown as FuseSnapshot
const ids = () => useBoardStore.getState().tasks.map((t) => t.id)
const survivor = () => useBoardStore.getState().tasks.find((t) => t.id === 's')
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  seed()
  useUndoStore.getState().clear()
  useThemeStore.setState({ boardActionToasts: true })
  vi.mocked(fuseBoardTasks).mockResolvedValue({ survivor: survivorRow as never, labelIds: [], snapshot })
  vi.mocked(unfuseBoardTasks).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useFuseCards', () => {
  it('a request carries the two cards as they were, and ends when either leaves the store', () => {
    const { result } = renderHook(() => useFuseCards('p1'))
    act(() => result.current.requestFuse('s', ['x']))
    expect(result.current.request).toMatchObject({ sourceIds: ['x'], targetId: 's', sources: [{ id: 'x', description: 'extra' }], target: { id: 's' } })

    act(() => { useBoardStore.getState().removeTask('x') })
    expect(result.current.request).toBeNull()
  })

  it('ignores cards that are not in the store, the target itself, and duplicates', () => {
    const { result } = renderHook(() => useFuseCards('p1'))
    act(() => result.current.requestFuse('s', ['ghost']))
    act(() => result.current.requestFuse('s', ['s']))
    act(() => result.current.requestFuse('ghost', ['x']))
    expect(result.current.request).toBeNull()
    act(() => result.current.requestFuse('s', ['x', 's', 'x', 'ghost', 'o']))
    expect(result.current.request?.sourceIds).toEqual(['x', 'o'])
  })

  it('fuses several selected cards into the target one at a time, and Undo unwinds them last-first', async () => {
    render(<ToastContainer />)
    const snapX = { ...snapshot, sourceId: 'x' } as FuseSnapshot
    const snapO = { ...snapshot, sourceId: 'o' } as FuseSnapshot
    vi.mocked(fuseBoardTasks).mockImplementation(async ({ sourceId }) => ({ survivor: survivorRow as never, labelIds: [], snapshot: sourceId === 'x' ? snapX : snapO }))
    useBoardStore.setState({ selectedTaskIds: ['x', 'o'], selectedTaskId: 'x' })
    const { result } = renderHook(() => useFuseCards('p1'))
    act(() => result.current.requestFuse('s', ['x', 'o']))
    await act(async () => { await result.current.confirmFuse('Fused') })

    expect(vi.mocked(fuseBoardTasks).mock.calls.map((c) => c[0].sourceId)).toEqual(['x', 'o'])
    expect(ids()).toEqual(['s'])
    expect(survivor()?.name).toBe('Fused')
    expect(useBoardStore.getState().selectedTaskIds).toEqual([])
    expect(useBoardStore.getState().selectedTaskId).toBeNull()
    expect(useUndoStore.getState().stack[0].description).toBe('Fused 3 cards into "Fused"')

    await act(async () => {
      useUndoStore.getState().pop()!.undo()
      await flush()
    })
    expect(vi.mocked(unfuseBoardTasks).mock.calls.map((c) => c[1])).toEqual([snapO, snapX])
    expect(ids().sort()).toEqual(['o', 's', 'x'])
    expect(survivor()?.name).toBe('s')
    expect(useBoardStore.getState().isDirty).toBe(false)
  })

  it('a failure midway keeps what landed, says how many, and its Undo unwinds only those', async () => {
    render(<ToastContainer />)
    vi.mocked(fuseBoardTasks)
      .mockResolvedValueOnce({ survivor: survivorRow as never, labelIds: [], snapshot })
      .mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useFuseCards('p1'))
    act(() => result.current.requestFuse('s', ['x', 'o']))
    await act(async () => { await result.current.confirmFuse('Fused') })

    expect(ids().sort()).toEqual(['o', 's'])
    expect(survivor()?.name).toBe('Fused')
    expect(result.current.request).toBeNull()
    const stack = useUndoStore.getState().stack
    expect(stack).toHaveLength(1)
    expect(stack[0].description).toContain('Fused 1 of 2 cards')
    expect(stack[0].description).toContain('boom')

    await act(async () => {
      stack[0].undo()
      await flush()
    })
    expect(unfuseBoardTasks).toHaveBeenCalledTimes(1)
    expect(ids().sort()).toEqual(['o', 's', 'x'])
    expect(survivor()?.name).toBe('s')
  })

  it('confirming fuses optimistically, lands the server row, registers an undo, and Ctrl+Z replays it', async () => {
    render(<ToastContainer />)
    const { result } = renderHook(() => useFuseCards('p1'))
    act(() => result.current.requestFuse('s', ['x']))
    await act(async () => { await result.current.confirmFuse('Fused') })

    expect(fuseBoardTasks).toHaveBeenCalledWith({ projectId: 'p1', survivorId: 's', sourceId: 'x', name: 'Fused' })
    expect(ids()).toEqual(['s', 'o'])
    expect(survivor()?.name).toBe('Fused')
    expect(useBoardStore.getState().isDirty).toBe(false)
    expect(result.current.request).toBeNull()
    expect(result.current.isFusing).toBe(false)

    const stack = useUndoStore.getState().stack
    expect(stack).toHaveLength(1)
    expect(stack[0].description).toBe('Fused "x" into "Fused"')

    await act(async () => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
      await flush()
    })
    expect(unfuseBoardTasks).toHaveBeenCalledWith('p1', snapshot)
    expect(ids()).toEqual(['s', 'o', 'x'])
    expect(survivor()?.name).toBe('s')
    expect(useUndoStore.getState().stack).toHaveLength(0)
    expect(useBoardStore.getState().isDirty).toBe(false)
  })

  it('a failed undo puts the fused board back and lets realtime reloads through again', async () => {
    render(<ToastContainer />)
    vi.mocked(unfuseBoardTasks).mockRejectedValue(new Error('The fused card no longer exists'))
    const { result } = renderHook(() => useFuseCards('p1'))
    act(() => result.current.requestFuse('s', ['x']))
    await act(async () => { await result.current.confirmFuse('Fused') })

    await act(async () => {
      useUndoStore.getState().pop()!.undo()
      await flush()
    })
    expect(unfuseBoardTasks).toHaveBeenCalledTimes(1)
    expect(ids()).toEqual(['s', 'o'])
    expect(survivor()?.name).toBe('Fused')
    expect(useBoardStore.getState().isDirty).toBe(false)
  })

  it('a failed fusion reverts the board and keeps the request so the operator can retry or cancel', async () => {
    vi.mocked(fuseBoardTasks).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFuseCards('p1'))
    act(() => result.current.requestFuse('s', ['x']))
    await act(async () => { await result.current.confirmFuse('Fused') })

    expect(ids()).toEqual(['s', 'o', 'x'])
    expect(survivor()?.name).toBe('s')
    expect(useBoardStore.getState().isDirty).toBe(false)
    expect(result.current.request).not.toBeNull()
    expect(result.current.isFusing).toBe(false)
    expect(useUndoStore.getState().stack).toHaveLength(0)
  })
})
