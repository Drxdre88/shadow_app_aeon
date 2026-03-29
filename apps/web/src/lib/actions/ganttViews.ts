'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership, requireEditor } from './helpers'
import {
  findGanttViews as _findGanttViews,
  createGanttView as _createGanttView,
  updateGanttView as _updateGanttView,
  deleteGanttView as _deleteGanttView,
  reflowGanttViewRows as _reflowGanttViewRows,
  resetGanttProjectData as _resetGanttProjectData,
} from '@/lib/data/ganttViews'
import {
  generateRowsForView,
  bulkPushAllTasksToGantt,
  type GroupByMode,
  type TaskOrder,
} from '@/lib/data/bridge'
import { createGanttViewSchema, updateGanttViewSchema, taskOrderSchema, groupByModeSchema } from '@/lib/data/validators'

export async function getGanttViews(projectId: string) {
  await requireOwnership(projectId)
  return _findGanttViews(projectId)
}

export async function createGanttView(data: {
  id: string
  projectId: string
  name: string
  groupBy: string
  excludedSections?: string[]
  taskOrder?: string
  allowWeekends?: boolean
  allowMultipleRows?: boolean
  allowOverlap?: boolean
  filters?: Record<string, unknown>
}) {
  await requireEditor(data.projectId)

  const taskOrder = taskOrderSchema.parse(data.taskOrder ?? 'column')
  const groupBy = groupByModeSchema.parse(data.groupBy)
  const allowWeekends = data.allowWeekends ?? false
  const allowOverlap = data.allowOverlap ?? false
  const allowMultipleRows = data.allowMultipleRows ?? false
  const filters: Record<string, unknown> = { ...data.filters }
  if (data.excludedSections && data.excludedSections.length > 0) {
    filters.excludedSections = data.excludedSections
  }
  filters.taskOrder = taskOrder
  filters.allowWeekends = allowWeekends
  filters.allowMultipleRows = allowMultipleRows
  filters.allowOverlap = allowOverlap

  const parsed = createGanttViewSchema.parse({
    name: data.name,
    groupBy,
    filters,
  })

  const view = await _createGanttView(data.projectId, parsed, data.id)

  const generatedRows = await generateRowsForView(
    data.projectId,
    view.id,
    groupBy,
    data.excludedSections
  )

  await bulkPushAllTasksToGantt(data.projectId, view.id, generatedRows, groupBy, taskOrder, allowWeekends, allowOverlap)

  revalidatePath(`/project/${data.projectId}`)
  return view
}

export async function updateGanttView(
  viewId: string,
  projectId: string,
  data: { name?: string; groupBy?: string; filters?: Record<string, unknown> }
) {
  await requireEditor(projectId)

  const parsed = updateGanttViewSchema.parse({
    ...data,
    groupBy: data.groupBy !== undefined ? groupByModeSchema.parse(data.groupBy) : undefined,
  })

  const view = await _updateGanttView(viewId, projectId, parsed)
  revalidatePath(`/project/${projectId}`)
  return view
}

export async function deleteGanttView(viewId: string, projectId: string) {
  await requireEditor(projectId)
  await _deleteGanttView(viewId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function reflowGanttView(projectId: string, viewId: string) {
  await requireEditor(projectId)
  await _reflowGanttViewRows(projectId, viewId)
  revalidatePath(`/project/${projectId}`)
}

export async function resetGanttData(projectId: string) {
  await requireEditor(projectId)
  await _resetGanttProjectData(projectId)
  revalidatePath(`/project/${projectId}`)
}
