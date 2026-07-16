import { z } from 'zod'
import {
  findDependencies,
  addDependency,
  addDependenciesBatch,
  removeDependency,
  wouldCreateCycle,
} from '@/lib/data/dependencies'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { emitActivity } from '@/lib/data/activity'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerDependencyTools: RegisterFn = (server) => {
  server.tool(
    'list_dependencies',
    'List all task dependencies (blocker relationships) for a project',
    { projectId: z.string().uuid().describe('The project UUID') },
    { title: 'List Dependencies', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    { title: 'Add Dependency', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ projectId, blockerTaskId, blockedTaskId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      if (blockerTaskId === blockedTaskId) {
        return fail('A task cannot depend on itself')
      }
      if (await wouldCreateCycle(blockerTaskId, blockedTaskId, projectId)) {
        return fail('Would create a circular dependency')
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
    { title: 'Remove Dependency', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ projectId, blockerTaskId, blockedTaskId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      await removeDependency(blockerTaskId, blockedTaskId, projectId)
      emitActivity(projectId, 'dependency', blockerTaskId, 'dependency_removed', undefined, { blockerTaskId, blockedTaskId }, uid, 'agent').catch(() => {})
      return ok({ removed: true })
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
    { title: 'Batch Add Dependencies', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ projectId, dependencies }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const result = await addDependenciesBatch(dependencies, projectId)
      return ok(result)
    }
  )
}
