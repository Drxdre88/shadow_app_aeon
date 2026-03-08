'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  findTasks as _findTasks,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  reorderTasks as _reorderTasks,
} from '@/lib/data/tasks'

export async function getBoardTasks(projectId: string) {
  await requireOwnership(projectId)
  return _findTasks(projectId)
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
  orderIndex: number
  startDate?: string
  endDate?: string
}) {
  await requireOwnership(data.projectId)

  const task = await _createTask(
    data.projectId,
    {
      name: data.name,
      description: data.description,
      columnId: data.columnId,
      status: data.status as 'todo' | 'in-progress' | 'done',
      priority: data.priority as 'low' | 'medium' | 'high' | 'urgent',
      color: data.color,
      onTimeline: data.onTimeline,
      orderIndex: data.orderIndex,
      startDate: data.startDate,
      endDate: data.endDate,
    },
    data.id
  )

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
    orderIndex?: number
    startDate?: string | null
    endDate?: string | null
  }
) {
  await requireOwnership(projectId)

  const task = await _updateTask(taskId, projectId, {
    name: data.name,
    description: data.description,
    columnId: data.columnId,
    status: data.status as 'todo' | 'in-progress' | 'done' | undefined,
    priority: data.priority as 'low' | 'medium' | 'high' | 'urgent' | undefined,
    color: data.color,
    onTimeline: data.onTimeline,
    orderIndex: data.orderIndex,
    startDate: data.startDate,
    endDate: data.endDate,
  })

  revalidatePath(`/project/${projectId}`)
  return task
}

export async function deleteBoardTask(taskId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteTask(taskId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function reorderBoardTasks(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string; columnId?: string }[]
) {
  await requireOwnership(projectId)
  await _reorderTasks(projectId, updates)
  revalidatePath(`/project/${projectId}`)
}
