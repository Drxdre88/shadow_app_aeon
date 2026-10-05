import { db } from '@/lib/db'
import { agentSessions, boardColumns, boardTasks, checklistItems, type AgentSession } from '@/lib/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { HANGAR_PLAN_GROUP, type HangarResultEnvelope } from './validators'
import { resolveResultColumn } from './sessions'
import { touchProject } from './projects'
import { syncChecklistToGanttProgress } from './bridge'

// Hangar autopilot persistence: plan-then-approve checklist, card-scoped
// session lookups for relaunches, and follow-up mission cards.

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

/** A session that belongs to this card, for relaunches that reuse its phase and context. */
export async function findCardSession(sessionId: string, taskId: string): Promise<AgentSession | null> {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.taskId, taskId)))
    .limit(1)
  return row ?? null
}

/** Shallow-merge keys into metadata.hangar inside the UPDATE (no read-modify-write). */
export async function patchCardHangar(taskId: string, projectId: string, patch: Record<string, unknown>) {
  const [task] = await db
    .update(boardTasks)
    .set({
      metadata: sql`jsonb_set(coalesce(${boardTasks.metadata}, '{}'::jsonb), '{hangar}', coalesce(${boardTasks.metadata} -> 'hangar', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
    .returning()
  if (task) await touchProject(projectId, { type: 'task:updated' })
  return task ?? null
}

export async function findPlanSteps(taskId: string): Promise<string[]> {
  const rows = await db
    .select({ title: checklistItems.title })
    .from(checklistItems)
    .where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.groupName, HANGAR_PLAN_GROUP)))
    .orderBy(asc(checklistItems.orderIndex))
  return rows.map((row) => row.title)
}

/**
 * A completed plan-phase result: replace the card's "Plan" checklist group,
 * mark the plan as awaiting approval and send the card to Tower — one
 * transaction, so a half-written plan never sits on a card asking for approval.
 */
export async function applyPlanResult(sessionId: string, taskId: string, envelope: HangarResultEnvelope) {
  const [card] = await db
    .select({ id: boardTasks.id, projectId: boardTasks.projectId })
    .from(boardTasks)
    .where(eq(boardTasks.id, taskId))
    .limit(1)
  if (!card) return null

  const steps = extractPlanSteps(envelope)
  const columnId = await resolveResultColumn(card.projectId, 'needs_input')
  const now = new Date()
  const planGate = { status: 'awaiting_approval', sessionId, at: now.toISOString() }

  await db.transaction(async (tx) => {
    await tx
      .delete(checklistItems)
      .where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.groupName, HANGAR_PLAN_GROUP)))
    const [max] = await tx
      .select({ max: sql<number>`coalesce(max(${checklistItems.orderIndex}), -1)` })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId))
    const base = Number(max?.max ?? -1) + 1
    if (steps.length > 0) {
      await tx.insert(checklistItems).values(steps.map((title, index) => ({
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
        ...(columnId ? { columnId } : {}),
        updatedAt: now,
      })
      .where(eq(boardTasks.id, taskId))
  })

  await touchProject(card.projectId, { type: 'task:updated' })
  syncChecklistToGanttProgress(taskId).catch(() => {})
  return { taskId, steps, columnId }
}

const FOLLOW_UP_COLUMN_NAMES = ['hangar', 'backlog', 'queued', 'queue', 'cryo', 'to do', 'todo']

/** The Hangar's intake column: a backlog-style column by name, else the leftmost column. */
export async function findFollowUpColumnId(projectId: string): Promise<string | null> {
  const columns = await db
    .select({ id: boardColumns.id, name: boardColumns.name, orderIndex: boardColumns.orderIndex })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.orderIndex))
  for (const name of FOLLOW_UP_COLUMN_NAMES) {
    const match = columns.find((column) => column.name.trim().toLowerCase() === name)
    if (match) return match.id
  }
  return columns[0]?.id ?? null
}

export interface FollowUpCardInput {
  title: string
  objective: string
  instruction: string
}

export interface FollowUpParent {
  id: string
  projectId: string
  name: string
  hangar: { repo?: unknown; agent?: unknown; model?: unknown }
}

/** Create follow-up mission cards linked to their parent and record their titles on it, atomically. */
export async function createFollowUpMissionCards(parent: FollowUpParent, picks: FollowUpCardInput[], columnId: string | null) {
  if (picks.length === 0) return []
  const now = new Date()
  const created = await db.transaction(async (tx) => {
    const [max] = await tx
      .select({ max: sql<number>`coalesce(max(${boardTasks.orderIndex}), -1)` })
      .from(boardTasks)
      .where(columnId
        ? and(eq(boardTasks.projectId, parent.projectId), eq(boardTasks.columnId, columnId))
        : eq(boardTasks.projectId, parent.projectId))
    const base = Number(max?.max ?? -1) + 1
    const rows = await tx.insert(boardTasks).values(picks.map((pick, index) => ({
      projectId: parent.projectId,
      columnId,
      name: pick.title.slice(0, 255),
      description: `Follow-up from the mission "${parent.name}".`,
      orderIndex: base + index,
      metadata: {
        hangar: {
          objective: pick.objective,
          repo: typeof parent.hangar.repo === 'string' ? parent.hangar.repo : '',
          agent: typeof parent.hangar.agent === 'string' ? parent.hangar.agent : 'copilot',
          model: typeof parent.hangar.model === 'string' ? parent.hangar.model : null,
          instruction: pick.instruction,
          outputMode: 'auto',
          autoRun: false,
          sessionIds: [],
          parentTaskId: parent.id,
        },
      },
    }))).returning()
    const titles = picks.map((pick) => pick.title)
    await tx
      .update(boardTasks)
      .set({
        metadata: sql`jsonb_set(coalesce(${boardTasks.metadata}, '{}'::jsonb), '{hangar,followUpTitles}', coalesce(${boardTasks.metadata} -> 'hangar' -> 'followUpTitles', '[]'::jsonb) || ${JSON.stringify(titles)}::jsonb, true)`,
        updatedAt: now,
      })
      .where(eq(boardTasks.id, parent.id))
    return rows
  })
  await touchProject(parent.projectId, { type: 'task:created' })
  return created
}
