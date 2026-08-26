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

  it('virtual pills keep their kind/color through the optimistic path', () => {
    void toggleAssigneeOptimistic({ taskId: TASK_ID, pill: pillV, assign: true, run: () => new Promise(() => {}) })
    const [pill] = currentAssignees(TASK_ID)
    expect(pill.kind).toBe('virtual')
    expect(pill.color).toBe('blue')
  })
})
