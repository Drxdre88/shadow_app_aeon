'use server'

import { requireAuth } from './helpers'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById, createTask } from '@/lib/data/tasks'
import { findColumns } from '@/lib/data/columns'
import { findChecklistItems } from '@/lib/data/checklist'
import { createChecklistItemsBatch } from '@/lib/data/checklist'
import { emitActivity } from '@/lib/data/activity'
import { db } from '@/lib/db'
import { boardTasks } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

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
