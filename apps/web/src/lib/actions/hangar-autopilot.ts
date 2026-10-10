'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor } from './helpers'
import { assertVorath } from '@/lib/vorath-access'
import {
  hangarResultEnvelopeSchema,
  missionAnswersSchema,
  planRevisionNoteSchema,
  followUpSelectionSchema,
  type MissionAnswers,
} from '@/lib/data/validators'
import { findTaskById } from '@/lib/data/tasks'
import {
  createFollowUpMissionCards,
  findCardSession,
  findFollowUpColumnId,
  findPlanSteps,
  patchCardHangar,
} from '@/lib/data/hangar-autopilot'
import { launchCardMission, type LaunchOverride } from './hangar-launch'

// Hangar autopilot verbs: requeue, plan approve/revise, answer & relaunch and
// follow-up cards. Every verb re-reads the card under requireEditor and goes
// through the shared launch path, so the one-live-mission guard still holds.

async function readEditableMission(projectId: string, taskId: string) {
  assertVorath(await requireEditor(projectId))
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
