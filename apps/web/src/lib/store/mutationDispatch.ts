'use client'

import { createBoardTask, updateBoardTask, deleteBoardTask, reorderBoardTasks } from '@/lib/actions/board'
import {
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  renameChecklistGroup,
  reorderChecklistItems,
  deleteChecklistGroup,
} from '@/lib/actions/checklist'

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
  size?: number | null
  progress?: number | null
  labels?: string[]
  orderIndex: number
  startDate?: string
  endDate?: string
}

export type MoveUpdate = { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }

export type ChecklistItemUpdates = {
  title?: string
  completed?: boolean
  state?: string
  status?: string | null
  startDate?: string
  endDate?: string
}

export type QueuedMutation =
  | { id: string; type: 'task.create'; args: CreateTaskArgs }
  | { id: string; type: 'task.update'; args: { taskId: string; projectId: string; updates: Record<string, unknown> } }
  | { id: string; type: 'task.delete'; args: { taskId: string; projectId: string } }
  | { id: string; type: 'task.move'; args: { projectId: string; updates: MoveUpdate[] } }
  | { id: string; type: 'checklist.create'; args: { itemId: string; taskId: string; projectId: string; title: string; groupName: string } }
  | { id: string; type: 'checklist.update'; args: { itemId: string; taskId: string; projectId: string; updates: ChecklistItemUpdates } }
  | { id: string; type: 'checklist.delete'; args: { itemId: string; taskId: string; projectId: string } }
  | { id: string; type: 'checklist.reorder'; args: { taskId: string; projectId: string; updates: { id: string; orderIndex: number; groupName?: string }[] } }
  | { id: string; type: 'checklist.groupRename'; args: { taskId: string; projectId: string; oldName: string; newName: string } }
  | { id: string; type: 'checklist.groupDelete'; args: { taskId: string; projectId: string; groupName: string } }

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
    case 'checklist.create':
      return createChecklistItem({
        id: m.args.itemId,
        taskId: m.args.taskId,
        projectId: m.args.projectId,
        title: m.args.title,
        groupName: m.args.groupName,
      })
    case 'checklist.update':
      return updateChecklistItem(m.args.itemId, m.args.taskId, m.args.projectId, m.args.updates)
    case 'checklist.delete':
      return deleteChecklistItem(m.args.itemId, m.args.taskId, m.args.projectId)
    case 'checklist.reorder':
      return reorderChecklistItems(m.args.taskId, m.args.projectId, m.args.updates)
    case 'checklist.groupRename':
      return renameChecklistGroup(m.args.taskId, m.args.projectId, m.args.oldName, m.args.newName)
    case 'checklist.groupDelete':
      return deleteChecklistGroup(m.args.taskId, m.args.projectId, m.args.groupName)
  }
}

// A replayed mutation that already landed the first time (its response was
// lost) resurfaces as a duplicate/precondition error. That is success, not
// failure — the intended state is already on the server.
export function isAlreadyApplied(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /duplicate key|already exists|unique constraint/i.test(err.message)
}
