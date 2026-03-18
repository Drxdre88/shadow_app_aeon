'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  createChecklistItemSchema,
  checklistItemStateSchema,
  updateChecklistItemSchema,
} from '@/lib/data/validators'
import {
  findChecklistItems as _findChecklistItems,
  createChecklistItem as _createChecklistItem,
  updateChecklistItem as _updateChecklistItem,
  deleteChecklistItem as _deleteChecklistItem,
} from '@/lib/data/checklist'
import { findTaskById } from '@/lib/data/tasks'

async function requireTaskInProject(taskId: string, projectId: string) {
  await requireOwnership(projectId)
  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')
  return task
}

export async function getChecklistItems(taskId: string, projectId: string) {
  await requireTaskInProject(taskId, projectId)
  return _findChecklistItems(taskId, projectId)
}

export async function createChecklistItem(data: {
  id: string
  taskId: string
  projectId: string
  title: string
  orderIndex: number
  groupName?: string
}) {
  await requireTaskInProject(data.taskId, data.projectId)

  const parsed = createChecklistItemSchema.parse({
    title: data.title,
    groupName: data.groupName,
    orderIndex: data.orderIndex,
  })

  const item = await _createChecklistItem(data.taskId, parsed)

  revalidatePath(`/project/${data.projectId}`)
  return item
}

export async function updateChecklistItem(
  itemId: string,
  taskId: string,
  projectId: string,
  updates: {
    title?: string
    completed?: boolean
    state?: string
    status?: string | null
    startDate?: string
    endDate?: string
  }
) {
  await requireTaskInProject(taskId, projectId)

  const rawState = updates.state !== undefined
    ? checklistItemStateSchema.parse(updates.state)
    : updates.completed !== undefined
      ? (updates.completed ? 'checked' as const : 'unchecked' as const)
      : undefined

  const parsed = updateChecklistItemSchema.parse({
    title: updates.title,
    state: rawState,
    status: updates.status,
  })

  const item = await _updateChecklistItem(itemId, taskId, parsed)
  revalidatePath(`/project/${projectId}`)
  return item
}

export async function deleteChecklistItem(itemId: string, taskId: string, projectId: string) {
  await requireTaskInProject(taskId, projectId)
  await _deleteChecklistItem(itemId, taskId)
  revalidatePath(`/project/${projectId}`)
}
