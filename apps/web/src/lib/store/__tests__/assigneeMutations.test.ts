import { describe, it, expect, beforeEach, vi } from 'vitest'

// Instant-assign contract: the pill lands in the store synchronously (before
// the server responds), survives success, reverts on a hard failure — and a
// failed toggle must not clobber other toggles made while it was in flight.

vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

import { useBoardStore, type TaskAssigneePill } from '../boardStore'
import { toggleAssigneeOptimistic, applyAssigneeToggle, currentAssignees } from '../assigneeMutations'
import { toast } from '@/components/ui/Toast'

const TASK_ID = 'task-1'
const pillA: TaskAssigneePill = { userId: 'user-a', name: 'Alice', image: null }
const pillV: TaskAssigneePill = { userId: 'vm-1', name: 'Ghost', image: null, kind: 'virtual', color: 'blue' }

// A rejection persistMutation treats as terminal (non-transient) so tests
// don't sit through the retry backoff ladder.
const hardFailure = () => Promise.reject(new Error('invalid input'))

// Drain the microtask queue so queued writes get a chance to dispatch.
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  useBoardStore.setState({ assigneesByTask: {}, saveStatus: 'idle' })
})

describe('applyAssigneeToggle', () => {
  it('adds and removes a pill', () => {
    applyAssigneeToggle(TASK_ID, pillA, true)
    expect(currentAssignees(TASK_ID)).toEqual([pillA])
    applyAssigneeToggle(TASK_ID, pillA, false)
    expect(currentAssignees(TASK_ID)).toEqual([])
  })

  it('never duplicates a pill assigned twice', () => {
    applyAssigneeToggle(TASK_ID, pillA, true)
    applyAssigneeToggle(TASK_ID, pillA, true)
    expect(currentAssignees(TASK_ID)).toHaveLength(1)
  })
})

describe('toggleAssigneeOptimistic', () => {
  it('applies the pill synchronously, before the server responds', () => {
    let resolveRun: (v: unknown) => void = () => {}
    const pending = new Promise((r) => { resolveRun = r })

    void toggleAssigneeOptimistic({ taskId: TASK_ID, pill: pillA, assign: true, run: () => pending })

    // Immediately visible — no await.
    expect(currentAssignees(TASK_ID)).toEqual([pillA])
    resolveRun(null)
  })

  it('keeps the pill after the server confirms', async () => {
    await toggleAssigneeOptimistic({ taskId: TASK_ID, pill: pillA, assign: true, run: () => Promise.resolve(null) })
    expect(currentAssignees(TASK_ID)).toEqual([pillA])
    expect(toast).not.toHaveBeenCalled()
  })

  it('rolls the pill back on a terminal failure and tells the user', async () => {
    await toggleAssigneeOptimistic({ taskId: TASK_ID, pill: pillA, assign: true, run: hardFailure })
    expect(currentAssignees(TASK_ID)).toEqual([])
    expect(toast).toHaveBeenCalled()
  })

  it('restores the pill when an unassign fails', async () => {
    useBoardStore.getState().setTaskAssignees(TASK_ID, [pillA, pillV])

    await toggleAssigneeOptimistic({ taskId: TASK_ID, pill: pillV, assign: false, run: hardFailure })

    const ids = currentAssignees(TASK_ID).map((p) => p.userId)
    expect(ids).toContain('vm-1')
    expect(ids).toContain('user-a')
  })

  it('a failed toggle reverts ONLY its own pill, not later toggles', async () => {
    let rejectA: (e: Error) => void = () => {}
    const pendingA = new Promise((_r, rej) => { rejectA = rej })

    const done = toggleAssigneeOptimistic({ taskId: TASK_ID, pill: pillA, assign: true, run: () => pendingA })
    // While A is in flight the user assigns the virtual member too.
    await toggleAssigneeOptimistic({ taskId: TASK_ID, pill: pillV, assign: true, run: () => Promise.resolve(null) })

    rejectA(new Error('invalid input'))
    await done

    const ids = currentAssignees(TASK_ID).map((p) => p.userId)
    expect(ids).toEqual(['vm-1'])
  })

  // Serialization: two writes on the SAME pill must reach the server in click
  // order. Independent persistMutation calls (each with its own retry ladder)
  // could otherwise settle backwards and leave the row contradicting the UI.
  it('serializes repeat toggles on the same pill', async () => {
    const order: string[] = []
    let releaseFirst: (v: unknown) => void = () => {}
    const first = new Promise((r) => { releaseFirst = r })

    const assign = toggleAssigneeOptimistic({
      taskId: TASK_ID,
      pill: pillA,
      assign: true,
      run: () => { order.push('assign:start'); return first.then(() => order.push('assign:end')) },
    })
    const unassign = toggleAssigneeOptimistic({
      taskId: TASK_ID,
      pill: pillA,
      assign: false,
      run: () => { order.push('unassign:start'); return Promise.resolve(null) },
    })

    await tick()
    // The second write has NOT been dispatched while the first is in flight...
    expect(order).toEqual(['assign:start'])
    // ...but the UI already reflects the latest click.
    expect(currentAssignees(TASK_ID)).toEqual([])

    releaseFirst(null)
    await Promise.all([assign, unassign])

    expect(order).toEqual(['assign:start', 'assign:end', 'unassign:start'])
    expect(currentAssignees(TASK_ID)).toEqual([])
  })

  it('lets toggles on different pills run in parallel', async () => {
    const started: string[] = []
    let releaseA: (v: unknown) => void = () => {}
    let releaseV: (v: unknown) => void = () => {}
    const a = new Promise((r) => { releaseA = r })
    const v = new Promise((r) => { releaseV = r })

    const doneA = toggleAssigneeOptimistic({
      taskId: TASK_ID, pill: pillA, assign: true,
      run: () => { started.push('a'); return a },
    })
    const doneV = toggleAssigneeOptimistic({
      taskId: TASK_ID, pill: pillV, assign: true,
      run: () => { started.push('v'); return v },
    })

    await tick()
    // Neither has settled — both are still dispatched: lanes are per-pill.
    expect(started).toEqual(['a', 'v'])

    // Drain both lanes so the module-level queues don't leak into later tests.
    releaseA(null)
    releaseV(null)
    await Promise.all([doneA, doneV])
  })

  it('a superseded write does not roll back the pill the user has since re-toggled', async () => {
    let rejectFirst: (e: Error) => void = () => {}
    const first = new Promise((_r, rej) => { rejectFirst = rej })

    const assign = toggleAssigneeOptimistic({ taskId: TASK_ID, pill: pillA, assign: true, run: () => first })
    // User immediately unassigns again — this is now the intent of record.
    const unassign = toggleAssigneeOptimistic({
      taskId: TASK_ID, pill: pillA, assign: false, run: () => Promise.resolve(null),
    })

    await tick() // let the first write attach its handler before it blows up
    rejectFirst(new Error('invalid input'))
    await Promise.all([assign, unassign])

    // The stale assign's rollback would have re-added the pill.
    expect(currentAssignees(TASK_ID)).toEqual([])
  })

  it('virtual pills keep their kind/color through the optimistic path', () => {
    // Its own task id: the write never settles, so its lane stays occupied for
    // the rest of the file. Sharing TASK_ID here would silently stall every
    // later toggle of this pill.
    void toggleAssigneeOptimistic({ taskId: 'task-kind', pill: pillV, assign: true, run: () => new Promise(() => {}) })
    const [pill] = currentAssignees('task-kind')
    expect(pill.kind).toBe('virtual')
    expect(pill.color).toBe('blue')
  })
})

// The in-flight guard, stated as a contract rather than an implementation
// detail. The bug it prevents: two independent writes on one pill, each with
// its own ~3.6s retry ladder, settling in the opposite order — the row ends up
// contradicting the UI and the next reload silently flips the pill back.
describe('per-pill write serialization', () => {
  // pillQueue lives at module scope, so a lane is only truly isolated when the
  // task id is unique. Every test here mints its own.
  let taskSeq = 0
  const freshTask = () => `ser-task-${++taskSeq}`

  it('sends a rapid assign→unassign in click order, so the server never ends ambiguous', async () => {
    const task = freshTask()
    const order: string[] = []
    let releaseAssign: (v: unknown) => void = () => {}
    const assignInFlight = new Promise((r) => { releaseAssign = r })

    const assign = toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: true,
      run: () => { order.push('assign'); return assignInFlight },
    })
    const unassign = toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: false,
      run: () => { order.push('unassign'); return Promise.resolve(null) },
    })

    await tick()
    // Contract: the second write is NOT in flight yet.
    expect(order).toEqual(['assign'])

    releaseAssign(null)
    await Promise.all([assign, unassign])

    // Contract: the LAST write the server saw is the user's last click, so the
    // persisted row agrees with the pill on screen.
    expect(order).toEqual(['assign', 'unassign'])
    expect(order.at(-1)).toBe('unassign')
    expect(currentAssignees(task)).toEqual([])
  })

  it('keeps strict order across three rapid toggles', async () => {
    const task = freshTask()
    const order: string[] = []
    let releaseFirst: (v: unknown) => void = () => {}
    const first = new Promise((r) => { releaseFirst = r })

    const a = toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: true,
      run: () => { order.push('assign#1'); return first },
    })
    const b = toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: false,
      run: () => { order.push('unassign#2'); return Promise.resolve(null) },
    })
    const c = toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: true,
      run: () => { order.push('assign#3'); return Promise.resolve(null) },
    })

    // UI already shows the third click before any write past the first ran.
    expect(currentAssignees(task)).toEqual([pillA])
    await tick()
    expect(order).toEqual(['assign#1'])

    releaseFirst(null)
    await Promise.all([a, b, c])

    expect(order).toEqual(['assign#1', 'unassign#2', 'assign#3'])
    expect(currentAssignees(task)).toEqual([pillA])
  })

  it('the same member on two different cards writes in parallel — lanes are per (task, member)', async () => {
    const taskOne = freshTask()
    const taskTwo = freshTask()
    const started: string[] = []
    let release1: (v: unknown) => void = () => {}
    let release2: (v: unknown) => void = () => {}
    const inFlight1 = new Promise((r) => { release1 = r })
    const inFlight2 = new Promise((r) => { release2 = r })

    const one = toggleAssigneeOptimistic({
      taskId: taskOne, pill: pillA, assign: true,
      run: () => { started.push('one'); return inFlight1 },
    })
    const two = toggleAssigneeOptimistic({
      taskId: taskTwo, pill: pillA, assign: true,
      run: () => { started.push('two'); return inFlight2 },
    })

    await tick()
    // Neither is blocked on the other: assigning one person across a board
    // must not serialize into a queue the length of the board.
    expect(started).toEqual(['one', 'two'])
    expect(currentAssignees(taskOne)).toEqual([pillA])
    expect(currentAssignees(taskTwo)).toEqual([pillA])

    release1(null)
    release2(null)
    await Promise.all([one, two])
  })

  it('different pills on the same card stay independent', async () => {
    const task = freshTask()
    const started: string[] = []
    let releaseA: (v: unknown) => void = () => {}
    const blocked = new Promise((r) => { releaseA = r })

    const a = toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: true,
      run: () => { started.push('a'); return blocked },
    })
    const v = toggleAssigneeOptimistic({
      taskId: task, pill: pillV, assign: true,
      run: () => { started.push('v'); return Promise.resolve(null) },
    })

    await v
    // pillV finished while pillA is still hanging — no cross-pill head-of-line
    // blocking.
    expect(started).toEqual(['a', 'v'])
    expect(currentAssignees(task).map((p) => p.userId)).toContain('vm-1')

    releaseA(null)
    await a
  })

  it('a terminal failure does not wedge the lane — the next toggle still dispatches', async () => {
    const task = freshTask()
    const order: string[] = []

    await toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: true,
      run: () => { order.push('failed'); return Promise.reject(new Error('invalid input')) },
    })
    expect(currentAssignees(task)).toEqual([])

    await toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: true,
      run: () => { order.push('retry'); return Promise.resolve(null) },
    })

    expect(order).toEqual(['failed', 'retry'])
    expect(currentAssignees(task)).toEqual([pillA])
  })

  it('a failure mid-queue still lets the queued write through, and the last intent wins', async () => {
    const task = freshTask()
    const order: string[] = []
    let rejectFirst: (e: Error) => void = () => {}
    const first = new Promise((_r, rej) => { rejectFirst = rej })

    const a = toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: true,
      run: () => { order.push('assign'); return first },
    })
    const b = toggleAssigneeOptimistic({
      taskId: task, pill: pillA, assign: false,
      run: () => { order.push('unassign'); return Promise.resolve(null) },
    })

    await tick()
    rejectFirst(new Error('invalid input'))
    await Promise.all([a, b])

    expect(order).toEqual(['assign', 'unassign'])
    // The stale assign's rollback must not resurrect the pill the user
    // has since removed.
    expect(currentAssignees(task)).toEqual([])
  })
})
