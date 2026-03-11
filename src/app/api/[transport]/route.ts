import { createMcpHandler } from 'mcp-handler'
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
import { findTasks, createTask, updateTask, deleteTask } from '@/lib/data/tasks'
import { findDependencies, addDependency, removeDependency, wouldCreateCycle } from '@/lib/data/dependencies'
import { findLabels, findTaskLabels, createLabel, deleteLabel, addLabelToTask, removeLabelFromTask } from '@/lib/data/labels'
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

const userId = () => {
  const id = process.env.AEON_API_USER_ID
  if (!id) throw new Error('AEON_API_USER_ID not configured')
  return id
}

const notFound = (entity: string) => ({
  content: [{ type: 'text' as const, text: `${entity} not found` }],
  isError: true as const,
})

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
})

async function requireOwnership(projectId: string) {
  const project = await verifyProjectOwnership(projectId, userId())
  return !!project
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.tool(
      'list_projects',
      'List all projects for the authenticated user',
      {},
      async () => ok(await findProjects(userId()))
    )

    server.tool(
      'get_project',
      'Get a project by ID',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }) => {
        const project = await findProjectById(projectId, userId())
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
      async (input) => ok(await createProject(userId(), input))
    )

    server.tool(
      'update_project',
      'Update an existing project',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        ...updateProjectSchema.shape,
      },
      async ({ projectId, ...data }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        const project = await updateProject(projectId, data)
        return project ? ok(project) : notFound('Project')
      }
    )

    server.tool(
      'delete_project',
      'Delete a project and all its data',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        const deleted = await deleteProject(projectId)
        return deleted
          ? ok({ deleted: true })
          : notFound('Project')
      }
    )

    server.tool(
      'list_columns',
      'List board columns for a project',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
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
      async ({ projectId, ...data }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        return ok(await createColumn(projectId, data))
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
      async ({ projectId, columnId, ...data }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        const col = await updateColumn(columnId, projectId, data)
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
      async ({ projectId, columnId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        const deleted = await deleteColumnData(columnId, projectId)
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
      async ({ projectId, updates }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
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
      },
      async ({ projectId, status, priority }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        return ok(await findTasks(projectId, { status, priority }))
      }
    )

    server.tool(
      'create_task',
      'Create a board task in a project',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        columnId: z.string().uuid().optional().describe('The column UUID to place task in'),
        ...createTaskSchema.pick({ name: true, description: true, status: true, priority: true, color: true }).shape,
      },
      async ({ projectId, columnId, ...data }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        return ok(await createTask(projectId, {
          ...data,
          columnId,
          onTimeline: false,
          status: data.status ?? 'todo',
          priority: data.priority ?? 'medium',
          color: data.color ?? 'purple',
        }))
      }
    )

    server.tool(
      'update_task',
      'Update a board task',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        taskId: z.string().uuid().describe('The task UUID'),
        columnId: z.string().uuid().optional().describe('Move task to this column'),
        ...updateTaskSchema.pick({ name: true, description: true, status: true, priority: true, color: true }).shape,
      },
      async ({ projectId, taskId, columnId, ...data }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        const task = await updateTask(taskId, projectId, { ...data, columnId })
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
      async ({ projectId, taskId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        const deleted = await deleteTask(taskId, projectId)
        return deleted ? ok({ deleted: true }) : notFound('Task')
      }
    )

    server.tool(
      'list_gantt_tasks',
      'List gantt tasks and rows for a project',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
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
      async ({ projectId, ...data }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
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
      async ({ projectId, taskId, ...data }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
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
      async ({ projectId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        const summary = await getProjectSummary(projectId, userId())
        return summary ? ok(summary) : notFound('Project')
      }
    )

    server.tool(
      'list_dependencies',
      'List all task dependencies (blocker relationships) for a project',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
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
      async ({ projectId, blockerTaskId, blockedTaskId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        if (blockerTaskId === blockedTaskId) {
          return { content: [{ type: 'text' as const, text: 'A task cannot depend on itself' }], isError: true as const }
        }
        if (await wouldCreateCycle(blockerTaskId, blockedTaskId)) {
          return { content: [{ type: 'text' as const, text: 'Would create a circular dependency' }], isError: true as const }
        }
        await addDependency(blockerTaskId, blockedTaskId)
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
      async ({ projectId, blockerTaskId, blockedTaskId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        await removeDependency(blockerTaskId, blockedTaskId)
        return ok({ removed: true })
      }
    )

    server.tool(
      'list_labels',
      'List all labels for a project, and which tasks they are assigned to',
      { projectId: z.string().uuid().describe('The project UUID') },
      async ({ projectId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        const [projectLabels, assignments] = await Promise.all([
          findLabels(projectId),
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
      async ({ projectId, ...data }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
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
      async ({ projectId, labelId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
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
      async ({ projectId, taskId, labelId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        await addLabelToTask(taskId, labelId)
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
      async ({ projectId, taskId, labelId }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        await removeLabelFromTask(taskId, labelId)
        return ok({ removed: true })
      }
    )
  },
  { capabilities: {} },
  {
    basePath: '/api',
    verboseLogs: false,
  }
)

export { mcpHandler as GET, mcpHandler as POST, mcpHandler as DELETE }
