/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core'
import { useBoardDnD } from '../useBoardDnD'
import { useBoardStore } from '@/lib/store/boardStore'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'
import { FUSE_DWELL_MS } from '../fuseZone'

// Card fusion through the real DnD hook: a drop on a card's MIDDLE third,
// after dwelling there, raises a fuse request and moves nothing; a drop on
// the top or bottom third is the reorder it always was; passing through the
// middle without dwelling never arms.

if (typeof globalThis.CSS === 'undefined') {
  // @ts-expect-error minimal stand-in for the one member used
  globalThis.CSS = { escape: (value: string) => value }
}

const PROJECT = 'proj-1'
const DOING = 'col-doing'

const COLUMNS = [
  { id: DOING, projectId: PROJECT, name: 'Doing', color: 'green', icon: null, orderIndex: 0 },
]

const CARD_HEIGHT = 120
const CARD_TOP: Record<string, number> = { a: 0, b: 200, c: 400 }

function task(id: string, orderIndex: number) {
  return { id, projectId: PROJECT, name: `card ${id}`, columnId: DOING, status: 'todo', priority: 'medium' as const, color: 'purple', labels: [], onTimeline: false, orderIndex, metadata: {} }
}

function mountColumnDom() {
  document.body.innerHTML = ''
  const column = document.createElement('div')
  column.setAttribute('data-column-id', DOING)
  for (const id of ['a', 'b', 'c']) {
    const card = document.createElement('div')
    card.setAttribute('data-task-id', id)
    card.getBoundingClientRect = () => ({ top: CARD_TOP[id], height: CARD_HEIGHT, left: 0, width: 200, right: 200, bottom: CARD_TOP[id] + CARD_HEIGHT, x: 0, y: CARD_TOP[id], toJSON: () => ({}) }) as DOMRect
    column.appendChild(card)
  }
  document.body.appendChild(column)
}

function setup() {
  const tasks = [task('a', 0), task('b', 1), task('c', 2)]
  useBoardStore.setState({ tasks: tasks as never[], columns: COLUMNS as never[], movingTaskId: null, fuseTargetId: null })
  useHangarUiStore.setState({ projectId: null, config: { enabled: false, triggerColumnId: null }, missionEditorTaskId: null } as never)
  mountColumnDom()
  const onTaskMove = vi.fn()
  const onFuseRequest = vi.fn()
  const hook = renderHook(() =>
    useBoardDnD({ projectTasks: tasks as never[], sortedColumns: COLUMNS as never[], onTaskMove, onFuseRequest })
  )
  return { hook, onTaskMove, onFuseRequest }
}

const activator = (clientY: number) => new MouseEvent('mousedown', { clientY })

function start(hook: ReturnType<typeof setup>['hook'], id: string) {
  act(() => {
    hook.result.current.handleDragStart({ active: { id, data: { current: { type: 'task' } } } } as unknown as DragStartEvent)
  })
}

function moveOver(hook: ReturnType<typeof setup>['hook'], id: string, overId: string, clientY: number) {
  act(() => {
    hook.result.current.handleDragMove({
      active: { id, data: { current: { type: 'task' } }, rect: { current: { initial: null, translated: null } } },
      over: { id: overId, data: { current: { type: 'task', columnId: DOING } } },
      delta: { x: 0, y: 0 },
      activatorEvent: activator(clientY),
      collisions: null,
    } as unknown as DragMoveEvent)
  })
}

function drop(hook: ReturnType<typeof setup>['hook'], id: string, overId: string, clientY: number) {
  act(() => {
    hook.result.current.handleDragEnd({
      active: { id, data: { current: { type: 'task' } }, rect: { current: { initial: null, translated: null } } },
      over: { id: overId, data: { current: { type: 'task', columnId: DOING } } },
      delta: { x: 0, y: 0 },
      activatorEvent: activator(clientY),
      collisions: null,
    } as unknown as DragEndEvent)
  })
}

const orderOf = () => useBoardStore.getState().tasks
  .filter((t) => t.columnId === DOING)
  .sort((a, b) => a.orderIndex - b.orderIndex)
  .map((t) => t.id)

const middleOf = (id: string) => CARD_TOP[id] + CARD_HEIGHT / 2
const topOf = (id: string) => CARD_TOP[id] + 10
const bottomOf = (id: string) => CARD_TOP[id] + CARD_HEIGHT - 10

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useBoardDnD — card fusion drop', () => {
  it('dwelling on the middle third arms the target, and the drop asks to fuse instead of moving', () => {
    const { hook, onTaskMove, onFuseRequest } = setup()
    start(hook, 'a')
    moveOver(hook, 'a', 'c', middleOf('c'))
    expect(useBoardStore.getState().fuseTargetId).toBeNull()

    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS) })
    expect(useBoardStore.getState().fuseTargetId).toBe('c')

    drop(hook, 'a', 'c', middleOf('c'))
    expect(onFuseRequest).toHaveBeenCalledWith('a', 'c')
    expect(onTaskMove).not.toHaveBeenCalled()
    expect(orderOf()).toEqual(['a', 'b', 'c'])
    expect(useBoardStore.getState().fuseTargetId).toBeNull()
  })

  it('a drop on the top third still reorders (places before)', () => {
    const { hook, onTaskMove, onFuseRequest } = setup()
    start(hook, 'c')
    moveOver(hook, 'c', 'a', topOf('a'))
    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS * 2) })
    expect(useBoardStore.getState().fuseTargetId).toBeNull()

    drop(hook, 'c', 'a', topOf('a'))
    expect(onFuseRequest).not.toHaveBeenCalled()
    expect(onTaskMove).toHaveBeenCalledTimes(1)
    expect(orderOf()).toEqual(['c', 'a', 'b'])
  })

  it('a drop on the bottom third still reorders (places after)', () => {
    const { hook, onTaskMove, onFuseRequest } = setup()
    start(hook, 'c')
    moveOver(hook, 'c', 'a', bottomOf('a'))
    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS * 2) })

    drop(hook, 'c', 'a', bottomOf('a'))
    expect(onFuseRequest).not.toHaveBeenCalled()
    expect(onTaskMove).toHaveBeenCalledTimes(1)
    expect(orderOf()).toEqual(['a', 'c', 'b'])
  })

  it('an armed fusion only fires while the pointer is still on the card at release', () => {
    const { hook, onTaskMove, onFuseRequest } = setup()
    start(hook, 'a')
    moveOver(hook, 'a', 'c', middleOf('c'))
    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS) })
    expect(useBoardStore.getState().fuseTargetId).toBe('c')

    drop(hook, 'a', DOING, CARD_TOP.c + CARD_HEIGHT + 40)
    expect(onFuseRequest).not.toHaveBeenCalled()
    expect(onTaskMove).toHaveBeenCalledTimes(1)
    expect(orderOf()).toEqual(['b', 'c', 'a'])
  })

  it('passing through the middle without dwelling never arms, so the drop reorders', () => {
    const { hook, onTaskMove, onFuseRequest } = setup()
    start(hook, 'c')
    moveOver(hook, 'c', 'a', topOf('a'))
    act(() => { vi.advanceTimersByTime(50) })
    moveOver(hook, 'c', 'a', middleOf('a'))
    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS - 50) })
    moveOver(hook, 'c', 'a', bottomOf('a'))
    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS * 2) })
    expect(useBoardStore.getState().fuseTargetId).toBeNull()

    drop(hook, 'c', 'a', bottomOf('a'))
    expect(onFuseRequest).not.toHaveBeenCalled()
    expect(onTaskMove).toHaveBeenCalledTimes(1)
  })

  it('leaving the armed card disarms; cancelling the drag clears everything', () => {
    const { hook, onFuseRequest } = setup()
    start(hook, 'a')
    moveOver(hook, 'a', 'c', middleOf('c'))
    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS) })
    expect(useBoardStore.getState().fuseTargetId).toBe('c')

    moveOver(hook, 'a', 'b', middleOf('b'))
    expect(useBoardStore.getState().fuseTargetId).toBeNull()

    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS) })
    expect(useBoardStore.getState().fuseTargetId).toBe('b')
    act(() => { hook.result.current.handleDragCancel() })
    expect(useBoardStore.getState().fuseTargetId).toBeNull()
    expect(onFuseRequest).not.toHaveBeenCalled()
  })

  it('never arms on the dragged card itself', () => {
    const { hook } = setup()
    start(hook, 'b')
    moveOver(hook, 'b', 'b', middleOf('b'))
    act(() => { vi.advanceTimersByTime(FUSE_DWELL_MS * 2) })
    expect(useBoardStore.getState().fuseTargetId).toBeNull()
  })
})
