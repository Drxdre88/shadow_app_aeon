'use server'

import { z } from 'zod'
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
import { createColumnSchema, updateColumnSchema } from '@/lib/data/validators'

const reorderColumnsSchema = z.array(z.object({
  id: z.string().uuid(),
  orderIndex: z.number().int(),
}))

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
  const parsed = createColumnSchema.parse(data)
  const col = await _createColumn(projectId, parsed, clientId)
  revalidatePath(`/project/${projectId}`)
  return col
}

export async function updateColumn(
  columnId: string,
  projectId: string,
  data: { name?: string; color?: string; icon?: string | null; orderIndex?: number }
) {
  await requireOwnership(projectId)
  const parsed = updateColumnSchema.parse(data)
  const col = await _updateColumn(columnId, projectId, parsed)
  revalidatePath(`/project/${projectId}`)
  return col
}

export async function deleteColumn(columnId: string, projectId: string) {
  await requireOwnership(projectId)
  const { deleteTasksByColumn } = await import('@/lib/data/tasks')
  await deleteTasksByColumn(columnId, projectId)
  await _deleteColumn(columnId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function reorderColumns(
  projectId: string,
  updates: { id: string; orderIndex: number }[]
) {
  await requireOwnership(projectId)
  const parsed = reorderColumnsSchema.parse(updates)
  await _reorderColumns(projectId, parsed)
  revalidatePath(`/project/${projectId}`)
}

export async function ensureDefaultColumns(projectId: string) {
  await requireOwnership(projectId)
  await _createDefaultColumns(projectId)
}
