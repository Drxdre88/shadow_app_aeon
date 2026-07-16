import { z } from 'zod'
import {
  findColumns,
  createColumn,
  updateColumn,
  deleteColumn as deleteColumnData,
  reorderColumns,
} from '@/lib/data/columns'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { createColumnSchema, updateColumnSchema } from '@/lib/data/validators'
import { emitActivity } from '@/lib/data/activity'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerColumnTools: RegisterFn = (server) => {
  server.tool(
    'list_columns',
    'List board columns for a project',
    { projectId: z.string().uuid().describe('The project UUID') },
    { title: 'List Columns', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await findColumns(projectId))
    }
  )

  server.tool(
    'create_column',
    'Create a board column in a project',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      ...createColumnSchema.shape,
    },
    { title: 'Create Column', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const col = await createColumn(projectId, data)
      emitActivity(projectId, 'column', col.id, 'created', col.name, undefined, uid, 'agent').catch(() => {})
      return ok(col)
    }
  )

  server.tool(
    'update_column',
    'Update a board column',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      columnId: z.string().uuid().describe('The column UUID'),
      ...updateColumnSchema.shape,
    },
    { title: 'Update Column', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ projectId, columnId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const col = await updateColumn(columnId, projectId, data)
      if (col) emitActivity(projectId, 'column', columnId, 'updated', col.name, undefined, uid, 'agent').catch(() => {})
      return col ? ok(col) : notFound('Column')
    }
  )

  server.tool(
    'delete_column',
    'Delete a board column',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      columnId: z.string().uuid().describe('The column UUID'),
    },
    { title: 'Delete Column', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ projectId, columnId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteColumnData(columnId, projectId)
      if (deleted) emitActivity(projectId, 'column', columnId, 'deleted', undefined, undefined, uid, 'agent').catch(() => {})
      return deleted ? ok({ deleted: true }) : notFound('Column')
    }
  )

  server.tool(
    'reorder_columns',
    'Reorder board columns',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      updates: z.array(z.object({
        id: z.string().uuid(),
        orderIndex: z.number().int(),
      })).describe('Array of column IDs with new order indices'),
    },
    { title: 'Reorder Columns', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ projectId, updates }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      await reorderColumns(projectId, updates)
      return ok({ reordered: true })
    }
  )
}
