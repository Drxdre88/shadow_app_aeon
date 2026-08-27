'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor, requireOwnership } from './helpers'
import {
  hangarCardMetadataSchema,
  hangarCardDraftSchema,
  HANGAR_MODEL_RE,
  type HangarCardMetadata,
} from '@/lib/data/validators'
import { findTaskById, updateTask } from '@/lib/data/tasks'
import { createAgentSession, findLiveSessionForTask } from '@/lib/data/sessions'
import { findHangarRepoBySlug, listHangarRepos } from '@/lib/data/hangar-repos'
import { findProjectRealmIds } from '@/lib/data/workspaces'
import { mergeProjectSettings } from '@/lib/data/projects'
import { findColumns } from '@/lib/data/columns'
import { z } from 'zod'

// AI Hangar (Sprint 1) — turn a board card into a queued agent mission.
// The row is deliberately left in 'queued' with no dispatchSpawn call: the
// Hangar model is pull, so a polling runner claims it. The push path stays
// untouched for Kairos.

// The dispatch prompt stays deliberately tiny. Context lives in the repo
// (CLAUDE.md / AGENTS.md), the objective contract lives in a skill, and the
// rest is fetched on demand through the Aeon MCP — flattening the card into
// the prompt would only stale-cache all three.
function buildDispatchPrompt(taskId: string, name: string, hangar: HangarCardMetadata): string {
  const lines = [
    `task_id=${taskId}`,
    `title=${name}`,
    `objective=${hangar.objective}`,
    `repo=${hangar.repo}`,
    `output_mode=${hangar.outputMode}`,
  ]

  const subagents = hangar.subagents ?? []
  if (subagents.length > 0) lines.push(`subagents=${subagents.join(', ')}`)

  lines.push(
    '',
    hangar.instruction,
    '',
    `Load the aeon-dispatch-contract skill and the aeon-objective-${hangar.objective} skill and follow them.`,
    'Read the repo CLAUDE.md (or canonical AGENTS.md) fully. All file paths are relative to the REPO ROOT.',
    'Fetch more context via Aeon MCP get_task_detail if available.',
    // Engines without skill discovery (Copilot/Codex until the junctions land)
    // never see the contract's field spec — the first Copilot mission invented
    // status:'complete' and failed validation. Inline the exact shape.
    'Your FINAL output MUST end with exactly one fenced ```json block — the result envelope. Exact schema (enum values are strict):',
    '```',
    '{ "status": "completed" | "needs_input" | "failed",',
    '  "outcome": "fixed" | "implemented" | "investigation_complete" | "analysis_complete" | "planned" | "blocked",',
    '  "summary": "3-6 plain-English sentences", "branch": "string or null", "commit": "short sha or null",',
    '  "artifacts": ["repo-relative paths"], "tests": { "status": "passed" | "failed" | "not_run", "summary": "..." },',
    '  "questions": [], "recommended_tasks": [{ "title", "objective", "instruction" }] }',
    '```'
  )

  return lines.join('\n')
}

// Registry gate — ADVISORY, not a security boundary. It catches operator
// mistakes (retired repo, engine never onboarded) at launch time, but the
// other session-creation surfaces (REST/MCP spawn) take a free repo string,
// and the real containment is runner-side: a slug absent from the host's
// repos.local.yaml is refused at claim time. The registry is realm-scoped and
// a project can belong to several realms, so the repo passes if ANY realm's
// entry permits it (divergent configs must not make the same card flap).
// Enforcement is opt-in by adoption: realms with empty registries haven't
// onboarded and skip the gate entirely.
async function assertRepoIsRegistered(projectId: string, hangar: HangarCardMetadata) {
  const realmIds = await findProjectRealmIds(projectId)
  if (realmIds.length === 0) return

  const matches = (
    await Promise.all(realmIds.map((realmId) => findHangarRepoBySlug(realmId, hangar.repo)))
  ).filter((repo) => repo !== null)

  if (matches.length > 0) {
    const permitted = matches.some(
      (repo) => repo.active && (repo.allowedEngines.length === 0 || repo.allowedEngines.includes(hangar.agent))
    )
    if (permitted) return
    if (matches.every((repo) => !repo.active)) {
      throw new Error(`Repo "${hangar.repo}" is retired in the Hangar registry`)
    }
    throw new Error(`Engine "${hangar.agent}" is not allowed for repo "${hangar.repo}"`)
  }

  const registries = await Promise.all(realmIds.map((id) => listHangarRepos(id)))
  if (registries.some((entries) => entries.length > 0)) {
    throw new Error(`Repo "${hangar.repo}" is not in the Hangar registry`)
  }
}

export async function spawnSessionFromCard(projectId: string, taskId: string) {
  const userId = await requireEditor(projectId)

  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')

  const metadata = (task.metadata ?? {}) as Record<string, unknown>
  const parsed = hangarCardMetadataSchema.safeParse(metadata.hangar ?? {})
  if (!parsed.success) {
    throw new Error(`Card is not a valid Hangar mission: ${parsed.error.issues[0].message}`)
  }
  const hangar = parsed.data

  // Idempotency gate. A duplicate launch is not cosmetic: every extra session
  // is another real agent on a real repo, opening its own branch. Client-side
  // in-flight tracking cannot cover a second tab, device or operator — only
  // this check can, and every launch path (drop, context menu, editor,
  // MCP/REST) funnels through here.
  const live = await findLiveSessionForTask(taskId)
  if (live) {
    throw new Error(`This card already has a ${live.status} mission — kill it before launching again`)
  }

  await assertRepoIsRegistered(projectId, hangar)

  // Session metadata is untyped jsonb the runner feeds to a CLI — re-check the
  // model charset here rather than trusting the card round-trip.
  const model = hangar.model && HANGAR_MODEL_RE.test(hangar.model) ? hangar.model : null

  const session = await createAgentSession(userId, {
    engine: hangar.agent,
    repo: hangar.repo,
    goal: task.name,
    prompt: buildDispatchPrompt(taskId, task.name, hangar),
    projectId,
    taskId,
    metadata: {
      hangar: {
        objective: hangar.objective,
        model,
        subagents: hangar.subagents,
        outputMode: hangar.outputMode,
        repo: hangar.repo,
      },
    },
  })

  // Disarm after launch: an armed card that stays armed re-fires every time
  // it is dragged back into the launch column. Arming is a per-flight act.
  await updateTask(taskId, projectId, {
    metadata: {
      hangar: {
        ...hangar,
        autoRun: false,
        sessionIds: [...(hangar.sessionIds ?? []), session.id],
        lastLaunchedAt: new Date().toISOString(),
      },
    },
  })

  revalidatePath(`/project/${projectId}`)
  return session
}

/**
 * Repos the mission editor can offer for this board: the union of every
 * realm registry the project belongs to (active entries only).
 */
export async function listProjectHangarRepos(projectId: string) {
  await requireEditor(projectId)
  const realmIds = await findProjectRealmIds(projectId)
  const registries = await Promise.all(realmIds.map((id) => listHangarRepos(id)))
  const bySlug = new Map<string, { slug: string; name: string; allowedEngines: string[] }>()
  for (const repo of registries.flat()) {
    if (!repo.active) continue
    const existing = bySlug.get(repo.slug)
    if (existing) {
      // Divergent realm configs must not hide an engine one realm permits.
      existing.allowedEngines = [...new Set([...existing.allowedEngines, ...repo.allowedEngines])]
    } else {
      bySlug.set(repo.slug, { slug: repo.slug, name: repo.name, allowedEngines: [...repo.allowedEngines] })
    }
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Write a card's mission payload (metadata.hangar) without touching the rest. */
export async function saveCardMission(
  projectId: string,
  taskId: string,
  draft: z.input<typeof hangarCardDraftSchema>
) {
  await requireEditor(projectId)
  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')

  const parsed = hangarCardDraftSchema.parse(draft)
  const existing = ((task.metadata ?? {}) as Record<string, unknown>).hangar
  const preserved = (existing && typeof existing === 'object' && !Array.isArray(existing))
    ? existing as Record<string, unknown>
    : {}

  // sessionIds / lastResult are system-written — never clobbered by an edit.
  await updateTask(taskId, projectId, {
    metadata: { hangar: { ...preserved, ...parsed } },
  })

  revalidatePath(`/project/${projectId}`)
  return parsed
}

/**
 * Columns for the launch-column picker. The dashboard renders the project
 * editor without ever hydrating the board store, so reading columns from the
 * client store there yields an empty list.
 */
export async function listProjectColumnsForHangar(projectId: string) {
  await requireEditor(projectId)
  const columns = await findColumns(projectId)
  return columns
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((c) => ({ id: c.id, name: c.name }))
}

const hangarSettingsSchema = z.object({
  enabled: z.boolean(),
  triggerColumnId: z.string().uuid().nullable(),
})

/**
 * Board-level Auto AI config, stored under projects.settings.hangar.
 *
 * Ownership, not editor: this switch decides whether dropping a card can put
 * an autonomous agent on a repo, which is a different order of privilege from
 * editing cards.
 */
export async function setHangarBoardSettings(
  projectId: string,
  input: { enabled: boolean; triggerColumnId: string | null }
) {
  await requireOwnership(projectId)
  const parsed = hangarSettingsSchema.parse(input)

  // A trigger column from another board would sit in settings looking armed
  // while never matching a drop — silently inert config is worse than none.
  let triggerColumnId = parsed.triggerColumnId
  if (triggerColumnId) {
    const columns = await findColumns(projectId)
    if (!columns.some((c) => c.id === triggerColumnId)) triggerColumnId = null
  }

  const config = { ...parsed, triggerColumnId }
  // SQL merge: settings is one shared jsonb column (board theme, sizing, …),
  // so a read-modify-write here would revert a concurrent save.
  await mergeProjectSettings(projectId, { hangar: config })
  revalidatePath(`/project/${projectId}`)
  return config
}
