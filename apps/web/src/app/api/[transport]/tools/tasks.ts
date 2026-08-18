import { z } from 'zod'
import { findTasks, createTask, createTasksBatch, updateTask, deleteTask } from '@/lib/data/tasks'
import { findTaskWithDetails } from '@/lib/data/checklist'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { createTaskSchema, updateTaskSchema } from '@/lib/data/validators'
import { emitActivity } from '@/lib/data/activity'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerTaskTools: RegisterFn = (server) => {
  server.tool(
    'list_tasks',
    'List board tasks for a project, optionally filtered by status or priority',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      status: z.enum(['todo', 'in-progress', 'done']).optional().describe('Filter by status'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Filter by priority'),
      limit: z.number().int().min(1).max(500).default(100).describe('Max results (default 100, max 500)'),
      offset: z.number().int().min(0).default(0).describe('Skip N results (default 0)'),
    },
    { title: 'List Tasks', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, status, priority, limit, offset }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await findTasks(projectId, { status, priority }, limit, offset))
    }
  )

  server.tool(
    'create_task',
    'Create a board task in a project',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      columnId: z.string().uuid().optional().describe('The column UUID to place task in'),
      ...createTaskSchema.pick({
        name: true, description: true, status: true, priority: true, color: true,
        size: true, progress: true, startDate: true, endDate: true, onTimeline: true,
      }).shape,
    },
    { title: 'Create Task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, columnId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const task = await createTask(projectId, {
        ...data,
        columnId,
        status: data.status ?? 'todo',
        priority: data.priority ?? 'medium',
        color: data.color ?? 'purple',
      })
      emitActivity(projectId, 'task', task.id, 'created', task.name, undefined, uid, 'agent').catch(() => {})
      return ok(task)
    }
  )

  server.tool(
    'update_task',
    'Update a board task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      columnId: z.string().uuid().optional().describe('Move task to this column'),
      ...updateTaskSchema.pick({
        name: true, description: true, status: true, priority: true, color: true,
        size: true, progress: true, startDate: true, endDate: true, onTimeline: true,
      }).shape,
    },
    { title: 'Update Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ projectId, taskId, columnId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const task = await updateTask(taskId, projectId, { ...data, columnId })
      if (task) {
        if (data.status === 'done') {
          emitActivity(projectId, 'task', taskId, 'completed', task.name, undefined, uid, 'agent').catch(() => {})
        } else if (columnId) {
          emitActivity(projectId, 'task', taskId, 'moved', task.name, { toColumnId: columnId }, uid, 'agent').catch(() => {})
        } else {
          emitActivity(projectId, 'task', taskId, 'updated', task.name, undefined, uid, 'agent').catch(() => {})
        }
      }
      return task ? ok(task) : notFound('Task')
    }
  )

  server.tool(
    'delete_task',
    'Delete a board task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
    },
    { title: 'Delete Task', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ projectId, taskId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteTask(taskId, projectId)
      if (deleted) emitActivity(projectId, 'task', taskId, 'deleted', undefined, undefined, uid, 'agent').catch(() => {})
      return deleted ? ok({ deleted: true }) : notFound('Task')
    }
  )

  server.tool(
    'get_task_detail',
    'Get full card detail: task fields, checklist items, labels, and dependencies in one call',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
    },
    { title: 'Get Task Detail', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, taskId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const detail = await findTaskWithDetails(taskId, projectId)
      return detail ? ok(detail) : notFound('Task')
    }
  )

  server.tool(
    'batch_create_tasks',
    'Create multiple board tasks in one call. Returns slim response with IDs and names only.',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      tasks: z.array(z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(10000).optional(),
        status: z.enum(['todo', 'in-progress', 'done']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        color: z.string().max(20).optional(),
        size: z.number().min(0.5).max(20).nullable().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        columnId: z.string().uuid().optional(),
      })).min(1).max(100).describe('Array of tasks to create (max 100)'),
    },
    { title: 'Batch Create Tasks', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, tasks }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const created = await createTasksBatch(projectId, tasks)
      for (const t of created) {
        emitActivity(projectId, 'task', t.id, 'created', t.name, undefined, uid, 'agent').catch(() => {})
      }
      return ok({ created: created.length, tasks: created.map((t) => ({ id: t.id, name: t.name })) })
    }
  )
}
