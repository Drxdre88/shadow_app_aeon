import { z } from 'zod'
import { findLabels, findTaskLabels, createLabel, deleteLabel, addLabelToTask, removeLabelFromTask, setTaskLabels } from '@/lib/data/labels'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { createLabelSchema } from '@/lib/data/validators'
import { emitActivity } from '@/lib/data/activity'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerLabelTools: RegisterFn = (server) => {
  server.tool(
    'list_labels',
    'List all labels for a project, and which tasks they are assigned to',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      limit: z.number().int().min(1).max(500).default(100).describe('Max results (default 100, max 500)'),
      offset: z.number().int().min(0).default(0).describe('Skip N results (default 0)'),
    },
    { title: 'List Labels', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, limit, offset }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const [projectLabels, assignments] = await Promise.all([
        findLabels(projectId, limit, offset),
        findTaskLabels(projectId),
      ])
      return ok({ labels: projectLabels, taskLabels: assignments })
    }
  )

  server.tool(
    'create_label',
    'Create a label in a project',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      ...createLabelSchema.shape,
    },
    { title: 'Create Label', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await createLabel(projectId, data))
    }
  )

  server.tool(
    'delete_label',
    'Delete a label from a project',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      labelId: z.string().uuid().describe('The label UUID'),
    },
    { title: 'Delete Label', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ projectId, labelId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteLabel(labelId, projectId)
      return deleted ? ok({ deleted: true }) : notFound('Label')
    }
  )

  server.tool(
    'add_label_to_task',
    'Assign a label to a task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      labelId: z.string().uuid().describe('The label UUID'),
    },
    { title: 'Add Label To Task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, taskId, labelId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      await addLabelToTask(taskId, labelId, projectId)
      emitActivity(projectId, 'label', taskId, 'label_added', undefined, { labelId, taskId }, uid, 'agent').catch(() => {})
      return ok({ added: true, taskId, labelId })
    }
  )

  server.tool(
    'remove_label_from_task',
    'Remove a label from a task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      labelId: z.string().uuid().describe('The label UUID'),
    },
    { title: 'Remove Label From Task', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ projectId, taskId, labelId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      await removeLabelFromTask(taskId, labelId, projectId)
      emitActivity(projectId, 'label', taskId, 'label_removed', undefined, { labelId, taskId }, uid, 'agent').catch(() => {})
      return ok({ removed: true })
    }
  )

  server.tool(
    'set_task_labels',
    'Set all labels on a task (replaces existing). Pass empty array to clear.',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      labelIds: z.array(z.string().uuid()).max(50).describe('Label IDs to assign (replaces all current labels)'),
    },
    { title: 'Set Task Labels', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ projectId, taskId, labelIds }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      await setTaskLabels(taskId, labelIds, projectId)
      return ok({ set: true, taskId, labelCount: labelIds.length })
    }
  )
}
