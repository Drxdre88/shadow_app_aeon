'use server'

import { requireAuth } from './helpers'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById, createTask } from '@/lib/data/tasks'
import { findColumns } from '@/lib/data/columns'
import { findChecklistItems, createChecklistItemsBatch } from '@/lib/data/checklist'
import { emitActivity } from '@/lib/data/activity'
import { db } from '@/lib/db'
import { boardTasks, boardColumns } from '@/lib/db/schema'
import { eq, and, sql, inArray, asc } from 'drizzle-orm'

export async function listProjectsForTransfer() {
  const userId = await requireAuth()
  const { findProjectsWithRealmName } = await import('@/lib/data/projects')
  const projects = await findProjectsWithRealmName(userId)
  const projectIds = projects.map((p) => p.id)

  if (projectIds.length === 0) return []

  const allColumns = await db
    .select({
      id: boardColumns.id,
      name: boardColumns.name,
      color: boardColumns.color,
      projectId: boardColumns.projectId,
    })
    .from(boardColumns)
    .where(inArray(boardColumns.projectId, projectIds))
    .orderBy(asc(boardColumns.orderIndex))

  const colsByProject = new Map<string, { id: string; name: string; color: string }[]>()
  for (const col of allColumns) {
    if (!colsByProject.has(col.projectId)) colsByProject.set(col.projectId, [])
    colsByProject.get(col.projectId)!.push({ id: col.id, name: col.name, color: col.color })
  }

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    realm: p.realmName ?? 'Ungrouped',
    columns: colsByProject.get(p.id) ?? [],
  }))
}

export async function copyTaskToProject(
  taskId: string,
  sourceProjectId: string,
  targetProjectId: string,
  targetColumnId?: string
) {
  const userId = await requireAuth()

  const [sourceProject, targetProject] = await Promise.all([
    verifyProjectOwnership(sourceProjectId, userId),
    verifyProjectOwnership(targetProjectId, userId),
  ])
  if (!sourceProject) throw new Error('Source project not found')
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

  const [sourceProject, targetProject] = await Promise.all([
    verifyProjectOwnership(sourceProjectId, userId),
    verifyProjectOwnership(targetProjectId, userId),
  ])
  if (!sourceProject) throw new Error('Source project not found')
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
      ownerResourceId: null,
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

  const [sourceProject, targetProject] = await Promise.all([
    verifyProjectOwnership(sourceProjectId, userId),
    verifyProjectOwnership(targetProjectId, userId),
  ])
  if (!sourceProject) throw new Error('Source project not found')
  if (!targetProject) throw new Error('Target project not found')

  const [sourceCols, targetCols] = await Promise.all([
    findColumns(sourceProjectId),
    findColumns(targetProjectId),
  ])
  const sourceCol = sourceCols.find(c => c.id === columnId)
  if (!sourceCol) throw new Error('Column not found')

  const maxOrder = targetCols.length > 0 ? Math.max(...targetCols.map(c => c.orderIndex)) + 1 : 0

  const { createColumn, deleteColumn } = await import('@/lib/data/columns')
  const newCol = await createColumn(targetProjectId, {
    name: sourceCol.name,
    color: sourceCol.color,
    icon: sourceCol.icon ?? undefined,
    orderIndex: maxOrder,
  })

  const { findTasksByColumn, deleteTasksByColumn } = await import('@/lib/data/tasks')
  const columnTasks = await findTasksByColumn(sourceProjectId, columnId)

  // Batch-fetch all checklist items for all column tasks
  const taskIds = columnTasks.map(t => t.id)
  const { findChecklistItemsBatch } = await import('@/lib/data/checklist')
  const allChecklist = taskIds.length > 0 ? await findChecklistItemsBatch(taskIds) : new Map()

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

      const items = allChecklist.get(task.id) ?? []
      if (items.length > 0) {
        await createChecklistItemsBatch(
          newTask.id,
          items.map((i: { title: string; groupName: string }) => ({ title: i.title, groupName: i.groupName }))
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

  const [sourceProject, targetProject] = await Promise.all([
    verifyProjectOwnership(sourceProjectId, userId),
    verifyProjectOwnership(targetProjectId, userId),
  ])
  if (!sourceProject) throw new Error('Source project not found')
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
        ownerResourceId: null,
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
