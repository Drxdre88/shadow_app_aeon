import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser } from '@/lib/api/auth'
import { z } from 'zod'
import {
  findProjects,
  findProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectSummary,
  verifyProjectOwnership,
} from '@/lib/data/projects'
import { findTasks, createTask, createTasksBatch, updateTask, deleteTask } from '@/lib/data/tasks'
import { findDependencies, addDependency, addDependenciesBatch, removeDependency, wouldCreateCycle } from '@/lib/data/dependencies'
import { findLabels, findTaskLabels, createLabel, deleteLabel, addLabelToTask, removeLabelFromTask, setTaskLabels } from '@/lib/data/labels'
import {
  findColumns,
  createColumn,
  updateColumn,
  deleteColumn as deleteColumnData,
  reorderColumns,
} from '@/lib/data/columns'
import {
  findGanttTasksWithRows,
  createGanttTask,
  updateGanttTask,
  deleteGanttTask,
  verifyRowOwnership,
} from '@/lib/data/gantt'
import {
  findChecklistItems,
  createChecklistItem,
  createChecklistItemsBatch,
  updateChecklistItem,
  deleteChecklistItem,
  findTaskWithDetails,
} from '@/lib/data/checklist'
import {
  createProjectSchema,
  updateProjectSchema,
  createTaskSchema,
  updateTaskSchema,
  createGanttTaskSchema,
  updateGanttTaskSchema,
  createColumnSchema,
  updateColumnSchema,
  createLabelSchema,
} from '@/lib/data/validators'
import { emitActivity } from '@/lib/data/activity'
import { getVelocityStats } from '@/lib/data/velocity'

type Extra = { authInfo?: AuthInfo }

function getUserId(extra: Extra): string {
  const uid = extra.authInfo?.extra?.userId as string | undefined
  if (!uid) throw new Error('User not authenticated')
  return uid
}

async function requireOwnership(projectId: string, uid: string) {
  const project = await verifyProjectOwnership(projectId, uid)
  return !!project
}

const notFound = (entity: string) => ({
  content: [{ type: 'text' as const, text: `${entity} not found` }],
  isError: true as const,
})

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
})

async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined
  const fakeReq = new NextRequest('http://localhost', {
    headers: new Headers({ authorization: `Bearer ${bearerToken}` }),
  })
  const result = await authenticateRequest(fakeReq)
  if (!isApiUser(result)) return undefined
  return {
    token: bearerToken,
    clientId: result.id,
    scopes: [result.role],
    extra: { userId: result.id, role: result.role },
  }
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.tool(
      'list_projects',
      'List all projects for the authenticated user',
      {},
      async (_args, extra) => ok(await findProjects(getUserId(extra)))
    )

    server.tool(
      'get_project',
      'Get a project by ID',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }, extra) => {
        const uid = getUserId(extra)
        const project = await findProjectById(projectId, uid)
        return project ? ok(project) : notFound('Project')
      }
    )

    server.tool(
      'create_project',
      'Create a new project',
      {
        ...createProjectSchema.shape,
        name: createProjectSchema.shape.name.describe('Project name'),
        startDate: createProjectSchema.shape.startDate.describe('Start date (ISO 8601)'),
        endDate: createProjectSchema.shape.endDate.describe('End date (ISO 8601)'),
      },
      async (input, extra) => {
        const uid = getUserId(extra)
        const project = await createProject(uid, input)
        emitActivity(project.id, 'project', project.id, 'created', project.name, undefined, uid, 'agent').catch(() => {})
        return ok(project)
      }
    )

    server.tool(
      'update_project',
      'Update an existing project',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        ...updateProjectSchema.shape,
      },
      async ({ projectId, ...data }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        const project = await updateProject(projectId, uid, data)
        if (project) emitActivity(projectId, 'project', projectId, 'updated', project.name, undefined, uid, 'agent').catch(() => {})
        return project ? ok(project) : notFound('Project')
      }
    )

    server.tool(
      'delete_project',
      'Delete a project and all its data',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        const deleted = await deleteProject(projectId, uid)
        if (deleted) emitActivity(projectId, 'project', projectId, 'deleted', undefined, undefined, uid, 'agent').catch(() => {})
        return deleted
          ? ok({ deleted: true })
          : notFound('Project')
      }
    )

    server.tool(
      'list_columns',
      'List board columns for a project',
      { projectId: z.string().uuid().describe('The project UUID') },
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
      async ({ projectId, updates }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        await reorderColumns(projectId, updates)
        return ok({ reordered: true })
      }
    )

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
          size: true, startDate: true, endDate: true, onTimeline: true,
        }).shape,
      },
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
          size: true, startDate: true, endDate: true, onTimeline: true,
        }).shape,
      },
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
      async ({ projectId, taskId }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        const deleted = await deleteTask(taskId, projectId)
        if (deleted) emitActivity(projectId, 'task', taskId, 'deleted', undefined, undefined, uid, 'agent').catch(() => {})
        return deleted ? ok({ deleted: true }) : notFound('Task')
      }
    )

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
      'project_summary',
      'Get task counts by status, overdue items, and progress for a project',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        const summary = await getProjectSummary(projectId, uid)
        return summary ? ok(summary) : notFound('Project')
      }
    )

    server.tool(
      'list_dependencies',
      'List all task dependencies (blocker relationships) for a project',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        return ok(await findDependencies(projectId))
      }
    )

    server.tool(
      'add_dependency',
      'Add a dependency between two tasks. blockerTaskId must complete before blockedTaskId can proceed',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        blockerTaskId: z.string().uuid().describe('The task that must complete first'),
        blockedTaskId: z.string().uuid().describe('The task that is blocked'),
      },
      async ({ projectId, blockerTaskId, blockedTaskId }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        if (blockerTaskId === blockedTaskId) {
          return { content: [{ type: 'text' as const, text: 'A task cannot depend on itself' }], isError: true as const }
        }
        if (await wouldCreateCycle(blockerTaskId, blockedTaskId, projectId)) {
          return { content: [{ type: 'text' as const, text: 'Would create a circular dependency' }], isError: true as const }
        }
        await addDependency(blockerTaskId, blockedTaskId, projectId)
        emitActivity(projectId, 'dependency', blockerTaskId, 'dependency_added', undefined, { blockerTaskId, blockedTaskId }, uid, 'agent').catch(() => {})
        return ok({ added: true, blockerTaskId, blockedTaskId })
      }
    )

    server.tool(
      'remove_dependency',
      'Remove a dependency between two tasks',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        blockerTaskId: z.string().uuid().describe('The blocker task UUID'),
        blockedTaskId: z.string().uuid().describe('The blocked task UUID'),
      },
      async ({ projectId, blockerTaskId, blockedTaskId }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        await removeDependency(blockerTaskId, blockedTaskId, projectId)
        emitActivity(projectId, 'dependency', blockerTaskId, 'dependency_removed', undefined, { blockerTaskId, blockedTaskId }, uid, 'agent').catch(() => {})
        return ok({ removed: true })
      }
    )

    server.tool(
      'list_labels',
      'List all labels for a project, and which tasks they are assigned to',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        limit: z.number().int().min(1).max(500).default(100).describe('Max results (default 100, max 500)'),
        offset: z.number().int().min(0).default(0).describe('Skip N results (default 0)'),
      },
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
      async ({ projectId, taskId, labelId }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        await removeLabelFromTask(taskId, labelId, projectId)
        emitActivity(projectId, 'label', taskId, 'label_removed', undefined, { labelId, taskId }, uid, 'agent').catch(() => {})
        return ok({ removed: true })
      }
    )

    server.tool(
      'get_task_detail',
      'Get full card detail: task fields, checklist items, labels, and dependencies in one call',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        taskId: z.string().uuid().describe('The task UUID'),
      },
      async ({ projectId, taskId }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        const detail = await findTaskWithDetails(taskId, projectId)
        return detail ? ok(detail) : notFound('Task')
      }
    )

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

    server.tool(
      'set_task_labels',
      'Set all labels on a task (replaces existing). Pass empty array to clear.',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        taskId: z.string().uuid().describe('The task UUID'),
        labelIds: z.array(z.string().uuid()).max(50).describe('Label IDs to assign (replaces all current labels)'),
      },
      async ({ projectId, taskId, labelIds }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        await setTaskLabels(taskId, labelIds, projectId)
        return ok({ set: true, taskId, labelCount: labelIds.length })
      }
    )

    server.tool(
      'batch_add_dependencies',
      'Add multiple task dependencies in one call. Skips self-refs and cycles.',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        dependencies: z.array(z.object({
          blockerTaskId: z.string().uuid().describe('Task that must complete first'),
          blockedTaskId: z.string().uuid().describe('Task that is blocked'),
        })).min(1).max(100).describe('Array of dependency pairs'),
      },
      async ({ projectId, dependencies }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        const result = await addDependenciesBatch(dependencies, projectId)
        return ok(result)
      }
    )

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

        emitActivity(projectId, 'project', projectId, 'updated', undefined, { via: 'setup_board', columns: columnMap.size, labels: labelMap.size, tasks: taskCount }, uid, 'agent').catch(() => {})
        return ok({
          columns: columnMap.size,
          labels: labelMap.size,
          tasks: taskCount,
          checklistItems: checklistCount,
        })
      }
    )

    server.tool(
      'get_velocity_stats',
      'Get velocity analytics for a project: completion rate, cycle times, column dwell times, activity heatmap, priority breakdown',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        range: z.enum(['7d', '30d', '90d', 'all']).default('30d').describe('Time range for analysis'),
      },
      async ({ projectId, range }, extra) => {
        const uid = getUserId(extra)
        if (!await requireOwnership(projectId, uid)) return notFound('Project')
        return ok(await getVelocityStats(projectId, range))
      }
    )
  },
  { capabilities: {} },
  {
    basePath: '/api',
    verboseLogs: false,
  }
)

const handler = withMcpAuth(
  (req) => mcpHandler(req as unknown as import('next/server').NextRequest),
  verifyToken,
  { required: true }
)

export { handler as GET, handler as POST, handler as DELETE }
