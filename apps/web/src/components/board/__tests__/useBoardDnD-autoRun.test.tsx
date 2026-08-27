/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DragEndEvent } from '@dnd-kit/core'
import { useBoardDnD } from '../useBoardDnD'
import { useBoardStore } from '@/lib/store/boardStore'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'

// The drop path is the one place a gesture can spawn a real agent against a
// real repo. autoRun.test.ts pins the pure predicate; this pins the WIRING —
// that the intent reaches the move callback only when it should, and that it
// is handed over for the persistence layer to fire rather than fired here.

// jsdom ships no CSS.escape, which the drop-index reader uses to build its
// column selector. Ids here are plain, so identity is a faithful stand-in.
if (typeof globalThis.CSS === 'undefined') {
  // @ts-expect-error minimal stand-in for the one member used
  globalThis.CSS = { escape: (value: string) => value }
}

const PROJECT = 'proj-1'
const BACKLOG = 'col-backlog'
const LAUNCH = 'col-launch'

const COLUMNS = [
  { id: BACKLOG, projectId: PROJECT, name: 'Backlog', color: 'blue', icon: null, orderIndex: 0 },
  { id: LAUNCH, projectId: PROJECT, name: 'Prioritised', color: 'green', icon: null, orderIndex: 1 },
]

const MISSION = {
  hangar: {
    objective: 'implement',
    repo: 'arq',
    agent: 'copilot',
    instruction: 'add a hello print to the repo root',
    autoRun: true,
  },
}

function makeTask(over: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    projectId: PROJECT,
    name: 'add print hello',
    columnId: BACKLOG,
    status: 'todo',
    priority: 'medium' as const,
    color: 'purple',
    labels: [],
    onTimeline: false,
    orderIndex: 0,
    metadata: MISSION,
    ...over,
  }
}

function dragEndEvent(taskId: string, overId: string): DragEndEvent {
  return {
    active: {
      id: taskId,
      data: { current: { type: 'task' } },
      rect: { current: { initial: null, translated: null } },
    },
    over: { id: overId, data: { current: { type: 'column', columnId: overId } } },
    delta: { x: 0, y: 0 },
    activatorEvent: new MouseEvent('mousedown'),
    collisions: null,
  } as unknown as DragEndEvent
}

function setup(task = makeTask()) {
  useBoardStore.setState({ tasks: [task] as never[], columns: COLUMNS as never[] })
  const onTaskMove = vi.fn()
  const hook = renderHook(() =>
    useBoardDnD({ projectTasks: [task] as never[], sortedColumns: COLUMNS as never[], onTaskMove })
  )
  return { hook, onTaskMove }
}

/** Drives a drag from `from` into `to` with a known snapshot origin. */
function drag(hook: ReturnType<typeof setup>['hook'], from: string, to: string) {
  act(() => {
    hook.result.current.handleDragStart({
      active: { id: 'task-1', data: { current: { type: 'task' } } },
    } as never)
    useBoardStore.getState().updateTask('task-1', { columnId: from } as never)
    hook.result.current.handleDragEnd(dragEndEvent('task-1', to))
  })
}

function launchIntent(onTaskMove: ReturnType<typeof vi.fn>) {
  return onTaskMove.mock.calls.at(-1)?.[2]
}

describe('useBoardDnD — Auto AI drop launches', () => {
  beforeEach(() => {
    useHangarUiStore.setState({
      projectId: PROJECT,
      config: { enabled: true, triggerColumnId: LAUNCH },
      missionEditorTaskId: null,
    })
  })

  it('hands the launch to the move callback when an armed mission lands in the launch column', () => {
    const { hook, onTaskMove } = setup()
    drag(hook, BACKLOG, LAUNCH)
    expect(launchIntent(onTaskMove)).toEqual({ autoRunTaskId: 'task-1' })
  })

  it('does NOT launch on a drop into an ordinary column', () => {
    const { hook, onTaskMove } = setup()
    drag(hook, LAUNCH, BACKLOG)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  it('does NOT launch a card whose auto-run is off', () => {
    const task = makeTask({ metadata: { hangar: { ...MISSION.hangar, autoRun: false } } })
    const { hook, onTaskMove } = setup(task)
    drag(hook, BACKLOG, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  it('does NOT launch a plain card', () => {
    const { hook, onTaskMove } = setup(makeTask({ metadata: {} }))
    drag(hook, BACKLOG, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  it('does NOT launch while the board has Auto AI switched off', () => {
    useHangarUiStore.setState({ config: { enabled: false, triggerColumnId: LAUNCH } })
    const { hook, onTaskMove } = setup()
    drag(hook, BACKLOG, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  // The store is board-scoped; a config left over from another board must not
  // arm drops here just because a column id happens to match.
  it('does NOT launch when the armed config belongs to a different board', () => {
    useHangarUiStore.setState({ projectId: 'some-other-project' })
    const { hook, onTaskMove } = setup()
    drag(hook, BACKLOG, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  it('does NOT re-launch when the card is re-ordered inside the launch column', () => {
    const { hook, onTaskMove } = setup(makeTask({ columnId: LAUNCH }))
    drag(hook, LAUNCH, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })
})
