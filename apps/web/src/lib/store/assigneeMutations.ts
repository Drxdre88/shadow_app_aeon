'use client'

import { useBoardStore, type TaskAssigneePill } from './boardStore'
import { persistMutation } from './persistMutation'

// Optimistic assignment toggle — the Trello feel. The pill lands in (or
// leaves) the store synchronously; the server write rides the durable
// persistMutation pipeline (retry ladder over Neon cold starts) in the
// background and only a terminal failure reverts the pill.

export function currentAssignees(taskId: string): TaskAssigneePill[] {
  return useBoardStore.getState().assigneesByTask[taskId] ?? []
}

export function applyAssigneeToggle(taskId: string, pill: TaskAssigneePill, assign: boolean): void {
  const list = currentAssignees(taskId)
  const without = list.filter((a) => a.userId !== pill.userId)
  const next = assign ? [...without, pill] : without
  useBoardStore.getState().setTaskAssignees(taskId, next)
}

// Reverts ONLY this pill against the *current* list — a snapshot restore
// would clobber other toggles the user made while this write was in flight.
function revertAssigneeToggle(taskId: string, pill: TaskAssigneePill, assigned: boolean): void {
  applyAssigneeToggle(taskId, pill, !assigned)
}

export function toggleAssigneeOptimistic(opts: {
  taskId: string
  pill: TaskAssigneePill
  // true = assign, false = unassign
  assign: boolean
  run: () => Promise<unknown>
}): Promise<void> {
  const { taskId, pill, assign, run } = opts
  applyAssigneeToggle(taskId, pill, assign)
  return persistMutation(run, {
    rollback: () => revertAssigneeToggle(taskId, pill, assign),
    failMessage: assign
      ? `Could not assign ${pill.name ?? 'member'} — reverted`
      : `Could not unassign ${pill.name ?? 'member'} — reverted`,
  })
}
