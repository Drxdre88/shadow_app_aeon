import { z } from 'zod'
import { findColumns, createColumn } from '@/lib/data/columns'
import { findLabels, createLabel, setTaskLabels } from '@/lib/data/labels'
import { createTasksBatch } from '@/lib/data/tasks'
import { createChecklistItemsBatch } from '@/lib/data/checklist'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { emitActivity } from '@/lib/data/activity'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerBulkTools: RegisterFn = (server) => {
  server.tool(
    'setup_board',
    'Set up an entire board in one call: columns, labels, tasks with optional checklist and label assignments',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      columns: z.array(z.object({
        name: z.string().min(1).max(255),
        color: z.string().max(20).default('purple'),
        icon: z.string().max(50).optional(),
      })).optional().describe('Columns to create'),
      labels: z.array(z.object({
        name: z.string().min(1).max(100),
        color: z.string().max(20).default('purple'),
      })).optional().describe('Labels to create'),
      tasks: z.array(z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(10000).optional(),
        status: z.enum(['todo', 'in-progress', 'done']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        color: z.string().max(20).optional(),
        columnName: z.string().optional().describe('Match to a column by name (from columns array)'),
        labelNames: z.array(z.string()).optional().describe('Match to labels by name (from labels array)'),
        checklist: z.array(z.object({
          title: z.string().min(1).max(255),
          groupName: z.string().max(100).optional(),
        })).optional(),
      })).optional().describe('Tasks to create with optional checklist and label links'),
    },
    async ({ projectId, columns, labels: labelDefs, tasks }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')

      const columnMap = new Map<string, string>()
      const existingColumns = await findColumns(projectId)
      for (const col of existingColumns) {
        columnMap.set(col.name.toLowerCase(), col.id)
      }
      if (columns && columns.length > 0) {
        for (let i = 0; i < columns.length; i++) {
          const col = await createColumn(projectId, { ...columns[i], orderIndex: existingColumns.length + i })
          columnMap.set(columns[i].name.toLowerCase(), col.id)
        }
      }

      const labelMap = new Map<string, string>()
      const existingLabels = await findLabels(projectId)
      for (const lbl of existingLabels) {
        labelMap.set(lbl.name.toLowerCase(), lbl.id)
      }
      if (labelDefs && labelDefs.length > 0) {
        for (const ld of labelDefs) {
          const lbl = await createLabel(projectId, ld)
          labelMap.set(ld.name.toLowerCase(), lbl.id)
        }
      }

      let taskCount = 0
      let checklistCount = 0
      if (tasks && tasks.length > 0) {
        const taskValues = tasks.map((t) => ({
          name: t.name,
          description: t.description,
          status: t.status,
          priority: t.priority,
          color: t.color,
          columnId: t.columnName ? columnMap.get(t.columnName.toLowerCase()) : undefined,
        }))
        const created = await createTasksBatch(projectId, taskValues)
        taskCount = created.length

        for (let i = 0; i < created.length; i++) {
          const taskDef = tasks[i]
          const taskId = created[i].id

          if (taskDef.labelNames && taskDef.labelNames.length > 0) {
            const ids = taskDef.labelNames
              .map((n) => labelMap.get(n.toLowerCase()))
              .filter((id): id is string => !!id)
            if (ids.length > 0) await setTaskLabels(taskId, ids, projectId)
          }

          if (taskDef.checklist && taskDef.checklist.length > 0) {
            const items = await createChecklistItemsBatch(taskId, taskDef.checklist)
            checklistCount += items.length
          }
        }
      }

      const newColumnCount = columns?.length ?? 0
      const newLabelCount = labelDefs?.length ?? 0
      emitActivity(projectId, 'project', projectId, 'updated', undefined, { via: 'setup_board', columns: newColumnCount, labels: newLabelCount, tasks: taskCount }, uid, 'agent').catch(() => {})
      return ok({
        columns: columnMap.size,
        labels: labelMap.size,
        tasks: taskCount,
        checklistItems: checklistCount,
      })
    }
  )
}
