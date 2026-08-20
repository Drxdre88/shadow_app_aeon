import { z } from 'zod'
import {
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

// The advertised shapes are derived from the shared validators so MCP cannot
// drift from REST; only the agent-facing wording is written by hand here.
const REPO_FIELD_DOCS: Record<string, string> = {
  realmId:        'Realm that owns this registry entry',
  slug:           'Repo slug, matching the repo:* label taxonomy',
  name:           'Human-facing repo name',
  gitUrl:         'Git remote URL',
  ghSlug:         'owner/repo — required for GitHub-hosted engines',
  defaultBranch:  'Base branch missions branch from',
  branchPrefix:   'Prefix for mission branches',
  allowedEngines: 'Engines permitted for this repo',
  runCmd:         'Command that starts the live app, when a mission needs it',
  envSetupCmd:    'Command run before the engine starts',
  appUrl:         'Local URL the running app serves on',
  notes:          'Free-form operator notes',
  active:         'Whether missions may target this repo',
  metadata:       'Runner-reported capabilities and other free-form data',
}

function documented<T extends z.ZodRawShape>(shape: T): T {
  const entries = Object.entries(shape) as Array<[string, z.ZodType]>
  return Object.fromEntries(
    entries.map(([key, schema]) => {
      const doc = REPO_FIELD_DOCS[key]
      return [key, doc ? schema.describe(doc) : schema]
    })
  ) as unknown as T
}

export const registerHangarTools: RegisterFn = (server) => {
  server.tool(
    'register_hangar_repo',
    'Register a repo in the Hangar registry so agent missions can target it. Realm-scoped; holds the logical repo config only (git remote, default branch, allowed engines) — host paths stay on the runner.',
    documented(createHangarRepoSchema.shape),
    { title: 'Register Hangar Repo', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    'list_hangar_repos',
    'List repos in a realm Hangar registry. Use activeOnly to hide retired entries.',
    {
      realmId:    z.string().uuid().describe('Realm UUID'),
      activeOnly: z.boolean().optional().describe('Only repos still accepting missions'),
    },
    { title: 'List Hangar Repos', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ realmId, activeOnly }, extra) => {
      const uid = getUserId(extra)
      const role = await getGroupRole(realmId, uid)
      if (!role) return fail('Not a member of this realm')
      return ok(await listHangarRepos(realmId, { activeOnly: activeOnly ?? false }))
    }
  )

  server.tool(
    'update_hangar_repo',
    'Update a Hangar registry entry — branch defaults, allowed engines, run commands, or retire it with active=false.',
    {
      repoId: z.string().uuid().describe('Registry entry UUID'),
      ...documented(updateHangarRepoSchema.shape),
    },
    { title: 'Update Hangar Repo', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
    'delete_hangar_repo',
    'Permanently delete a Hangar registry entry. Realm owners only — prefer update_hangar_repo with active=false to retire a repo while keeping its history.',
    {
      repoId: z.string().uuid().describe('Registry entry UUID'),
    },
    { title: 'Delete Hangar Repo', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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
