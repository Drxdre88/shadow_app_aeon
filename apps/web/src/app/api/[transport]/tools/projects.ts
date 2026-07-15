import { z } from 'zod'
import {
  findProjects,
  findProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectSummary,
  verifyProjectOwnership,
  toggleProjectFavorite,
} from '@/lib/data/projects'
import { createProjectSchema, updateProjectSchema, setFavoriteSchema } from '@/lib/data/validators'
import { emitActivity } from '@/lib/data/activity'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerProjectTools: RegisterFn = (server) => {
  server.tool(
    'list_projects',
    'List all projects for the authenticated user',
    {},
    { title: 'List Projects', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (_args, extra) => ok(await findProjects(getUserId(extra)))
  )

  server.tool(
    'get_project',
    'Get a project by ID',
    { projectId: z.string().uuid().describe('The project UUID') },
    { title: 'Get Project', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    { title: 'Create Project', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    { title: 'Update Project', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ projectId, ...data }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const project = await updateProject(projectId, uid, data)
      if (project) emitActivity(projectId, 'project', projectId, 'updated', project.name, undefined, uid, 'agent').catch(() => {})
      return project ? ok(project) : notFound('Project')
    }
  )

  server.tool(
    'set_project_favorite',
    'Star or unstar a project for the authenticated user',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      ...setFavoriteSchema.shape,
    },
    { title: 'Set Project Favorite', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ projectId, favorite }, extra) => {
      const uid = getUserId(extra)
      await toggleProjectFavorite(uid, projectId, favorite)
      return ok({ favorite })
    }
  )

  server.tool(
    'delete_project',
    'Delete a project and all its data',
    { projectId: z.string().uuid().describe('The project UUID') },
    { title: 'Delete Project', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ projectId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteProject(projectId, uid)
      if (deleted) emitActivity(projectId, 'project', projectId, 'deleted', undefined, undefined, uid, 'agent').catch(() => {})
      return deleted ? ok({ deleted: true }) : notFound('Project')
    }
  )

  server.tool(
    'project_summary',
    'Get task counts by status, overdue items, and progress for a project',
    { projectId: z.string().uuid().describe('The project UUID') },
    { title: 'Project Summary', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const summary = await getProjectSummary(projectId, uid)
      return summary ? ok(summary) : notFound('Project')
    }
  )
}
