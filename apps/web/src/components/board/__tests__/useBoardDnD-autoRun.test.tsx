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

/**
 * Mounts the hook over `tasks`. The drag snapshot is built from this list at
 * handleDragStart, so a card's STARTING column must be set here — mutating
 * the store mid-drag would not change the recorded provenance.
 */
function setup(tasks = [makeTask()]) {
  useBoardStore.setState({ tasks: tasks as never[], columns: COLUMNS as never[] })
  const onTaskMove = vi.fn()
  const hook = renderHook(() =>
    useBoardDnD({ projectTasks: tasks as never[], sortedColumns: COLUMNS as never[], onTaskMove })
  )
  return { hook, onTaskMove }
}

/** Drives a real drag of task-1 onto `overId` (a column or a sibling card). */
function drag(hook: ReturnType<typeof setup>['hook'], overId: string) {
  act(() => {
    hook.result.current.handleDragStart({
      active: { id: 'task-1', data: { current: { type: 'task' } } },
    } as never)
    hook.result.current.handleDragEnd(dragEndEvent('task-1', overId))
  })
}

/**
 * The launch intent from the last move — asserting the move ACTUALLY
 * happened first. Without that, a negative case passes for the wrong reason
 * (a no-op drop never calls onTaskMove at all, so the intent is undefined
 * even if the arming logic were broken).
 */
function launchIntent(onTaskMove: ReturnType<typeof vi.fn>) {
  expect(onTaskMove).toHaveBeenCalled()
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
    drag(hook, LAUNCH)
    expect(launchIntent(onTaskMove)).toMatchObject({ autoRunTaskId: 'task-1' })
  })

  // The launch must be DEFERRED, not performed here: it rides the move
  // mutation so a rolled-back move cannot leave a live agent behind.
  it('never launches inline — it only hands over an intent', () => {
    const { hook, onTaskMove } = setup()
    drag(hook, LAUNCH)
    expect(typeof launchIntent(onTaskMove).armedAt).toBe('number')
    // The hook exposes no launch capability of its own.
    expect(Object.keys(hook.result.current)).not.toContain('launchMission')
  })

  it('does NOT launch on a drop into an ordinary column', () => {
    const { hook, onTaskMove } = setup([makeTask({ columnId: LAUNCH })])
    drag(hook, BACKLOG)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  it('does NOT launch a card whose auto-run is off', () => {
    const { hook, onTaskMove } = setup([makeTask({ metadata: { hangar: { ...MISSION.hangar, autoRun: false } } })])
    drag(hook, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  it('does NOT launch a plain card', () => {
    const { hook, onTaskMove } = setup([makeTask({ metadata: {} })])
    drag(hook, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  it('does NOT launch while the board has Auto AI switched off', () => {
    useHangarUiStore.setState({ config: { enabled: false, triggerColumnId: LAUNCH } })
    const { hook, onTaskMove } = setup()
    drag(hook, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  // The store is board-scoped; a config left over from another board must not
  // arm drops here just because a column id happens to match.
  it('does NOT launch when the armed config belongs to a different board', () => {
    useHangarUiStore.setState({ projectId: 'some-other-project' })
    const { hook, onTaskMove } = setup()
    drag(hook, LAUNCH)
    expect(launchIntent(onTaskMove)).toBeUndefined()
  })

  // Re-dropping inside the launch column must never re-fire the mission.
  // Ordering within a column is decided from layout rects, which jsdom does
  // not produce, so this asserts the invariant that holds either way: NO call
  // to onTaskMove ever carries a launch intent. (The predicate-level proof
  // for same-column drops lives in autoRun.test.ts.)
  it('does NOT re-launch when the card is dropped back into the launch column', () => {
    const { hook, onTaskMove } = setup([
      makeTask({ id: 'task-1', columnId: LAUNCH, orderIndex: 0 }),
      makeTask({ id: 'task-2', columnId: LAUNCH, orderIndex: 1, metadata: {} }),
    ])
    drag(hook, LAUNCH)
    for (const call of onTaskMove.mock.calls) expect(call[2]).toBeUndefined()
  })
})
