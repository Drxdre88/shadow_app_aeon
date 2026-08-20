'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor } from './helpers'
import { hangarCardMetadataSchema, HANGAR_MODEL_RE, type HangarCardMetadata } from '@/lib/data/validators'
import { findTaskById, updateTask } from '@/lib/data/tasks'
import { createAgentSession } from '@/lib/data/sessions'

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

  await updateTask(taskId, projectId, {
    metadata: {
      hangar: { ...hangar, sessionIds: [...(hangar.sessionIds ?? []), session.id] },
    },
  })

  revalidatePath(`/project/${projectId}`)
  return session
}
