'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor, requireOwner } from './helpers'
import {
  hangarCardMetadataSchema,
  hangarCardDraftSchema,
  hangarResultEnvelopeSchema,
  missionAnswersSchema,
  planRevisionNoteSchema,
  followUpSelectionSchema,
  HANGAR_MODEL_RE,
  type HangarCardMetadata,
  type HangarObjective,
  type MissionAnswers,
} from '@/lib/data/validators'
import { findTaskById, updateTask, recordMissionLaunch } from '@/lib/data/tasks'
import { createAgentSession, findLiveSessionForTask } from '@/lib/data/sessions'
import {
  createFollowUpMissionCards,
  findCardSession,
  findFollowUpColumnId,
  findPlanSteps,
  patchCardHangar,
} from '@/lib/data/hangar-autopilot'
import { findHangarRepoBySlug, listHangarRepos } from '@/lib/data/hangar-repos'
import { findProjectRealmIds } from '@/lib/data/workspaces'
import { mergeProjectSettings, verifyProjectAccess } from '@/lib/data/projects'
import { findDominionById } from '@/lib/data/dominions'
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
function buildDispatchPrompt(
  taskId: string,
  name: string,
  hangar: HangarCardMetadata,
  launch: { objective: HangarObjective; phase: LaunchPhase | null; context: string | null } = { objective: hangar.objective, phase: null, context: null },
): string {
  const lines = [
    `task_id=${taskId}`,
    `title=${name}`,
    `objective=${launch.objective}`,
    `repo=${hangar.repo}`,
    `output_mode=${hangar.outputMode}`,
  ]

  const subagents = hangar.subagents ?? []
  if (subagents.length > 0) lines.push(`subagents=${subagents.join(', ')}`)

  lines.push('', hangar.instruction)
  if (launch.phase === 'plan') {
    lines.push(
      '',
      'PLANNING STEP ONLY: do not change any files. Write a step-by-step plan for the mission above.',
      `List every step, in order, in recommended_tasks (title = the step, objective = ${hangar.objective}, instruction = how to do it) and set outcome to "planned". The owner approves the plan before any build starts.`,
    )
  }
  if (launch.context) lines.push('', 'Context from earlier runs on this card:', launch.context)

  lines.push(
    '',
    `Load the aeon-dispatch-contract skill and the aeon-objective-${launch.objective} skill and follow them.`,
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

/**
 * The Dominion a mission files under: the card's project Dominion, but only
 * when the launching user owns it — Dominions are per-user, and a realm
 * editor launching on someone else's board must not tag their session into
 * the owner's Dominion. Best-effort: a lookup failure never blocks a launch.
 */
async function resolveLaunchDominion(projectId: string, userId: string): Promise<string | null> {
  try {
    const access = await verifyProjectAccess(projectId, userId)
    const dominionId = access?.project.dominionId ?? null
    if (!dominionId) return null
    const dominion = await findDominionById(dominionId, userId)
    return dominion ? dominion.id : null
  } catch (err) {
    console.error('[hangar] dominion lookup failed; launching unfiled', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * @param origin 'manual' = the operator explicitly hit Execute / Save &
 * Launch. 'auto-drop' = a column move fired it, which is only legitimate
 * while the card is armed IN THE DATABASE — the client's copy of `autoRun`
 * can be stale (a launch disarms the card, and that write reaches the board
 * asynchronously), so an auto-drop must re-check the stored value or a stale
 * card could launch a second agent after its first mission finished.
 */
export async function spawnSessionFromCard(
  projectId: string,
  taskId: string,
  origin: 'manual' | 'auto-drop' = 'manual'
) {
  return launchCardMission(projectId, taskId, origin, null)
}

type LaunchPhase = 'plan' | 'build'
interface LaunchOverride { phase: LaunchPhase | null; context: string | null }
const MAX_CONTEXT_CHARS = 12_000

async function launchCardMission(
  projectId: string,
  taskId: string,
  origin: 'manual' | 'auto-drop',
  override: LaunchOverride | null,
) {
  const userId = await requireEditor(projectId)

  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')

  const metadata = (task.metadata ?? {}) as Record<string, unknown>
  const parsed = hangarCardMetadataSchema.safeParse(metadata.hangar ?? {})
  if (!parsed.success) {
    throw new Error(`Card is not a valid Hangar mission: ${parsed.error.issues[0].message}`)
  }
  const hangar = parsed.data

  // A drop can only launch a card the DATABASE says is armed. The client's
  // view of autoRun goes stale the moment a launch disarms the card.
  if (origin === 'auto-drop' && hangar.autoRun !== true) {
    throw new Error('This mission is not armed for auto-run')
  }

  // Fast, friendly duplicate check. The authoritative guard is the partial
  // unique index behind createAgentSession (migration 0033) — this one just
  // avoids doing the registry round-trips before failing.
  const live = await findLiveSessionForTask(taskId)
  if (live) {
    throw new Error(`This card already has a ${live.status} mission — kill it before launching again`)
  }

  await assertRepoIsRegistered(projectId, hangar)

  // Session metadata is untyped jsonb the runner feeds to a CLI — re-check the
  // model charset here rather than trusting the card round-trip.
  const model = hangar.model && HANGAR_MODEL_RE.test(hangar.model) ? hangar.model : null

  const dominionId = await resolveLaunchDominion(projectId, userId)

  // Plan-then-approve: a plain launch of a "plan first" card runs the plan
  // objective; relaunches carry the phase and context of the run they repeat.
  const phase = override ? override.phase : (hangar.planFirst === true && hangar.objective !== 'plan' ? 'plan' : null)
  const context = override?.context ? override.context.slice(-MAX_CONTEXT_CHARS) : null
  const objective: HangarObjective = phase === 'plan' ? 'plan' : hangar.objective

  const session = await createAgentSession(userId, {
    engine: hangar.agent,
    repo: hangar.repo,
    goal: task.name,
    prompt: buildDispatchPrompt(taskId, task.name, hangar, { objective, phase, context }),
    projectId,
    taskId,
    ...(dominionId ? { dominionId } : {}),
    metadata: {
      hangar: {
        objective,
        model,
        subagents: hangar.subagents,
        outputMode: hangar.outputMode,
        repo: hangar.repo,
        ...(phase ? { phase } : {}),
        ...(context ? { context } : {}),
      },
    },
  })

  // Disarm after launch: an armed card that stays armed re-fires every time
  // it is dragged back into the launch column. Arming is a per-flight act.
  // Written key-by-key in SQL so a concurrent editor save cannot be clobbered
  // (and cannot re-arm the card we just disarmed).
  await recordMissionLaunch(taskId, projectId, session.id, new Date().toISOString())
  if (phase === 'plan') {
    await patchCardHangar(taskId, projectId, { planGate: { status: 'planning', sessionId: session.id, at: new Date().toISOString() } })
  }

  revalidatePath(`/project/${projectId}`)
  return session
}

async function readEditableMission(projectId: string, taskId: string) {
  await requireEditor(projectId)
  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')
  const hangar = ((task.metadata ?? {}) as Record<string, unknown>).hangar
  if (!hangar || typeof hangar !== 'object' || Array.isArray(hangar)) throw new Error('This card is not an agent mission')
  return { task, hangar: hangar as Record<string, unknown> }
}

async function findLastCardSession(taskId: string, hangar: Record<string, unknown>) {
  const ids = Array.isArray(hangar.sessionIds) ? hangar.sessionIds.filter((id): id is string => typeof id === 'string') : []
  const last = ids.at(-1)
  return last ? findCardSession(last, taskId) : null
}

function launchStateOf(session: { metadata: unknown } | null): LaunchOverride {
  const meta = ((session?.metadata ?? {}) as { hangar?: { phase?: unknown; context?: unknown } }).hangar ?? {}
  return {
    phase: meta.phase === 'plan' || meta.phase === 'build' ? meta.phase : null,
    context: typeof meta.context === 'string' && meta.context.length > 0 ? meta.context : null,
  }
}

const numbered = (steps: string[]) => steps.map((step, index) => `${index + 1}. ${step}`).join('\n')

const RELAUNCHABLE_STATUSES = new Set(['timeout', 'failed', 'killed'])

/** Relaunch a card whose latest run stopped (timed out, failed or killed), repeating that run's phase. */
export async function requeueMission(projectId: string, taskId: string) {
  const { hangar } = await readEditableMission(projectId, taskId)
  const last = await findLastCardSession(taskId, hangar)
  if (!last || !RELAUNCHABLE_STATUSES.has(last.status)) {
    throw new Error('Only a mission whose last run stopped can be requeued')
  }
  return launchCardMission(projectId, taskId, 'manual', launchStateOf(last))
}

async function readPendingPlan(projectId: string, taskId: string) {
  const { hangar } = await readEditableMission(projectId, taskId)
  const gate = hangar.planGate as { status?: unknown; sessionId?: unknown } | undefined
  if (gate?.status !== 'awaiting_approval') throw new Error('This card has no plan waiting for approval')
  const steps = await findPlanSteps(taskId)
  if (steps.length === 0) throw new Error('The Plan checklist is empty — revise the plan instead')
  return { gate, steps }
}

/** Launch the build mission with the card's (possibly edited) Plan checklist as the approved plan. */
export async function approvePlanAndBuild(projectId: string, taskId: string) {
  const { gate, steps } = await readPendingPlan(projectId, taskId)
  const context = `The owner approved this plan. Follow it step by step:\n${numbered(steps)}`
  const session = await launchCardMission(projectId, taskId, 'manual', { phase: 'build', context })
  await patchCardHangar(taskId, projectId, {
    planGate: { status: 'approved', sessionId: gate.sessionId ?? null, buildSessionId: session.id, at: new Date().toISOString() },
  })
  return session
}

/** Re-run the planning step with the owner's note and the previous plan. */
export async function revisePlan(projectId: string, taskId: string, note: string) {
  const parsedNote = planRevisionNoteSchema.parse(note)
  const { steps } = await readPendingPlan(projectId, taskId)
  const context = `The owner asked for changes to your previous plan.\nOwner's note: ${parsedNote}\nPrevious plan:\n${numbered(steps)}`
  return launchCardMission(projectId, taskId, 'manual', { phase: 'plan', context })
}

/** Relaunch with the owner's answers to the agent's questions appended to the instruction. */
export async function answerAndRelaunch(projectId: string, taskId: string, answers: MissionAnswers) {
  const parsed = missionAnswersSchema.parse(answers)
  const { hangar } = await readEditableMission(projectId, taskId)
  const last = launchStateOf(await findLastCardSession(taskId, hangar))
  const lastResult = (hangar.lastResult ?? {}) as { summary?: unknown }
  const answered = parsed.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join('\n\n')
  const context = [
    last.context,
    typeof lastResult.summary === 'string' && lastResult.summary ? `Summary of the previous run: ${lastResult.summary}` : null,
    `The previous run asked questions. The owner's answers:\n${answered}`,
  ].filter(Boolean).join('\n\n')
  return launchCardMission(projectId, taskId, 'manual', { phase: last.phase, context })
}

/** Turn chosen recommended follow-ups from the card's last result into new mission cards. */
export async function createFollowUpCards(projectId: string, taskId: string, indexes: number[]) {
  const picked = followUpSelectionSchema.parse(indexes)
  const { task, hangar } = await readEditableMission(projectId, taskId)
  const recommended = hangarResultEnvelopeSchema.shape.recommended_tasks
    .safeParse(((hangar.lastResult ?? {}) as { recommended_tasks?: unknown }).recommended_tasks)
  const available = recommended.success ? recommended.data ?? [] : []
  const picks = [...new Set(picked)].flatMap((index) => (available[index] ? [available[index]] : []))
  if (picks.length === 0) throw new Error('None of the chosen follow-ups exist on the latest result')

  const columnId = await findFollowUpColumnId(projectId)
  const created = await createFollowUpMissionCards(
    { id: task.id, projectId, name: task.name, hangar },
    picks,
    columnId,
  )
  revalidatePath(`/project/${projectId}`)
  return created.map((card) => ({ id: card.id, name: card.name }))
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
  await requireOwner(projectId)
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
