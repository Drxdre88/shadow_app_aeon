import { z } from 'zod'
import {
  createDominionSchema,
  updateDominionSchema,
  addDominionRepoSchema,
} from '@/lib/data/validators'
import {
  findDominionsByUser,
  findDominionById,
  createDominion as _createDominion,
  updateDominion as _updateDominion,
  deleteDominion as _deleteDominion,
  listDominionRepos,
  addDominionRepo as _addDominionRepo,
  removeDominionRepo as _removeDominionRepo,
} from '@/lib/data/dominions'
import { updateProject as _updateProject } from '@/lib/data/projects'
import { verifyProjectAccess } from '@/lib/data/projects'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

export const registerDominionTools: RegisterFn = (server) => {
  server.tool(
    'create_dominion',
    'Create a Dominion — a user-scoped top-level grouping above Project for the Kairos memory layer; assign repos so Claude session captures auto-resolve their Dominion.',
    {
      name:      z.string().min(1).max(100).describe('Display name for the Dominion'),
      color:     z.string().max(30).optional().describe('Color token, e.g. "purple"'),
      icon:      z.string().max(50).optional().describe('Icon identifier'),
      sortOrder: z.number().int().optional().describe('Sort position among Dominions'),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = createDominionSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const row = await _createDominion(uid, parsed.data)
      return ok({
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
      })
    }
  )

  server.tool(
    'list_dominions',
    'List all Dominions owned by the calling user, ordered by sortOrder then name.',
    {},
    async (_args, extra) => {
      const uid = getUserId(extra)
      const rows = await findDominionsByUser(uid)
      return ok(rows)
    }
  )

  server.tool(
    'get_dominion',
    'Fetch a single Dominion by ID.',
    {
      dominionId: z.string().uuid().describe('Dominion UUID'),
    },
    async ({ dominionId }, extra) => {
      const uid = getUserId(extra)
      const row = await findDominionById(dominionId, uid)
      if (!row) return notFound('Dominion')
      return ok(row)
    }
  )

  server.tool(
    'update_dominion',
    'Update name, color, icon, or sortOrder on an existing Dominion. Pass only the fields you want to change.',
    {
      dominionId: z.string().uuid().describe('Dominion UUID to update'),
      name:      z.string().min(1).max(100).optional(),
      color:     z.string().max(30).optional(),
      icon:      z.string().max(50).optional(),
      sortOrder: z.number().int().optional(),
    },
    async ({ dominionId, ...rest }, extra) => {
      const uid = getUserId(extra)
      const parsed = updateDominionSchema.safeParse(rest)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const row = await _updateDominion(dominionId, uid, parsed.data)
      if (!row) return notFound('Dominion')
      return ok(row)
    }
  )

  server.tool(
    'delete_dominion',
    'Permanently delete a Dominion and all its repo assignments.',
    {
      dominionId: z.string().uuid().describe('Dominion UUID to delete'),
    },
    async ({ dominionId }, extra) => {
      const uid = getUserId(extra)
      const deleted = await _deleteDominion(dominionId, uid)
      if (!deleted) return notFound('Dominion')
      return ok({ deleted: true })
    }
  )

  server.tool(
    'list_dominion_repos',
    'List all repo slugs assigned to a Dominion.',
    {
      dominionId: z.string().uuid().describe('Dominion UUID'),
    },
    async ({ dominionId }, extra) => {
      const uid = getUserId(extra)
      const owned = await findDominionById(dominionId, uid)
      if (!owned) return notFound('Dominion')
      const repos = await listDominionRepos(dominionId, uid)
      return ok({ repos })
    }
  )

  server.tool(
    'add_dominion_repo',
    'Assign a repo slug to a Dominion so session captures resolve to it automatically. Idempotent.',
    {
      dominionId: z.string().uuid().describe('Dominion UUID'),
      repoSlug:   z.string().min(1).max(120).describe('Repo slug, e.g. "owner/repo"'),
    },
    async ({ dominionId, repoSlug }, extra) => {
      const uid = getUserId(extra)
      const parsed = addDominionRepoSchema.safeParse({ dominionId, repoSlug })
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const result = await _addDominionRepo(dominionId, uid, repoSlug)
      if (result === null) return notFound('Dominion')
      return ok({ added: true, dominionId, repoSlug })
    }
  )

  server.tool(
    'remove_dominion_repo',
    'Remove a repo slug assignment from a Dominion.',
    {
      dominionId: z.string().uuid().describe('Dominion UUID'),
      repoSlug:   z.string().min(1).max(120).describe('Repo slug to remove'),
    },
    async ({ dominionId, repoSlug }, extra) => {
      const uid = getUserId(extra)
      const removed = await _removeDominionRepo(dominionId, uid, repoSlug)
      if (!removed) return notFound('Repo assignment')
      return ok({ removed: true })
    }
  )

  server.tool(
    'assign_project_dominion',
    'Assign (or clear) a Dominion on a single project. Pass dominionId=null to clear. The project must be owned/accessible by the caller.',
    {
      projectId:  z.string().uuid().describe('Project UUID'),
      dominionId: z.string().uuid().nullable().describe('Dominion UUID, or null to clear'),
    },
    async ({ projectId, dominionId }, extra) => {
      const uid = getUserId(extra)
      const access = await verifyProjectAccess(projectId, uid)
      if (!access) return notFound('Project')
      if (dominionId !== null) {
        const dom = await findDominionById(dominionId, uid)
        if (!dom) return notFound('Dominion')
      }
      const updated = await _updateProject(projectId, uid, { dominionId })
      if (!updated) return notFound('Project')
      return ok({ projectId, dominionId, name: updated.name })
    }
  )

  server.tool(
    'bulk_assign_projects_to_dominion',
    'Set the same Dominion on many projects in one call — built for voice prompts like "put all my coding projects in Engineering". Pass dominionId=null to clear the assignment on the listed projects. Inaccessible projects are skipped (reported in `skipped`).',
    {
      projectIds: z.array(z.string().uuid()).min(1).max(200).describe('List of project UUIDs'),
      dominionId: z.string().uuid().nullable().describe('Dominion UUID, or null to clear'),
    },
    async ({ projectIds, dominionId }, extra) => {
      const uid = getUserId(extra)
      if (dominionId !== null) {
        const dom = await findDominionById(dominionId, uid)
        if (!dom) return notFound('Dominion')
      }
      const updated: string[] = []
      const skipped: { id: string; reason: string }[] = []
      for (const id of projectIds) {
        const access = await verifyProjectAccess(id, uid)
        if (!access) { skipped.push({ id, reason: 'not accessible' }); continue }
        const row = await _updateProject(id, uid, { dominionId })
        if (row) updated.push(id)
        else skipped.push({ id, reason: 'update failed' })
      }
      return ok({ dominionId, updatedCount: updated.length, updated, skipped })
    }
  )
}
