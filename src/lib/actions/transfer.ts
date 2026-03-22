'use server'

import { requireAuth } from './helpers'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById, createTask } from '@/lib/data/tasks'
import { findColumns } from '@/lib/data/columns'
import { findChecklistItems } from '@/lib/data/checklist'
import { createChecklistItemsBatch } from '@/lib/data/checklist'
import { emitActivity } from '@/lib/data/activity'
import { db } from '@/lib/db'
import { boardTasks, boardColumns } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'

export async function listProjectsForTransfer() {
  const userId = await requireAuth()
  const { findProjects } = await import('@/lib/data/projects')
  const projects = await findProjects(userId)
  const result = []
  for (const p of projects) {
    const cols = await findColumns(p.id)
    result.push({
      id: p.id,
      name: p.name,
      columns: cols.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    })
  }
  return result
}

export async function copyTaskToProject(
  taskId: string,
  sourceProjectId: string,
  targetProjectId: string,
  targetColumnId?: string
) {
  const userId = await requireAuth()

  const sourceProject = await verifyProjectOwnership(sourceProjectId, userId)
  if (!sourceProject) throw new Error('Source project not found')

  const targetProject = await verifyProjectOwnership(targetProjectId, userId)
  if (!targetProject) throw new Error('Target project not found')

  const task = await findTaskById(taskId, sourceProjectId)
  if (!task) throw new Error('Task not found')

  const columns = await findColumns(targetProjectId)
  const columnId = targetColumnId || columns[0]?.id

  const newTask = await createTask(targetProjectId, {
    name: task.name,
    description: task.description || undefined,
    columnId: columnId || undefined,
    status: 'todo',
    priority: task.priority as 'low' | 'medium' | 'high' | 'urgent',
    color: task.color,
    onTimeline: false,
    size: task.size,
  })

  const checklistItems = await findChecklistItems(taskId, sourceProjectId)
  if (checklistItems.length > 0) {
    await createChecklistItemsBatch(
      newTask.id,
      checklistItems.map((i) => ({ title: i.title, groupName: i.groupName }))
    )
  }

  emitActivity(targetProjectId, 'task', newTask.id, 'created', `${task.name} (copied)`, { sourceProjectId, sourceTaskId: taskId }, userId).catch(() => {})

  return newTask
}

export async function moveTaskToProject(
  taskId: string,
  sourceProjectId: string,
  targetProjectId: string,
  targetColumnId?: string
) {
  const userId = await requireAuth()

  const sourceProject = await verifyProjectOwnership(sourceProjectId, userId)
  if (!sourceProject) throw new Error('Source project not found')

  const targetProject = await verifyProjectOwnership(targetProjectId, userId)
  if (!targetProject) throw new Error('Target project not found')

  const task = await findTaskById(taskId, sourceProjectId)
  if (!task) throw new Error('Task not found')

  const columns = await findColumns(targetProjectId)
  const columnId = targetColumnId || columns[0]?.id

  const [updated] = await db
    .update(boardTasks)
    .set({
      projectId: targetProjectId,
      columnId: columnId || null,
      status: 'todo',
      onTimeline: false,
      ganttTaskId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, sourceProjectId)))
    .returning()

  if (updated) {
    emitActivity(sourceProjectId, 'task', taskId, 'moved', `${task.name} -> ${targetProject.name}`, { targetProjectId }, userId).catch(() => {})
    emitActivity(targetProjectId, 'task', taskId, 'created', `${task.name} (moved)`, { sourceProjectId }, userId).catch(() => {})
  }

  return updated || null
}

export async function copyColumnToProject(
  columnId: string,
  sourceProjectId: string,
  targetProjectId: string
) {
  const userId = await requireAuth()

  const sourceProject = await verifyProjectOwnership(sourceProjectId, userId)
  if (!sourceProject) throw new Error('Source project not found')
  const targetProject = await verifyProjectOwnership(targetProjectId, userId)
  if (!targetProject) throw new Error('Target project not found')

  const sourceCols = await findColumns(sourceProjectId)
  const sourceCol = sourceCols.find(c => c.id === columnId)
  if (!sourceCol) throw new Error('Column not found')

  const targetCols = await findColumns(targetProjectId)
  const maxOrder = targetCols.length > 0 ? Math.max(...targetCols.map(c => c.orderIndex)) + 1 : 0

  const { createColumn, deleteColumn } = await import('@/lib/data/columns')
  const newCol = await createColumn(targetProjectId, {
    name: sourceCol.name,
    color: sourceCol.color,
    icon: sourceCol.icon ?? undefined,
    orderIndex: maxOrder,
  })

  const { findTasks, deleteTasksByColumn } = await import('@/lib/data/tasks')
  const tasks = await findTasks(sourceProjectId)
  const columnTasks = tasks.filter(t => t.columnId === columnId)

  try {
    for (const task of columnTasks) {
      const newTask = await createTask(targetProjectId, {
        name: task.name,
        description: task.description || undefined,
        columnId: newCol.id,
        status: 'todo',
        priority: task.priority as 'low' | 'medium' | 'high' | 'urgent',
        color: task.color,
        onTimeline: false,
        size: task.size,
      })

      const checklistItems = await findChecklistItems(task.id, sourceProjectId)
      if (checklistItems.length > 0) {
        await createChecklistItemsBatch(
          newTask.id,
          checklistItems.map(i => ({ title: i.title, groupName: i.groupName }))
        )
      }
    }
  } catch (err) {
    await deleteTasksByColumn(newCol.id, targetProjectId).catch(() => {})
    await deleteColumn(newCol.id, targetProjectId).catch(() => {})
    throw err
  }

  emitActivity(targetProjectId, 'column', newCol.id, 'created', `${sourceCol.name} (copied with ${columnTasks.length} cards)`, { sourceProjectId }, userId).catch(() => {})

  return newCol
}

export async function moveColumnToProject(
  columnId: string,
  sourceProjectId: string,
  targetProjectId: string
) {
  const userId = await requireAuth()

  const sourceProject = await verifyProjectOwnership(sourceProjectId, userId)
  if (!sourceProject) throw new Error('Source project not found')
  const targetProject = await verifyProjectOwnership(targetProjectId, userId)
  if (!targetProject) throw new Error('Target project not found')

  const sourceCols = await findColumns(sourceProjectId)
  const sourceCol = sourceCols.find(c => c.id === columnId)
  if (!sourceCol) throw new Error('Column not found')

  const targetCols = await findColumns(targetProjectId)
  const maxOrder = targetCols.length > 0 ? Math.max(...targetCols.map(c => c.orderIndex)) + 1 : 0

  await db.transaction(async (tx) => {
    await tx
      .update(boardTasks)
      .set({
        projectId: targetProjectId,
        onTimeline: false,
        ganttTaskId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(boardTasks.columnId, columnId), eq(boardTasks.projectId, sourceProjectId)))

    await tx
      .update(boardColumns)
      .set({
        projectId: targetProjectId,
        orderIndex: maxOrder,
      })
      .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, sourceProjectId)))
  })

  emitActivity(sourceProjectId, 'column', columnId, 'moved', `${sourceCol.name} -> ${targetProject.name}`, { targetProjectId }, userId).catch(() => {})
  emitActivity(targetProjectId, 'column', columnId, 'created', `${sourceCol.name} (moved)`, { sourceProjectId }, userId).catch(() => {})

  return { id: columnId, name: sourceCol.name }
}
