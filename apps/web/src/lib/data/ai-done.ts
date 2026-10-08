import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { boardColumns, boardTasks, checklistItems, labels, projects, taskLabels } from '@/lib/db/schema'
import { pickDoneColumn } from '@/lib/kairos/card-garden/types'
import {
  AI_DONE_COLUMN,
  AI_DONE_SETTING,
  isAiDoneOn,
  normTitle,
  type AiDoneCard,
  type AiDoneMeta,
} from '@/lib/kairos/ai-done/types'
import { emitActivity } from './activity'
import { notArchivedSql } from './board-visibility'
import { canEditProject } from './hangar-access'
import { touchProject } from './projects'

// AI DONE ("Vorath checks"): the per-board switch in projects.settings.kairosAiDone
// and the one writer that files Vorath's ticked-but-not-done cards into the
// board's AI DONE column (created just before Done when missing). Cards never
// go to Done and never get a completedAt.

const switchOnSql = sql`(${projects.settings} -> ${AI_DONE_SETTING}) = 'true'::jsonb`
const AI_DONE_COLUMN_KEY = normTitle(AI_DONE_COLUMN)

/**
 * Switch AI DONE on or off for a board its owner created. Scoped to
 * projects.user_id = ownerUserId so a member, even a realm owner, can't flip
 * it on someone else's board. Other settings keys survive.
 */
export async function setProjectAiDone(projectId: string, ownerUserId: string, on: boolean) {
  const settings = on
    ? sql`coalesce(${projects.settings}, '{}'::jsonb) || ${JSON.stringify({ [AI_DONE_SETTING]: true })}::jsonb`
    : sql`coalesce(${projects.settings}, '{}'::jsonb) - ${AI_DONE_SETTING}`
  const [project] = await db
    .update(projects)
    .set({ settings, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, ownerUserId)))
    .returning({ id: projects.id, settings: projects.settings })
  return project ?? null
}

/** Owner and settings of one board, for the switch. */
export async function findAiDoneBoard(projectId: string) {
  const [project] = await db
    .select({ id: projects.id, userId: projects.userId, settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project ?? null
}

/** Unarchived boards this user created with AI DONE switched on, most recently active first. */
export async function listAiDoneBoards(userId: string, limit = 5) {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.userId, userId), switchOnSql, notArchivedSql))
    .orderBy(desc(projects.updatedAt))
    .limit(limit)
}

/** Session memory ids already cited by any AI DONE card on the board (any column, archived too). */
export async function listAiDoneCitedSessionIds(projectId: string): Promise<Set<string>> {
  const cited = sql`${boardTasks.metadata} -> 'aiDone' -> 'sessionIds'`
  const rows = await db
    .select({ id: sql<string>`jsonb_array_elements_text(${cited})` })
    .from(boardTasks)
    .where(and(eq(boardTasks.projectId, projectId), sql`jsonb_typeof(${cited}) = 'array'`))
  return new Set(rows.map((r) => r.id))
}

/** Which of these card ids are on the board. */
export async function findTaskIdsOnBoard(projectId: string, taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set()
  const rows = await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(and(eq(boardTasks.projectId, projectId), inArray(boardTasks.id, taskIds)))
  return new Set(rows.map((r) => r.id))
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// The board's AI DONE column; created immediately before Done (later columns
// shift right) or appended when the board has no Done column.
async function ensureAiDoneColumn(tx: Tx, projectId: string): Promise<string> {
  const columns = await tx
    .select({ id: boardColumns.id, name: boardColumns.name, orderIndex: boardColumns.orderIndex })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
  const existing = columns.find((c) => normTitle(c.name) === AI_DONE_COLUMN_KEY)
  if (existing) return existing.id
  const done = pickDoneColumn(columns)
  let orderIndex = columns.reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1
  if (done) {
    orderIndex = done.orderIndex
    await tx
      .update(boardColumns)
      .set({ orderIndex: sql`${boardColumns.orderIndex} + 1` })
      .where(and(eq(boardColumns.projectId, projectId), gte(boardColumns.orderIndex, done.orderIndex)))
  }
  const [column] = await tx
    .insert(boardColumns)
    .values({ projectId, name: AI_DONE_COLUMN, color: '#8b5cf6', icon: 'eye', orderIndex })
    .returning({ id: boardColumns.id })
  if (!column) throw new Error('AI DONE column insert returned no row')
  return column.id
}

export interface AiDoneWriteInput {
  projectId: string
  userId: string
  jobId: string
  day: string
  cards: AiDoneCard[]
}

export type AiDoneWrite =
  | { status: 'written'; created: Array<{ id: string; name: string }> }
  | { status: 'switched_off' | 'denied' }

async function insertCard(tx: Tx, input: AiDoneWriteInput, card: AiDoneCard, columnId: string, orderIndex: number, validLabels: Set<string>) {
  const aiDone: AiDoneMeta = { v: 1, jobId: input.jobId, day: input.day, repo: card.repo, sessionIds: card.sessionIds }
  const [task] = await tx
    .insert(boardTasks)
    .values({
      projectId: input.projectId,
      columnId,
      name: card.title,
      description: card.description || null,
      status: 'todo',
      priority: 'medium',
      orderIndex,
      completedAt: null,
      metadata: { aiDone },
    })
    .returning({ id: boardTasks.id, name: boardTasks.name })
  if (!task) throw new Error('AI DONE card insert returned no row')
  const labelIds = card.labelIds.filter((id) => validLabels.has(id))
  if (labelIds.length > 0) {
    await tx.insert(taskLabels).values(labelIds.map((labelId) => ({ taskId: task.id, labelId }))).onConflictDoNothing()
  }
  const items = card.groups.flatMap((g) => g.items.map((title) => ({ title, groupName: g.name })))
  if (items.length > 0) {
    await tx.insert(checklistItems).values(items.map((item, i) => ({
      taskId: task.id,
      title: item.title,
      groupName: item.groupName,
      state: 'checked',
      completed: true,
      orderIndex: i,
    })))
  }
  return task
}

/**
 * File one job's cards on one board, in one transaction: the switch is
 * re-read, the owner must still edit the board, and a card this job already
 * filed under the same title is skipped. Then the board is bumped and each
 * card is logged as an agent creation.
 */
export async function writeAiDoneCards(input: AiDoneWriteInput): Promise<AiDoneWrite> {
  const { projectId, userId, jobId } = input
  const result = await db.transaction(async (tx): Promise<AiDoneWrite> => {
    const [board] = await tx.select({ settings: projects.settings }).from(projects).where(eq(projects.id, projectId)).limit(1)
    if (!board || !isAiDoneOn(board.settings)) return { status: 'switched_off' }
    if (!(await canEditProject(projectId, userId))) return { status: 'denied' }

    const filed = await tx
      .select({ name: boardTasks.name })
      .from(boardTasks)
      .where(and(eq(boardTasks.projectId, projectId), sql`${boardTasks.metadata} -> 'aiDone' ->> 'jobId' = ${jobId}`))
    const taken = new Set(filed.map((r) => normTitle(r.name)))
    const fresh = input.cards.filter((c) => {
      const key = normTitle(c.title)
      if (taken.has(key)) return false
      taken.add(key)
      return true
    })
    if (fresh.length === 0) return { status: 'written', created: [] }

    const columnId = await ensureAiDoneColumn(tx, projectId)
    const boardLabels = await tx.select({ id: labels.id }).from(labels).where(eq(labels.projectId, projectId))
    const validLabels = new Set(boardLabels.map((l) => l.id))
    const [top] = await tx
      .select({ max: sql<number>`coalesce(max(${boardTasks.orderIndex}), -1)` })
      .from(boardTasks)
      .where(and(eq(boardTasks.projectId, projectId), eq(boardTasks.columnId, columnId)))
    let orderIndex = Number(top?.max ?? -1) + 1
    const created: Array<{ id: string; name: string }> = []
    for (const card of fresh) created.push(await insertCard(tx, input, card, columnId, orderIndex++, validLabels))
    return { status: 'written', created }
  })

  if (result.status === 'written' && result.created.length > 0) {
    await touchProject(projectId, { type: 'task:created' })
    for (const card of result.created) {
      await emitActivity(projectId, 'task', card.id, 'created', card.name, { via: 'thinking:ai_done', jobId }, userId, 'agent')
        .catch((err) => console.warn('[kairos:ai-done] activity log failed:', err instanceof Error ? err.message : String(err)))
    }
  }
  return result
}
