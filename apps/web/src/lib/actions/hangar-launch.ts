import { revalidatePath } from 'next/cache'
import { requireEditor } from './helpers'
import {
  hangarCardMetadataSchema,
  HANGAR_MODEL_RE,
  type HangarCardMetadata,
  type HangarObjective,
} from '@/lib/data/validators'
import { findTaskById, recordMissionLaunch } from '@/lib/data/tasks'
import { createAgentSession, findLiveSessionForTask } from '@/lib/data/sessions'
import { patchCardHangar } from '@/lib/data/hangar-autopilot'
import { findHangarRepoBySlug, listHangarRepos } from '@/lib/data/hangar-repos'
import { findProjectRealmIds } from '@/lib/data/workspaces'
import { verifyProjectAccess } from '@/lib/data/projects'
import { findDominionById } from '@/lib/data/dominions'

// Internal launch module shared by the Hangar server actions (hangar.ts,
// hangar-autopilot.ts). Deliberately NOT 'use server': launchCardMission takes
// a phase/context override and must never be callable from the client.

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

export type LaunchPhase = 'plan' | 'build'
export interface LaunchOverride { phase: LaunchPhase | null; context: string | null }
const MAX_CONTEXT_CHARS = 12_000

export async function launchCardMission(
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
