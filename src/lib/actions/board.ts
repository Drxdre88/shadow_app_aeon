'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import { createTaskSchema, updateTaskSchema, reorderTaskEntrySchema } from '@/lib/data/validators'
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
import { findColumns as _findColumns, createDefaultColumns as _createDefaultColumns } from '@/lib/data/columns'
import { findLabels as _findLabels, findTaskLabels as _findTaskLabels } from '@/lib/data/labels'
import { findDependencies as _findDependencies } from '@/lib/data/dependencies'
import { findChecklistSummaries as _findChecklistSummaries } from '@/lib/data/checklist'

export async function loadBoardData(projectId: string) {
  await requireOwnership(projectId)
  await _createDefaultColumns(projectId)
  const [tasks, columns, labels, taskLabels, dependencies, checklistSummaries] = await Promise.all([
    _findTasks(projectId),
    _findColumns(projectId),
    _findLabels(projectId),
    _findTaskLabels(projectId),
    _findDependencies(projectId),
    _findChecklistSummaries(projectId),
  ])
  return { tasks, columns, labels, taskLabels, dependencies, checklistSummaries }
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
  orderIndex: number
  startDate?: string
  endDate?: string
}) {
  await requireOwnership(data.projectId)

  const parsed = createTaskSchema.parse({
    name: data.name,
    description: data.description,
    columnId: data.columnId,
    status: data.status,
    priority: data.priority,
    color: data.color,
    onTimeline: data.onTimeline,
    size: data.size,
    orderIndex: data.orderIndex,
    startDate: data.startDate,
    endDate: data.endDate,
  })

  const task = await _createTask(data.projectId, parsed, data.id)

  emitActivity(data.projectId, 'task', task.id, 'created', data.name).catch(() => {})

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
    orderIndex?: number
    startDate?: string | null
    endDate?: string | null
  }
) {
  await requireOwnership(projectId)

  const parsed = updateTaskSchema.parse(data)

  const task = await _updateTask(taskId, projectId, parsed)

  if (parsed.status === 'done') {
    emitActivity(projectId, 'task', taskId, 'completed', task?.name).catch(() => {})
  } else if (parsed.columnId) {
    emitActivity(projectId, 'task', taskId, 'moved', task?.name, { toColumnId: parsed.columnId }).catch(() => {})
  } else {
    emitActivity(projectId, 'task', taskId, 'updated', task?.name).catch(() => {})
  }

  if (parsed.status) {
    syncBoardStatusToGantt(taskId, parsed.status).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
  return task
}

export async function deleteBoardTask(taskId: string, projectId: string) {
  await requireOwnership(projectId)
  const taskToDelete = await _findTaskById(taskId, projectId)
  emitActivity(projectId, 'task', taskId, 'deleted', taskToDelete?.name).catch(() => {})
  await deleteLinkedGanttTask(taskId)
  await _deleteTask(taskId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function reorderBoardTasks(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[]
) {
  await requireOwnership(projectId)
  const parsed = updates.map(u => reorderTaskEntrySchema.parse(u))
  await _reorderTasks(projectId, parsed)
  const moves = updates.filter(u => u.columnId)
  for (const move of moves) {
    emitActivity(projectId, 'task', move.id, 'moved', move.name, { toColumnId: move.columnId }).catch(() => {})
  }
  for (const u of updates) {
    if (u.status === 'done') {
      emitActivity(projectId, 'task', u.id, 'completed', u.name, { via: 'drag' }).catch(() => {})
    }
  }
  revalidatePath(`/project/${projectId}`)
}

export async function archiveBoardTask(taskId: string, projectId: string) {
  await requireOwnership(projectId)
  const task = await _archiveTask(taskId, projectId)
  if (task) {
    emitActivity(projectId, 'task', taskId, 'archived', task.name).catch(() => {})
  }
  revalidatePath(`/project/${projectId}`)
  return task
}

export async function restoreBoardTask(taskId: string, projectId: string) {
  await requireOwnership(projectId)
  const task = await _restoreTask(taskId, projectId)
  if (task) {
    emitActivity(projectId, 'task', taskId, 'restored', task.name).catch(() => {})
  }
  revalidatePath(`/project/${projectId}`)
  return task
}

export async function getArchivedTasks(projectId: string) {
  await requireOwnership(projectId)
  return _findArchivedTasks(projectId)
}

export async function archiveColumnTasks(projectId: string, columnId: string) {
  await requireOwnership(projectId)
  const allTasks = await _findTasks(projectId)
  const columnTaskIds = allTasks.filter(t => t.columnId === columnId).map(t => t.id)
  const archived = await _archiveTasksBatch(projectId, columnTaskIds)
  for (const task of archived) {
    emitActivity(projectId, 'task', task.id, 'archived', task.name).catch(() => {})
  }
  revalidatePath(`/project/${projectId}`)
  return archived
}
