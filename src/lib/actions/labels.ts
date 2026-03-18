'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import { createLabelSchema, updateLabelSchema } from '@/lib/data/validators'
import {
  createLabel as _createLabel,
  updateLabel as _updateLabel,
  deleteLabel as _deleteLabel,
  addLabelToTask as _addLabelToTask,
  removeLabelFromTask as _removeLabelFromTask,
} from '@/lib/data/labels'
import { emitActivity } from '@/lib/data/activity'

export async function createLabel(data: {
  id: string
  projectId: string
  name: string
  color: string
}) {
  await requireOwnership(data.projectId)

  const parsed = createLabelSchema.parse({ name: data.name, color: data.color })

  const label = await _createLabel(data.projectId, parsed, data.id)

  revalidatePath(`/project/${data.projectId}`)
  return label
}

export async function updateLabel(
  labelId: string,
  projectId: string,
  updates: { name?: string; color?: string }
) {
  await requireOwnership(projectId)
  const parsed = updateLabelSchema.parse(updates)
  const label = await _updateLabel(labelId, projectId, parsed)
  revalidatePath(`/project/${projectId}`)
  return label
}

export async function deleteLabel(labelId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteLabel(labelId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function addLabelToTask(taskId: string, labelId: string, projectId: string) {
  await requireOwnership(projectId)
  await _addLabelToTask(taskId, labelId, projectId)
  emitActivity(projectId, 'label', taskId, 'label_added', undefined, { labelId, taskId }).catch(() => {})
  revalidatePath(`/project/${projectId}`)
}

export async function removeLabelFromTask(taskId: string, labelId: string, projectId: string) {
  await requireOwnership(projectId)
  await _removeLabelFromTask(taskId, labelId, projectId)
  emitActivity(projectId, 'label', taskId, 'label_removed', undefined, { labelId, taskId }).catch(() => {})
  revalidatePath(`/project/${projectId}`)
}
