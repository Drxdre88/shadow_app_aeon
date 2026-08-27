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

// One FIFO lane per (task, member) pill — the same discipline the checklist
// mutation queue applies. Without it a fast assign→unassign fires two
// independent persistMutation calls, each with its own ~3.6s retry ladder, and
// the server can settle them in the opposite order: the UI shows unassigned
// while the row is assigned, and the next reload silently flips the pill back.
// Toggles on *different* pills stay fully parallel — this only orders a pill
// against itself.
const pillQueue = new Map<string, Promise<void>>()
// Bumped per enqueue so a failing older write cannot roll back a pill the user
// has since toggled again.
const pillGeneration = new Map<string, number>()

function pillKey(taskId: string, userId: string): string {
  return `${taskId}::${userId}`
}

export function toggleAssigneeOptimistic(opts: {
  taskId: string
  pill: TaskAssigneePill
  // true = assign, false = unassign
  assign: boolean
  run: () => Promise<unknown>
}): Promise<void> {
  const { taskId, pill, assign, run } = opts
  // The pill lands immediately — serialization applies to the network write
  // only, never to the optimistic UI.
  applyAssigneeToggle(taskId, pill, assign)

  const key = pillKey(taskId, pill.userId)
  const generation = (pillGeneration.get(key) ?? 0) + 1
  pillGeneration.set(key, generation)

  const chained: Promise<void> = (pillQueue.get(key) ?? Promise.resolve())
    .then(() =>
      persistMutation(run, {
        // Superseded writes must not touch the store: the user's latest intent
        // is already applied and a newer write is queued behind us.
        rollback: () => {
          if (pillGeneration.get(key) === generation) revertAssigneeToggle(taskId, pill, assign)
        },
        failMessage: assign
          ? `Could not assign ${pill.name ?? 'member'} — reverted`
          : `Could not unassign ${pill.name ?? 'member'} — reverted`,
      }),
    )
    .then(() => {
      // Last one out clears the lane so the maps don't grow with the board.
      if (pillQueue.get(key) === chained) {
        pillQueue.delete(key)
        pillGeneration.delete(key)
      }
    })

  pillQueue.set(key, chained)
  return chained
}
