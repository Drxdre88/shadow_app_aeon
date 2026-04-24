import { z } from 'zod'
import {
  findGanttTasksWithRows,
  createGanttTask,
  updateGanttTask,
  deleteGanttTask,
  createGanttTasksBatch,
  findRows,
  createRow,
  updateRow,
  deleteRow,
  reorderRows,
  verifyRowOwnership,
  verifyRowsOwnership,
} from '@/lib/data/gantt'
import {
  findGanttViews,
  findGanttViewById,
  createGanttView,
  updateGanttView,
  deleteGanttView,
} from '@/lib/data/ganttViews'
import { verifyProjectOwnership } from '@/lib/data/projects'
import {
  createGanttTaskSchema,
  updateGanttTaskSchema,
  createRowSchema,
  updateRowSchema,
  reorderRowsSchema,
  createGanttViewSchema,
  updateGanttViewSchema,
} from '@/lib/data/validators'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerGanttTools: RegisterFn = (server) => {
  // ---------- Gantt tasks ----------

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

  server.tool(
    'delete_gantt_task',
    'Delete a gantt task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The gantt task UUID'),
    },
    async ({ projectId, taskId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteGanttTask(taskId, projectId)
      return deleted ? ok({ deleted: true }) : notFound('Gantt task')
    }
  )

  server.tool(
    'batch_create_gantt_tasks',
    'Create multiple gantt tasks in one call. All rowIds must belong to the project — partial ownership aborts the batch. Returns slim response with IDs and names only.',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      tasks: z.array(createGanttTaskSchema).min(1).max(100)
        .describe('Array of gantt tasks to create (max 100)'),
    },
    async ({ projectId, tasks }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const rowIds = tasks.map((t) => t.rowId)
      if (!await verifyRowsOwnership(rowIds, projectId)) {
        return notFound('One or more rows in this project')
      }
      const created = await createGanttTasksBatch(projectId, tasks)
      return ok({ created: created.length, tasks: created.map((t) => ({ id: t.id, name: t.name })) })
    }
  )

  // ---------- Rows (swim lanes) ----------

  server.tool(
    'list_rows',
    'List gantt swim-lane rows for a project',
    { projectId: z.string().uuid().describe('The project UUID') },
    async ({ projectId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await findRows(projectId))
    }
  )

  server.tool(
    'create_row',
    'Create a gantt swim-lane row. Requires a ganttViewId — create a gantt view first if none exists. orderIndex auto-assigns to max+1 when omitted.',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      ...createRowSchema.shape,
      ganttViewId: createRowSchema.shape.ganttViewId.describe('The gantt view UUID. Create a view first with create_gantt_view.'),
    },
    async ({ projectId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      if (!await findGanttViewById(data.ganttViewId, projectId)) {
        return { content: [{ type: 'text' as const, text: 'Error: Gantt view not found. Create a gantt view first with create_gantt_view, then pass its ID as ganttViewId.' }], isError: true }
      }
      return ok(await createRow(projectId, data))
    }
  )

  server.tool(
    'update_row',
    'Update a gantt swim-lane row',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      rowId: z.string().uuid().describe('The row UUID'),
      ...updateRowSchema.shape,
    },
    async ({ projectId, rowId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const row = await updateRow(rowId, projectId, data)
      return row ? ok(row) : notFound('Row')
    }
  )

  server.tool(
    'delete_row',
    'Delete a gantt swim-lane row. Gantt tasks on this row are SET NULL (rowId cleared), not deleted.',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      rowId: z.string().uuid().describe('The row UUID'),
    },
    async ({ projectId, rowId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteRow(rowId, projectId)
      return deleted ? ok({ deleted: true }) : notFound('Row')
    }
  )

  server.tool(
    'reorder_rows',
    'Reorder gantt swim-lane rows. All rowIds must belong to the project.',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      ...reorderRowsSchema.shape,
    },
    async ({ projectId, updates }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const rowIds = updates.map((u) => u.id)
      if (!await verifyRowsOwnership(rowIds, projectId)) {
        return notFound('One or more rows in this project')
      }
      await reorderRows(projectId, updates)
      return ok({ reordered: true })
    }
  )

  // ---------- Gantt views ----------

  server.tool(
    'list_gantt_views',
    'List saved gantt views (by-person / by-initiative / etc.) for a project',
    { projectId: z.string().uuid().describe('The project UUID') },
    async ({ projectId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await findGanttViews(projectId))
    }
  )

  server.tool(
    'create_gantt_view',
    'Create a saved gantt view with a grouping mode and filter config',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      ...createGanttViewSchema.shape,
    },
    async ({ projectId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await createGanttView(projectId, data))
    }
  )

  server.tool(
    'update_gantt_view',
    'Update a saved gantt view',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      viewId: z.string().uuid().describe('The gantt view UUID'),
      ...updateGanttViewSchema.shape,
    },
    async ({ projectId, viewId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const view = await updateGanttView(viewId, projectId, data)
      return view ? ok(view) : notFound('Gantt view')
    }
  )

  server.tool(
    'delete_gantt_view',
    'Delete a saved gantt view. Rows linked to this view are cascade-deleted via FK.',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      viewId: z.string().uuid().describe('The gantt view UUID'),
    },
    async ({ projectId, viewId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteGanttView(viewId, projectId)
      return deleted ? ok({ deleted: true }) : notFound('Gantt view')
    }
  )
}
