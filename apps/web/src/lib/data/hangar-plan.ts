import { db } from '@/lib/db'
import { boardTasks, checklistItems, type AgentSession } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { HANGAR_PLAN_GROUP, type HangarResultEnvelope } from './validators'
import { findColumns } from './columns'
import { findProjectSettings } from './projects'
import { syncChecklistToGanttProgress } from './bridge'

// Hangar result settlement helpers shared by recordSessionResult and the
// stall reconciler: lifecycle column routing and the plan-then-approve write.
// Kept out of sessions.ts so that module never imports the autopilot layer.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Hangar lifecycle columns a finished mission lands in. Failures stay put so a
// human triages them where they were launched.
const RESULT_COLUMN_NAMES: Record<HangarResultEnvelope['status'], string | null> = {
  completed: 'Landing',
  needs_input: 'Tower',
  failed: null,
}

export async function resolveResultColumn(
  projectId: string,
  status: HangarResultEnvelope['status'],
): Promise<string | null> {
  const target = RESULT_COLUMN_NAMES[status]
  if (!target) return null

  const settings = await findProjectSettings(projectId)
  const hangar = settings?.hangar
  const enabled = hangar !== null && typeof hangar === 'object'
    && !Array.isArray(hangar) && 'enabled' in hangar && hangar.enabled === true
  if (settings?.boardMode !== 'hangar' && !enabled) return null

  const columns = await findColumns(projectId)
  const match = columns.find((c) => c.name.trim().toLowerCase() === target.toLowerCase())
  return match?.id ?? null
}

const MAX_PLAN_STEPS = 30
const MAX_STEP_CHARS = 1000
const LIST_LINE_RE = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/

/** Plan steps from a plan-phase result: recommended tasks first, then list lines in the summary. */
export function extractPlanSteps(envelope: Pick<HangarResultEnvelope, 'summary' | 'recommended_tasks'>): string[] {
  const fromTasks = (envelope.recommended_tasks ?? [])
    .map((task) => (task.instruction ? `${task.title}: ${task.instruction}` : task.title).trim())
    .filter((step) => step.length > 0)
  const fromSummary = envelope.summary
    .split('\n')
    .map((line) => LIST_LINE_RE.exec(line)?.[1]?.trim() ?? '')
    .filter((step) => step.length > 0)
  const steps = fromTasks.length > 0 ? fromTasks : fromSummary.length > 0 ? fromSummary : [envelope.summary.trim()]
  return steps.filter(Boolean).slice(0, MAX_PLAN_STEPS).map((step) => step.slice(0, MAX_STEP_CHARS))
}

export interface PlanSettlement {
  steps: string[]
  columnId: string | null
}

/** A completed plan-phase result's checklist + Tower column, or null when this result is not a plan. */
export async function preparePlanSettlement(
  session: Pick<AgentSession, 'metadata'>,
  projectId: string,
  envelope: HangarResultEnvelope,
): Promise<PlanSettlement | null> {
  const phase = (session.metadata as { hangar?: { phase?: unknown } } | null)?.hangar?.phase
  if (phase !== 'plan' || envelope.status !== 'completed') return null
  return { steps: extractPlanSteps(envelope), columnId: await resolveResultColumn(projectId, 'needs_input') }
}

/**
 * Replace the card's "Plan" checklist group, mark the plan as awaiting
 * approval and send the card to Tower. Runs on the caller's transaction so the
 * plan commits with the session flip — a half-settled plan never strands the
 * card in 'planning', and a replayed result (guarded flip) never reaches here.
 */
export async function applyPlanResult(tx: Tx, sessionId: string, taskId: string, plan: PlanSettlement, now = new Date()) {
  const planGate = { status: 'awaiting_approval', sessionId, at: now.toISOString() }
  await tx
    .delete(checklistItems)
    .where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.groupName, HANGAR_PLAN_GROUP)))
  const [max] = await tx
    .select({ max: sql<number>`coalesce(max(${checklistItems.orderIndex}), -1)` })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))
  const base = Number(max?.max ?? -1) + 1
  if (plan.steps.length > 0) {
    await tx.insert(checklistItems).values(plan.steps.map((title, index) => ({
      taskId,
      title,
      completed: false,
      state: 'unchecked',
      groupName: HANGAR_PLAN_GROUP,
      orderIndex: base + index,
    })))
  }
  await tx
    .update(boardTasks)
    .set({
      metadata: sql`jsonb_set(coalesce(${boardTasks.metadata}, '{}'::jsonb), '{hangar,planGate}', ${JSON.stringify(planGate)}::jsonb, true)`,
      ...(plan.columnId ? { columnId: plan.columnId } : {}),
      updatedAt: now,
    })
    .where(eq(boardTasks.id, taskId))
  return { taskId, steps: plan.steps, columnId: plan.columnId }
}

/** Post-commit, best-effort: a new Plan checklist changes the linked Gantt bar's progress. */
export function syncPlanProgress(taskId: string) {
  syncChecklistToGanttProgress(taskId).catch(() => {})
}
