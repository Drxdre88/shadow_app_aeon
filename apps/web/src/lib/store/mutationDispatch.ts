'use client'

import { createBoardTask, updateBoardTask, deleteBoardTask, reorderBoardTasks } from '@/lib/actions/board'

// Serialisable description of a board write. Stored verbatim in the durable
// queue (localStorage), so args MUST be plain JSON — no closures, no Dates.
// Each carries a client-generated `id` for dedup/idempotency on replay.

export type CreateTaskArgs = {
  id: string
  projectId: string
  name: string
  description?: string
  columnId?: string
  status: string
  priority: string
  color: string
  onTimeline: boolean
  orderIndex: number
  startDate?: string
  endDate?: string
}

export type MoveUpdate = { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }

export type QueuedMutation =
  | { id: string; type: 'task.create'; args: CreateTaskArgs }
  | { id: string; type: 'task.update'; args: { taskId: string; projectId: string; updates: Record<string, unknown> } }
  | { id: string; type: 'task.delete'; args: { taskId: string; projectId: string } }
  | { id: string; type: 'task.move'; args: { projectId: string; updates: MoveUpdate[] } }

// Maps a queued record to its server action. The server writes are naturally
// idempotent (update/move/delete re-apply cleanly; create is keyed by id), so a
// record can be safely replayed if a response was lost.
export function dispatchMutation(m: QueuedMutation): Promise<unknown> {
  switch (m.type) {
    case 'task.create':
      return createBoardTask(m.args)
    case 'task.update':
      return updateBoardTask(m.args.taskId, m.args.projectId, m.args.updates as Parameters<typeof updateBoardTask>[2])
    case 'task.delete':
      return deleteBoardTask(m.args.taskId, m.args.projectId)
    case 'task.move':
      return reorderBoardTasks(m.args.projectId, m.args.updates)
  }
}

// A replayed mutation that already landed the first time (its response was
// lost) resurfaces as a duplicate/precondition error. That is success, not
// failure — the intended state is already on the server.
export function isAlreadyApplied(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /duplicate key|already exists|unique constraint/i.test(err.message)
}
