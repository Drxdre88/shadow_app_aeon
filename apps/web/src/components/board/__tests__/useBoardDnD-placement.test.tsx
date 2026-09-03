/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DragEndEvent } from '@dnd-kit/core'
import { useBoardDnD } from '../useBoardDnD'
import { useBoardStore } from '@/lib/store/boardStore'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'

// Hold-to-move placement must be the SAME move as a drag-drop: same updates
// to the store, same payload to the persistence callback (undo baseline
// included), same Auto AI arming. These tests drive placeMovingTask and pin
// the column/index it produces for top-half, bottom-half and end taps, then
// prove a placement and a drop that mean the same thing emit the same call.

if (typeof globalThis.CSS === 'undefined') {
  // @ts-expect-error minimal stand-in for the one member used
  globalThis.CSS = { escape: (value: string) => value }
}

const PROJECT = 'proj-1'
const TODO = 'col-todo'
const DOING = 'col-doing'
const DONE = 'col-done'

const COLUMNS = [
  { id: TODO, projectId: PROJECT, name: 'Todo', color: 'blue', icon: null, orderIndex: 0 },
  { id: DOING, projectId: PROJECT, name: 'Doing', color: 'green', icon: null, orderIndex: 1 },
  { id: DONE, projectId: PROJECT, name: 'Done', color: 'pink', icon: null, orderIndex: 2 },
]

function task(id: string, columnId: string, orderIndex: number, over: Record<string, unknown> = {}) {
  return {
    id,
    projectId: PROJECT,
    name: `card ${id}`,
    columnId,
    status: 'todo',
    priority: 'medium' as const,
    color: 'purple',
    labels: [],
    onTimeline: false,
    orderIndex,
    metadata: {},
    ...over,
  }
}

/** m sits alone in Todo; Doing holds a, b, c in that order. */
function board() {
  return [
    task('m', TODO, 0),
    task('a', DOING, 0),
    task('b', DOING, 1),
    task('c', DOING, 2),
  ]
}

function setup(tasks = board()) {
  useBoardStore.setState({ tasks: tasks as never[], columns: COLUMNS as never[], movingTaskId: null })
  useHangarUiStore.setState({ projectId: null, config: { enabled: false, triggerColumnId: null }, missionEditorTaskId: null } as never)
  const onTaskMove = vi.fn()
  const hook = renderHook(() =>
    useBoardDnD({ projectTasks: tasks as never[], sortedColumns: COLUMNS as never[], onTaskMove })
  )
  return { hook, onTaskMove }
}

function lift(id: string) {
  act(() => { useBoardStore.getState().setMovingTaskId(id) })
}

function orderOf(columnId: string) {
  return useBoardStore.getState().tasks
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((t) => t.id)
}

describe('useBoardDnD.placeMovingTask — where the card lands', () => {
  beforeEach(() => {
    useBoardStore.setState({ movingTaskId: null })
  })

  it('top-half tap on a card inserts BEFORE it', () => {
    const { hook, onTaskMove } = setup()
    lift('m')
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'card', taskId: 'b', half: 'top' }) })

    expect(orderOf(DOING)).toEqual(['a', 'm', 'b', 'c'])
    expect(orderOf(TODO)).toEqual([])
    const [updates] = onTaskMove.mock.calls[0]
    expect(updates).toContainEqual(expect.objectContaining({ id: 'm', columnId: DOING, orderIndex: 1, name: 'card m' }))
    // Only the siblings that actually shifted are written.
    expect(updates).toContainEqual({ id: 'b', orderIndex: 2 })
    expect(updates).toContainEqual({ id: 'c', orderIndex: 3 })
    expect(updates.find((u: { id: string }) => u.id === 'a')).toBeUndefined()
  })

  it('bottom-half tap on a card inserts AFTER it', () => {
    const { hook, onTaskMove } = setup()
    lift('m')
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'card', taskId: 'b', half: 'bottom' }) })

    expect(orderOf(DOING)).toEqual(['a', 'b', 'm', 'c'])
    const [updates] = onTaskMove.mock.calls[0]
    expect(updates).toContainEqual(expect.objectContaining({ id: 'm', columnId: DOING, orderIndex: 2 }))
    expect(updates).toContainEqual({ id: 'c', orderIndex: 3 })
  })

  it('a tap on empty column space appends', () => {
    const { hook, onTaskMove } = setup()
    lift('m')
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'end' }) })

    expect(orderOf(DOING)).toEqual(['a', 'b', 'c', 'm'])
    const [updates] = onTaskMove.mock.calls[0]
    expect(updates).toEqual([expect.objectContaining({ id: 'm', columnId: DOING, orderIndex: 3 })])
  })

  it('reorders within the same column, counting the moved card out of the way', () => {
    const { hook } = setup()
    lift('a')
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'card', taskId: 'c', half: 'top' }) })
    expect(orderOf(DOING)).toEqual(['b', 'a', 'c'])
  })

  it('landing in a Done column marks the card done, exactly like a drop', () => {
    const { hook, onTaskMove } = setup()
    lift('m')
    act(() => { hook.result.current.placeMovingTask({ columnId: DONE, kind: 'end' }) })
    expect(onTaskMove.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'm', columnId: DONE, status: 'done' })])
  })

  it('hands over the pre-move board as the undo baseline', () => {
    const { hook, onTaskMove } = setup()
    lift('m')
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'end' }) })
    const snapshot = onTaskMove.mock.calls[0][1]
    expect(snapshot).toContainEqual({ id: 'm', columnId: TODO, orderIndex: 0 })
    expect(snapshot).toHaveLength(4)
  })

  it('always leaves move mode, and a no-op placement persists nothing', () => {
    const { hook, onTaskMove } = setup()
    lift('c')
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'end' }) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
    expect(onTaskMove).not.toHaveBeenCalled()
    expect(orderOf(DOING)).toEqual(['a', 'b', 'c'])
  })

  it('tapping the lifted card itself cancels without moving', () => {
    const { hook, onTaskMove } = setup()
    lift('b')
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'card', taskId: 'b', half: 'top' }) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
    expect(onTaskMove).not.toHaveBeenCalled()
  })

  it('does nothing when no card is lifted', () => {
    const { hook, onTaskMove } = setup()
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'end' }) })
    expect(onTaskMove).not.toHaveBeenCalled()
  })
})

describe('useBoardDnD.placeMovingTask — one commit path with drag-drop', () => {
  function dropOnColumn(hook: ReturnType<typeof setup>['hook'], id: string, columnId: string) {
    act(() => {
      hook.result.current.handleDragStart({ active: { id, data: { current: { type: 'task' } } } } as never)
      hook.result.current.handleDragEnd({
        active: { id, data: { current: { type: 'task' } }, rect: { current: { initial: null, translated: null } } },
        over: { id: columnId, data: { current: { type: 'column', columnId } } },
        delta: { x: 0, y: 0 },
        activatorEvent: new MouseEvent('mousedown'),
        collisions: null,
      } as unknown as DragEndEvent)
    })
  }

  it('a placement and a drop meaning the same move emit identical persistence calls', () => {
    const viaDrop = setup()
    dropOnColumn(viaDrop.hook, 'm', DOING)

    const viaPlace = setup()
    lift('m')
    act(() => { viaPlace.hook.result.current.placeMovingTask({ columnId: DOING, kind: 'end' }) })

    expect(viaPlace.onTaskMove.mock.calls[0]).toEqual(viaDrop.onTaskMove.mock.calls[0])
  })

  it('Auto AI arming rides the placement exactly as it rides a drop', () => {
    const armed = task('m', TODO, 0, { metadata: { hangar: { objective: 'implement', repo: 'arq', agent: 'copilot', instruction: 'x', autoRun: true } } })
    const { hook, onTaskMove } = setup([armed, task('a', DOING, 0)])
    useHangarUiStore.setState({ projectId: PROJECT, config: { enabled: true, triggerColumnId: DOING } } as never)
    lift('m')
    act(() => { hook.result.current.placeMovingTask({ columnId: DOING, kind: 'card', taskId: 'a', half: 'top' }) })
    expect(onTaskMove.mock.calls[0][2]).toMatchObject({ autoRunTaskId: 'm' })
  })

  it('a touch drag released in place arms move mode instead of dropping', () => {
    const { hook, onTaskMove } = setup()
    act(() => {
      hook.result.current.handleDragStart({ active: { id: 'm', data: { current: { type: 'task' } } } } as never)
      hook.result.current.handleDragEnd({
        active: { id: 'm', data: { current: { type: 'task' } }, rect: { current: { initial: null, translated: null } } },
        over: { id: 'm', data: { current: { type: 'task' } } },
        delta: { x: 1, y: 2 },
        activatorEvent: new Event('touchstart'),
        collisions: null,
      } as unknown as DragEndEvent)
    })
    expect(useBoardStore.getState().movingTaskId).toBe('m')
    expect(onTaskMove).not.toHaveBeenCalled()
    expect(orderOf(TODO)).toEqual(['m'])
  })

  it('starting a real drag drops a pending move mode', () => {
    const { hook } = setup()
    lift('m')
    act(() => { hook.result.current.handleDragStart({ active: { id: 'a', data: { current: { type: 'task' } } } } as never) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })
})
