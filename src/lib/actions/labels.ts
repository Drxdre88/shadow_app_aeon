'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  findLabels as _findLabels,
  findTaskLabels as _findTaskLabels,
  createLabel as _createLabel,
  deleteLabel as _deleteLabel,
  addLabelToTask as _addLabelToTask,
  removeLabelFromTask as _removeLabelFromTask,
} from '@/lib/data/labels'

export async function getLabels(projectId: string) {
  await requireOwnership(projectId)
  return _findLabels(projectId)
}

export async function getTaskLabels(projectId: string) {
  await requireOwnership(projectId)
  return _findTaskLabels(projectId)
}

export async function createLabel(data: {
  id: string
  projectId: string
  name: string
  color: string
}) {
  await requireOwnership(data.projectId)

  const label = await _createLabel(
    data.projectId,
    { name: data.name, color: data.color },
    data.id
  )

  revalidatePath(`/project/${data.projectId}`)
  return label
}

export async function deleteLabel(labelId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteLabel(labelId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function addLabelToTask(taskId: string, labelId: string, projectId: string) {
  await requireOwnership(projectId)
  await _addLabelToTask(taskId, labelId)
  revalidatePath(`/project/${projectId}`)
}

export async function removeLabelFromTask(taskId: string, labelId: string, projectId: string) {
  await requireOwnership(projectId)
  await _removeLabelFromTask(taskId, labelId)
  revalidatePath(`/project/${projectId}`)
}
