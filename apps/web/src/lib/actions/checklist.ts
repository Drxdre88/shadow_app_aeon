'use server'

import { revalidatePath } from 'next/cache'
import { requireMember, requireEditor } from './helpers'
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
  renameChecklistGroup as _renameChecklistGroup,
  reorderChecklistItems as _reorderChecklistItems,
  deleteChecklistGroup as _deleteChecklistGroup,
} from '@/lib/data/checklist'
import { findTaskById } from '@/lib/data/tasks'

async function requireTaskReadable(taskId: string, projectId: string) {
  await requireMember(projectId)
  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')
  return task
}

async function requireTaskEditable(taskId: string, projectId: string) {
  await requireEditor(projectId)
  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')
  return task
}

export async function getChecklistItems(taskId: string, projectId: string) {
  await requireTaskReadable(taskId, projectId)
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
  await requireTaskEditable(data.taskId, data.projectId)

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
  await requireTaskEditable(taskId, projectId)

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
  await requireTaskEditable(taskId, projectId)
  await _deleteChecklistItem(itemId, taskId)
  revalidatePath(`/project/${projectId}`)
}

export async function reorderChecklistItems(
  taskId: string,
  projectId: string,
  updates: { id: string; orderIndex: number }[]
) {
  await requireTaskEditable(taskId, projectId)
  await _reorderChecklistItems(taskId, updates)
  revalidatePath(`/project/${projectId}`)
}

export async function renameChecklistGroup(
  taskId: string,
  projectId: string,
  oldName: string,
  newName: string
) {
  await requireTaskEditable(taskId, projectId)
  const count = await _renameChecklistGroup(taskId, oldName, newName)
  revalidatePath(`/project/${projectId}`)
  return count
}

export async function deleteChecklistGroup(
  taskId: string,
  projectId: string,
  groupName: string
) {
  await requireTaskEditable(taskId, projectId)
  await _deleteChecklistGroup(taskId, groupName)
  revalidatePath(`/project/${projectId}`)
}
