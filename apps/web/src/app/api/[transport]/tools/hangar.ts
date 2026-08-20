import { z } from 'zod'
import {
  agentSessionEngineSchema,
  createHangarRepoSchema,
  updateHangarRepoSchema,
} from '@/lib/data/validators'
import {
  createHangarRepo,
  listHangarRepos,
  findHangarRepoById,
  updateHangarRepo,
  deleteHangarRepo,
} from '@/lib/data/hangar-repos'
import { getGroupRole } from '@/lib/data/workspaces'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

// AI Hangar (Sprint 1) — MCP surface mirrors the REST endpoints under
// /api/v1/hangar-repos/. The registry is realm-scoped: members read, editors
// and owners write. Host-local repo paths never live here — they stay in the
// runner's repos.local.yaml.

// Returns the caller's role, or the message to hand back as a structured tool
// failure — a thrown Error inside a handler reaches the client as an opaque
// transport error instead of a readable refusal.
async function requireRealmEditor(
  realmId: string,
  userId: string,
): Promise<{ role: string } | { error: string }> {
  const role = await getGroupRole(realmId, userId)
  if (!role) return { error: 'Not a member of this realm' }
  if (role === 'viewer') return { error: 'Viewers cannot modify the registry' }
  return { role }
}

export const registerHangarTools: RegisterFn = (server) => {
  server.tool(
    'register_repo',
    'Register a repo in the Hangar registry so agent missions can target it. Realm-scoped; holds the logical repo config only (git remote, default branch, allowed engines) — host paths stay on the runner.',
    {
      realmId:       z.string().uuid().describe('Realm that owns this registry entry'),
      slug:          z.string().min(1).max(120).describe('Repo slug, matching the repo:* label taxonomy'),
      name:          z.string().min(1).max(255).describe('Human-facing repo name'),
      gitUrl:        z.string().min(1).max(500).describe('Git remote URL'),
      ghSlug:        z.string().max(200).nullable().optional().describe('owner/repo — required for GitHub-hosted engines'),
      defaultBranch: z.string().max(120).optional().describe('Base branch missions branch from'),
      branchPrefix:  z.string().max(60).optional().describe('Prefix for mission branches'),
      allowedEngines: z.array(agentSessionEngineSchema).optional().describe('Engines permitted for this repo'),
      runCmd:        z.string().max(500).nullable().optional().describe('Command that starts the live app, when a mission needs it'),
      envSetupCmd:   z.string().max(500).nullable().optional().describe('Command run before the engine starts'),
      appUrl:        z.string().max(500).nullable().optional().describe('Local URL the running app serves on'),
      notes:         z.string().max(4000).nullable().optional().describe('Free-form operator notes'),
      active:        z.boolean().optional().describe('Whether missions may target this repo'),
      metadata:      z.record(z.string(), z.unknown()).optional().describe('Runner-reported capabilities and other free-form data'),
    },
    { title: 'Register Repo', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = createHangarRepoSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const gate = await requireRealmEditor(args.realmId, uid)
      if ('error' in gate) return fail(gate.error)
      const repo = await createHangarRepo(parsed.data)
      return ok(repo)
    }
  )

  server.tool(
    'list_repos',
    'List repos in a realm Hangar registry. Use activeOnly to hide retired entries.',
    {
      realmId:    z.string().uuid().describe('Realm UUID'),
      activeOnly: z.boolean().optional().describe('Only repos still accepting missions'),
    },
    { title: 'List Repos', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ realmId, activeOnly }, extra) => {
      const uid = getUserId(extra)
      const role = await getGroupRole(realmId, uid)
      if (!role) return fail('Not a member of this realm')
      return ok(await listHangarRepos(realmId, { activeOnly: activeOnly ?? false }))
    }
  )

  server.tool(
    'update_repo',
    'Update a Hangar registry entry — branch defaults, allowed engines, run commands, or retire it with active=false.',
    {
      repoId:        z.string().uuid().describe('Registry entry UUID'),
      slug:          z.string().min(1).max(120).optional().describe('Repo slug'),
      name:          z.string().min(1).max(255).optional().describe('Human-facing repo name'),
      gitUrl:        z.string().min(1).max(500).optional().describe('Git remote URL'),
      ghSlug:        z.string().max(200).nullable().optional().describe('owner/repo'),
      defaultBranch: z.string().max(120).optional().describe('Base branch missions branch from'),
      branchPrefix:  z.string().max(60).optional().describe('Prefix for mission branches'),
      allowedEngines: z.array(agentSessionEngineSchema).optional().describe('Engines permitted for this repo'),
      runCmd:        z.string().max(500).nullable().optional().describe('Command that starts the live app'),
      envSetupCmd:   z.string().max(500).nullable().optional().describe('Command run before the engine starts'),
      appUrl:        z.string().max(500).nullable().optional().describe('Local URL the running app serves on'),
      notes:         z.string().max(4000).nullable().optional().describe('Free-form operator notes'),
      active:        z.boolean().optional().describe('Whether missions may target this repo'),
      metadata:      z.record(z.string(), z.unknown()).optional().describe('Runner-reported capabilities'),
    },
    { title: 'Update Repo', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ repoId, ...data }, extra) => {
      const uid = getUserId(extra)
      const existing = await findHangarRepoById(repoId)
      if (!existing) return notFound('Repo')
      const gate = await requireRealmEditor(existing.realmId, uid)
      if ('error' in gate) return fail(gate.error)
      const parsed = updateHangarRepoSchema.safeParse(data)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const repo = await updateHangarRepo(repoId, parsed.data)
      return ok(repo)
    }
  )

  server.tool(
    'delete_repo',
    'Permanently delete a Hangar registry entry. Realm owners only — prefer update_repo with active=false to retire a repo while keeping its history.',
    {
      repoId: z.string().uuid().describe('Registry entry UUID'),
    },
    { title: 'Delete Repo', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async ({ repoId }, extra) => {
      const uid = getUserId(extra)
      const existing = await findHangarRepoById(repoId)
      if (!existing) return notFound('Repo')
      const role = await getGroupRole(existing.realmId, uid)
      if (role !== 'owner') return fail('Only the realm owner can delete a registry entry')
      await deleteHangarRepo(repoId)
      return ok({ deleted: true, repoId })
    }
  )
}
