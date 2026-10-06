import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MutableRefObject } from 'react'

const loadBoardData = vi.fn()
vi.mock('@/lib/actions/board', () => ({ loadBoardData: (...a: unknown[]) => loadBoardData(...a) }))
vi.mock('@/lib/actions/gantt', () => ({ getRows: vi.fn(), getGanttTasks: vi.fn() }))
vi.mock('@/lib/actions/ganttViews', () => ({ getGanttViews: vi.fn() }))
vi.mock('@/lib/actions/canvas', () => ({ getCanvasNodes: vi.fn(), getCanvasEdges: vi.fn() }))
vi.mock('pusher-js', () => ({ default: vi.fn() }))

let knownVersion: MutableRefObject<number | null> | null = null
vi.mock('../useBoardFreshness', () => ({
  useBoardFreshness: (_p: string, ref: MutableRefObject<number | null>) => {
    knownVersion = ref
    return { checkNow: vi.fn(), recheckSoon: vi.fn() }
  },
}))

import { useProjectData } from '../useProjectData'
import { useBoardStore } from '@/lib/store/boardStore'

const initial = {
  boardVersion: 4, tasks: [], columns: [], labels: [], taskLabels: [], dependencies: [],
  checklistSummaries: {}, checklistPreviews: {},
}

describe('useProjectData stale-board signal', () => {
  it('forgets the on-screen version and reloads when a move is refused as stale', () => {
    loadBoardData.mockReturnValue(new Promise(() => {}))
    renderHook(() => useProjectData('p1', 'board', initial))
    expect(loadBoardData).not.toHaveBeenCalled()
    expect(knownVersion?.current).toBe(4)

    act(() => useBoardStore.getState().bumpStaleBoardSignal())

    expect(knownVersion?.current).toBeNull()
    expect(loadBoardData).toHaveBeenCalledWith('p1')
  })
})
