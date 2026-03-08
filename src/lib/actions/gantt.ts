'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  findRows as _findRows,
  findGanttTasks as _findGanttTasks,
  createGanttTask as _createGanttTask,
  updateGanttTask as _updateGanttTask,
  deleteGanttTask as _deleteGanttTask,
  createRow as _createRow,
  updateRow as _updateRow,
  deleteRow as _deleteRow,
} from '@/lib/data/gantt'

export async function getRows(projectId: string) {
  await requireOwnership(projectId)
  return _findRows(projectId)
}

export async function getGanttTasks(projectId: string) {
  await requireOwnership(projectId)
  return _findGanttTasks(projectId)
}

export async function createGanttTask(data: {
  id: string
  projectId: string
  rowId: string
  name: string
  description?: string
  startDate: string
  endDate: string
  color: string
  progress?: number
}) {
  await requireOwnership(data.projectId)

  const task = await _createGanttTask(
    data.projectId,
    {
      rowId: data.rowId,
      name: data.name,
      description: data.description,
      startDate: data.startDate,
      endDate: data.endDate,
      color: data.color,
      progress: data.progress ?? 0,
    },
    data.id
  )

  revalidatePath(`/project/${data.projectId}`)
  return task
}

export async function updateGanttTask(
  taskId: string,
  projectId: string,
  data: {
    rowId?: string
    name?: string
    description?: string | null
    startDate?: string
    endDate?: string
    color?: string
    progress?: number
  }
) {
  await requireOwnership(projectId)
  const task = await _updateGanttTask(taskId, projectId, data)
  revalidatePath(`/project/${projectId}`)
  return task
}

export async function deleteGanttTask(taskId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteGanttTask(taskId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function createRow(data: {
  id: string
  projectId: string
  name: string
  color: string
  orderIndex: number
}) {
  await requireOwnership(data.projectId)

  const row = await _createRow(
    data.projectId,
    { name: data.name, color: data.color, orderIndex: data.orderIndex },
    data.id
  )

  revalidatePath(`/project/${data.projectId}`)
  return row
}

export async function updateRow(
  rowId: string,
  projectId: string,
  data: { name?: string; color?: string; orderIndex?: number }
) {
  await requireOwnership(projectId)
  const row = await _updateRow(rowId, projectId, data)
  revalidatePath(`/project/${projectId}`)
  return row
}

export async function deleteRow(rowId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteRow(rowId, projectId)
  revalidatePath(`/project/${projectId}`)
}
