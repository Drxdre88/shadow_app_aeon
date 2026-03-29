import { z } from 'zod'
import {
  findGanttTasksWithRows,
  createGanttTask,
  updateGanttTask,
  verifyRowOwnership,
} from '@/lib/data/gantt'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { createGanttTaskSchema, updateGanttTaskSchema } from '@/lib/data/validators'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerGanttTools: RegisterFn = (server) => {
  server.tool(
    'list_gantt_tasks',
    'List gantt tasks and rows for a project',
    { projectId: z.string().uuid().describe('The project UUID') },
    async ({ projectId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await findGanttTasksWithRows(projectId))
    }
  )

  server.tool(
    'create_gantt_task',
    'Create a gantt task in a project',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      ...createGanttTaskSchema.shape,
      rowId: createGanttTaskSchema.shape.rowId.describe('The row UUID to place task in'),
      startDate: createGanttTaskSchema.shape.startDate.describe('Start date (ISO 8601)'),
      endDate: createGanttTaskSchema.shape.endDate.describe('End date (ISO 8601)'),
    },
    async ({ projectId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      if (!await verifyRowOwnership(data.rowId, projectId)) return notFound('Row in this project')
      return ok(await createGanttTask(projectId, data))
    }
  )

  server.tool(
    'update_gantt_task',
    'Update a gantt task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The gantt task UUID'),
      ...updateGanttTaskSchema.shape,
    },
    async ({ projectId, taskId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      if (data.rowId && !await verifyRowOwnership(data.rowId, projectId)) {
        return notFound('Row in this project')
      }
      const task = await updateGanttTask(taskId, projectId, data)
      return task ? ok(task) : notFound('Gantt task')
    }
  )
}
