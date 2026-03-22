import { z } from 'zod'
import {
  createChecklistItem,
  createChecklistItemsBatch,
  updateChecklistItem,
  deleteChecklistItem,
} from '@/lib/data/checklist'
import { verifyProjectOwnership } from '@/lib/data/projects'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerChecklistTools: RegisterFn = (server) => {
  server.tool(
    'create_checklist_item',
    'Add a checklist item to a task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      title: z.string().min(1).max(255).describe('Checklist item title'),
      groupName: z.string().max(100).default('Checklist').describe('Group name for organizing items'),
    },
    async ({ projectId, taskId, title, groupName }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await createChecklistItem(taskId, { title, groupName }))
    }
  )

  server.tool(
    'update_checklist_item',
    'Update a checklist item (title, state, status)',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      itemId: z.string().uuid().describe('The checklist item UUID'),
      title: z.string().min(1).max(255).optional().describe('New title'),
      state: z.enum(['unchecked', 'checked', 'crossed']).optional().describe('Check state'),
      status: z.string().max(30).nullable().optional().describe('Status label'),
    },
    async ({ projectId, taskId, itemId, ...updates }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const item = await updateChecklistItem(itemId, taskId, updates)
      return item ? ok(item) : notFound('Checklist item')
    }
  )

  server.tool(
    'delete_checklist_item',
    'Remove a checklist item from a task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      itemId: z.string().uuid().describe('The checklist item UUID'),
    },
    async ({ projectId, taskId, itemId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteChecklistItem(itemId, taskId)
      return deleted ? ok({ deleted: true }) : notFound('Checklist item')
    }
  )

  server.tool(
    'batch_create_checklist_items',
    'Create multiple checklist items on a task in one call',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      items: z.array(z.object({
        title: z.string().min(1).max(255),
        groupName: z.string().max(100).optional(),
      })).min(1).max(100).describe('Array of checklist items to create'),
    },
    async ({ projectId, taskId, items }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const created = await createChecklistItemsBatch(taskId, items)
      return ok({ created: created.length, items: created.map((i) => ({ id: i.id, title: i.title })) })
    }
  )
}
