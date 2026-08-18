'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership, requireEditor } from './helpers'
import { createTaskSchema, updateTaskSchema, reorderTaskEntrySchema } from '@/lib/data/validators'
import { checkStorageLimit } from '@/lib/data/storage'
import {
  findTasks as _findTasks,
  findTaskById as _findTaskById,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  reorderTasks as _reorderTasks,
  archiveTask as _archiveTask,
  restoreTask as _restoreTask,
  archiveTasksBatch as _archiveTasksBatch,
  findArchivedTasks as _findArchivedTasks,
} from '@/lib/data/tasks'
import { syncBoardStatusToGantt, deleteLinkedGanttTask } from '@/lib/data/bridge'
import { emitActivity } from '@/lib/data/activity'
import { captureBoardEvent } from '@/lib/kairos/auto-capture'
import { findColumns as _findColumns, createDefaultColumns as _createDefaultColumns } from '@/lib/data/columns'
import { findLabels as _findLabels, findTaskLabels as _findTaskLabels, setTaskLabels as _setTaskLabels } from '@/lib/data/labels'
import { findDependencies as _findDependencies } from '@/lib/data/dependencies'
import { findChecklistSummariesAndPreviews as _findChecklistSummariesAndPreviews, findChecklistItems as _findChecklistItems, createChecklistItemsBatch as _createChecklistItemsBatch } from '@/lib/data/checklist'
import { getAssigneesForProject as _getAssigneesForProject } from '@/lib/data/assignees'

export async function loadBoardData(projectId: string) {
  await requireOwnership(projectId)
  await _createDefaultColumns(projectId)
  const [tasks, columns, labels, taskLabels, dependencies, { summaries: checklistSummaries, previews: checklistPreviews }, assignees] = await Promise.all([
    _findTasks(projectId, undefined, 2000),
    _findColumns(projectId),
    _findLabels(projectId),
    _findTaskLabels(projectId),
    _findDependencies(projectId),
    _findChecklistSummariesAndPreviews(projectId),
    _getAssigneesForProject(projectId),
  ])
  return { tasks, columns, labels, taskLabels, dependencies, checklistSummaries, checklistPreviews, assignees }
}

export async function createBoardTask(data: {
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
}) {
  const userId = await requireEditor(data.projectId)

  const storageCheck = await checkStorageLimit(userId, 'tasks')
  if (!storageCheck.allowed) {
    throw new Error(`Task limit reached (${storageCheck.limit}). Remove unused tasks to continue.`)
  }

  const parsed = createTaskSchema.parse({
    name: data.name,
    description: data.description,
    columnId: data.columnId,
    status: data.status,
    priority: data.priority,
    color: data.color,
    onTimeline: data.onTimeline,
    size: data.size,
    progress: data.progress,
    orderIndex: data.orderIndex,
    startDate: data.startDate,
    endDate: data.endDate,
  })

  const task = await _createTask(data.projectId, parsed, data.id)

  // Labels live in their own join table, so a card created with labels already
  // picked (quick-add, delete-undo) has to write them explicitly or they are
  // silently lost on the next board load.
  if (data.labels && data.labels.length > 0) {
    await _setTaskLabels(task.id, data.labels, data.projectId)
  }

  emitActivity(data.projectId, 'task', task.id, 'created', data.name, undefined, userId).catch(() => {})
  captureBoardEvent({
    userId, projectId: data.projectId, taskId: task.id, taskName: data.name, action: 'created',
  }).catch(() => {})

  revalidatePath(`/project/${data.projectId}`)
  return task
}

export async function updateBoardTask(
  taskId: string,
  projectId: string,
  data: {
    name?: string
    description?: string | null
    columnId?: string
    status?: string
    priority?: string
    color?: string
    onTimeline?: boolean
    size?: number | null
    progress?: number | null
    orderIndex?: number
    startDate?: string | null
    endDate?: string | null
  }
) {
  const userId = await requireEditor(projectId)

  const parsed = updateTaskSchema.parse(data)

  const existing = parsed.columnId ? await _findTaskById(taskId, projectId) : null

  const task = await _updateTask(taskId, projectId, parsed)

  if (parsed.status === 'done') {
    emitActivity(projectId, 'task', taskId, 'completed', task?.name, undefined, userId).catch(() => {})
    captureBoardEvent({ userId, projectId, taskId, taskName: task?.name, action: 'completed' }).catch(() => {})
  } else if (parsed.columnId) {
    emitActivity(projectId, 'task', taskId, 'moved', task?.name, { fromColumnId: existing?.columnId, toColumnId: parsed.columnId }, userId).catch(() => {})
    captureBoardEvent({
      userId, projectId, taskId, taskName: task?.name, action: 'moved',
      metadata: { fromColumnId: existing?.columnId, toColumnId: parsed.columnId },
    }).catch(() => {})
  } else {
    emitActivity(projectId, 'task', taskId, 'updated', task?.name, undefined, userId).catch(() => {})
    captureBoardEvent({ userId, projectId, taskId, taskName: task?.name, action: 'updated' }).catch(() => {})
  }

  if (parsed.status) {
    syncBoardStatusToGantt(taskId, parsed.status).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
  return task
}

export async function deleteBoardTask(taskId: string, projectId: string) {
  const userId = await requireEditor(projectId)
  const taskToDelete = await _findTaskById(taskId, projectId)
  emitActivity(projectId, 'task', taskId, 'deleted', taskToDelete?.name, undefined, userId).catch(() => {})
  captureBoardEvent({ userId, projectId, taskId, taskName: taskToDelete?.name, action: 'deleted' }).catch(() => {})
  await deleteLinkedGanttTask(taskId)
  await _deleteTask(taskId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function reorderBoardTasks(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[]
) {
  const userId = await requireEditor(projectId)
  const movingIds = updates.filter(u => u.columnId).map(u => u.id)
  const previousColumns = new Map<string, string | null>()
  if (movingIds.length > 0) {
    const allTasks = await _findTasks(projectId)
    for (const t of allTasks) {
      if (movingIds.includes(t.id)) {
        previousColumns.set(t.id, t.columnId)
      }
    }
  }
  const parsed = updates.map(u => reorderTaskEntrySchema.parse(u))
  await _reorderTasks(projectId, parsed)
  const moves = updates.filter(u => u.columnId)
  for (const move of moves) {
    emitActivity(projectId, 'task', move.id, 'moved', move.name, { fromColumnId: previousColumns.get(move.id) ?? null, toColumnId: move.columnId }, userId).catch(() => {})
    captureBoardEvent({
      userId, projectId, taskId: move.id, taskName: move.name, action: 'moved',
      metadata: { fromColumnId: previousColumns.get(move.id) ?? null, toColumnId: move.columnId, via: 'drag' },
    }).catch(() => {})
  }

  const doneUpdates = updates.filter(u => u.status === 'done')
  for (const u of doneUpdates) {
    emitActivity(projectId, 'task', u.id, 'completed', u.name, { via: 'drag' }, userId).catch(() => {})
    captureBoardEvent({
      userId, projectId, taskId: u.id, taskName: u.name, action: 'completed',
      metadata: { via: 'drag' },
    }).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
}

export async function archiveBoardTask(taskId: string, projectId: string) {
  const userId = await requireEditor(projectId)
  const task = await _archiveTask(taskId, projectId)
  if (task) {
    emitActivity(projectId, 'task', taskId, 'archived', task.name, undefined, userId).catch(() => {})
  }
  revalidatePath(`/project/${projectId}`)
  return task
}

export async function restoreBoardTask(taskId: string, projectId: string) {
  const userId = await requireEditor(projectId)
  const task = await _restoreTask(taskId, projectId)
  if (task) {
    emitActivity(projectId, 'task', taskId, 'restored', task.name, undefined, userId).catch(() => {})
  }
  revalidatePath(`/project/${projectId}`)
  return task
}

export async function getArchivedTasks(projectId: string) {
  await requireOwnership(projectId)
  return _findArchivedTasks(projectId)
}

export async function archiveColumnTasks(projectId: string, columnId: string) {
  const userId = await requireEditor(projectId)
  const allTasks = await _findTasks(projectId)
  const columnTaskIds = allTasks.filter(t => t.columnId === columnId).map(t => t.id)
  const archived = await _archiveTasksBatch(projectId, columnTaskIds)
  for (const task of archived) {
    emitActivity(projectId, 'task', task.id, 'archived', task.name, undefined, userId).catch(() => {})
  }
  revalidatePath(`/project/${projectId}`)
  return archived
}

export async function duplicateBoardTask(
  sourceTaskId: string,
  projectId: string,
  newTaskId: string
) {
  const userId = await requireEditor(projectId)

  const source = await _findTaskById(sourceTaskId, projectId)
  if (!source) throw new Error('Source task not found')

  const allTasks = await _findTasks(projectId)
  const columnTasks = allTasks.filter(t => t.columnId === source.columnId)
  const maxOrder = columnTasks.reduce((max, t) => Math.max(max, t.orderIndex), -1)

  const parsed = createTaskSchema.parse({
    name: `Copy of ${source.name}`,
    description: source.description ?? undefined,
    columnId: source.columnId ?? undefined,
    status: source.status,
    priority: source.priority,
    color: source.color,
    onTimeline: source.onTimeline,
    size: source.size,
    progress: source.progress,
    orderIndex: maxOrder + 1,
  })

  const newTask = await _createTask(projectId, parsed, newTaskId)

  const allTaskLabels = await _findTaskLabels(projectId)
  const sourceLabelIds = allTaskLabels
    .filter(tl => tl.taskId === sourceTaskId)
    .map(tl => tl.labelId)
  if (sourceLabelIds.length > 0) {
    await _setTaskLabels(newTaskId, sourceLabelIds, projectId)
  }

  const checklistItems = await _findChecklistItems(sourceTaskId, projectId)
  if (checklistItems.length > 0) {
    await _createChecklistItemsBatch(
      newTaskId,
      checklistItems.map(item => ({ title: item.title, groupName: item.groupName ?? undefined }))
    )
  }

  emitActivity(projectId, 'task', newTaskId, 'created', newTask.name, { duplicatedFrom: sourceTaskId }, userId).catch(() => {})

  revalidatePath(`/project/${projectId}`)
  return newTask
}
