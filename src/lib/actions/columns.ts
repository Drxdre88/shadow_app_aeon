'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  findColumns as _findColumns,
  createColumn as _createColumn,
  updateColumn as _updateColumn,
  deleteColumn as _deleteColumn,
  reorderColumns as _reorderColumns,
  createDefaultColumns as _createDefaultColumns,
} from '@/lib/data/columns'

export async function getColumns(projectId: string) {
  await requireOwnership(projectId)
  return _findColumns(projectId)
}

export async function createColumn(
  projectId: string,
  data: { name: string; color?: string; icon?: string; orderIndex?: number },
  clientId?: string
) {
  await requireOwnership(projectId)
  const col = await _createColumn(projectId, data, clientId)
  revalidatePath(`/project/${projectId}`)
  return col
}

export async function updateColumn(
  columnId: string,
  projectId: string,
  data: { name?: string; color?: string; icon?: string | null; orderIndex?: number }
) {
  await requireOwnership(projectId)
  const col = await _updateColumn(columnId, projectId, data)
  revalidatePath(`/project/${projectId}`)
  return col
}

export async function deleteColumn(columnId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteColumn(columnId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function reorderColumns(
  projectId: string,
  updates: { id: string; orderIndex: number }[]
) {
  await requireOwnership(projectId)
  await _reorderColumns(projectId, updates)
  revalidatePath(`/project/${projectId}`)
}

export async function ensureDefaultColumns(projectId: string) {
  await requireOwnership(projectId)
  await _createDefaultColumns(projectId)
}
