'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireEditor } from './helpers'
import { moveAllTasksToColumn as _moveAllTasksToColumn } from '@/lib/data/boardBulk'
import { findColumns as _findColumns } from '@/lib/data/columns'
import { emitActivity } from '@/lib/data/activity'
import { captureBoardEvent } from '@/lib/kairos/auto-capture'

const idSchema = z.string().uuid()

export async function moveAllTasksToColumnAction(projectId: string, fromColumnId: string, toColumnId: string) {
  const userId = await requireEditor(projectId)
  idSchema.parse(fromColumnId)
  idSchema.parse(toColumnId)
  if (fromColumnId === toColumnId) throw new Error('Source and target columns are the same')

  // Both columns must belong to the project the caller was authorized for —
  // otherwise an editor of project A could drain a column into project B.
  const columns = await _findColumns(projectId)
  const known = new Set(columns.map((c) => c.id))
  if (!known.has(fromColumnId) || !known.has(toColumnId)) throw new Error('Column not found or unauthorized')

  const moved = await _moveAllTasksToColumn(projectId, fromColumnId, toColumnId)
  for (const task of moved) {
    emitActivity(projectId, 'task', task.id, 'moved', task.name, { fromColumnId, toColumnId }, userId).catch(() => {})
    captureBoardEvent({
      userId, projectId, taskId: task.id, taskName: task.name, action: 'moved',
      metadata: { fromColumnId, toColumnId, via: 'column-menu' },
    }).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
  return moved
}
