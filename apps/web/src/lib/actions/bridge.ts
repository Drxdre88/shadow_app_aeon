'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor } from './helpers'
import {
  pushTaskToGantt as _pushTaskToGantt,
  findRowTargetForTask,
} from '@/lib/data/bridge'
import { findGanttViewById } from '@/lib/data/ganttViews'

export async function pushToGantt(data: {
  boardTaskId: string
  projectId: string
  ganttViewId: string
  ganttTaskId: string
  rowId?: string
}) {
  await requireEditor(data.projectId)

  let rowId = data.rowId
  if (!rowId) {
    const view = await findGanttViewById(data.ganttViewId, data.projectId)
    if (!view) throw new Error('Gantt view not found')
    const targetRowId = await findRowTargetForTask(
      data.boardTaskId,
      data.projectId,
      data.ganttViewId,
      view.groupBy as 'column' | 'label' | 'dependency' | 'priority'
    )
    if (!targetRowId) throw new Error('No rows available in this Gantt view')
    rowId = targetRowId
  }

  const ganttTask = await _pushTaskToGantt(
    data.boardTaskId,
    data.projectId,
    data.ganttViewId,
    rowId,
    data.ganttTaskId
  )

  revalidatePath(`/project/${data.projectId}`)
  return ganttTask
}
