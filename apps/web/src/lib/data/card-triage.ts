import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { boardTasks, projects, taskLabels } from '@/lib/db/schema'
import { CARD_TRIAGE_SETTING, type CardTriage } from '@/lib/kairos/triage/types'
import { touchProject } from './projects'

// Card sorting ("Vorath sorts new cards"): the per-board switch in
// projects.settings.kairosTriage and the suggestions in board_tasks.metadata.triage.
// Pure queries — guards live in lib/actions/card-triage.ts.

const triageOnSql = sql`(${projects.settings} ->> ${CARD_TRIAGE_SETTING}) = 'on'`
const noTriageSql = sql`(${boardTasks.metadata} -> 'triage') is null`

/**
 * Switch card sorting on or off for a board its owner created. The update is
 * scoped to projects.user_id = ownerUserId, so a shared board can never be
 * switched by a member, even a realm owner. Other settings keys survive.
 */
export async function setProjectCardTriage(projectId: string, ownerUserId: string, on: boolean) {
  const settings = on
    ? sql`coalesce(${projects.settings}, '{}'::jsonb) || ${JSON.stringify({ [CARD_TRIAGE_SETTING]: 'on' })}::jsonb`
    : sql`coalesce(${projects.settings}, '{}'::jsonb) - ${CARD_TRIAGE_SETTING}`
  const [project] = await db
    .update(projects)
    .set({ settings, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, ownerUserId)))
    .returning({ id: projects.id, settings: projects.settings })
  return project ?? null
}

/** Owner, name and settings of one board, for the switch and the job's apply. */
export async function findCardTriageBoard(projectId: string) {
  const [project] = await db
    .select({ id: projects.id, userId: projects.userId, name: projects.name, settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project ?? null
}

/** Boards this user created with card sorting switched on. */
export async function listTriageBoards(userId: string, limit = 20) {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.userId, userId), triageOnSql))
    .orderBy(desc(projects.updatedAt))
    .limit(limit)
}

/** Open, unarchived cards created since `since` that have no triage yet, oldest first. */
export async function listUntriagedCards(projectId: string, since: Date, limit = 50) {
  return db
    .select({
      id: boardTasks.id,
      name: boardTasks.name,
      description: boardTasks.description,
      priority: boardTasks.priority,
      createdAt: boardTasks.createdAt,
    })
    .from(boardTasks)
    .where(and(
      eq(boardTasks.projectId, projectId),
      isNull(boardTasks.archivedAt),
      ne(boardTasks.status, 'done'),
      gte(boardTasks.createdAt, since),
      noTriageSql,
    ))
    .orderBy(asc(boardTasks.createdAt))
    .limit(limit)
}

/** Duplicate pool: open cards plus cards finished since `doneSince`, newest activity first. */
export async function listTriagePool(projectId: string, doneSince: Date, limit = 300) {
  return db
    .select({
      id: boardTasks.id,
      name: boardTasks.name,
      description: boardTasks.description,
      status: boardTasks.status,
      completedAt: boardTasks.completedAt,
    })
    .from(boardTasks)
    .where(and(
      eq(boardTasks.projectId, projectId),
      isNull(boardTasks.archivedAt),
      or(ne(boardTasks.status, 'done'), gte(boardTasks.completedAt, doneSince)),
    ))
    .orderBy(desc(boardTasks.updatedAt))
    .limit(limit)
}

/** Label ids per card for the given cards. */
export async function findLabelIdsForTasks(taskIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (taskIds.length === 0) return out
  const rows = await db
    .select({ taskId: taskLabels.taskId, labelId: taskLabels.labelId })
    .from(taskLabels)
    .where(inArray(taskLabels.taskId, taskIds))
  for (const r of rows) out.set(r.taskId, [...(out.get(r.taskId) ?? []), r.labelId])
  return out
}

/**
 * Write each card's triage from one job. A card that already holds another
 * job's triage is left alone; a repeat of the same job overwrites. Bumps the
 * board once so open clients pick the suggestions up. Returns cards written.
 */
export async function writeCardTriages(
  projectId: string,
  jobId: string,
  entries: Array<{ taskId: string; triage: CardTriage }>,
): Promise<number> {
  let written = 0
  for (const { taskId, triage } of entries) {
    const rows = await db
      .update(boardTasks)
      .set({ metadata: sql`jsonb_set(coalesce(${boardTasks.metadata}, '{}'::jsonb), '{triage}', ${JSON.stringify(triage)}::jsonb)` })
      .where(and(
        eq(boardTasks.id, taskId),
        eq(boardTasks.projectId, projectId),
        or(noTriageSql, sql`(${boardTasks.metadata} -> 'triage' ->> 'jobId') = ${jobId}`),
      ))
      .returning({ id: boardTasks.id })
    written += rows.length
  }
  if (written > 0) await touchProject(projectId, { type: 'task:updated' })
  return written
}

/** The card's id, priority and metadata, scoped to the board. */
export async function findTriageCard(taskId: string, projectId: string) {
  const [task] = await db
    .select({ id: boardTasks.id, priority: boardTasks.priority, metadata: boardTasks.metadata })
    .from(boardTasks)
    .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
    .limit(1)
  return task ?? null
}

/**
 * Replace a card's triage only if it is still exactly the stored value the
 * caller read — a concurrent decision makes this return false.
 */
export async function replaceCardTriage(taskId: string, projectId: string, expectedRaw: unknown, next: CardTriage) {
  const rows = await db
    .update(boardTasks)
    .set({ metadata: sql`jsonb_set(coalesce(${boardTasks.metadata}, '{}'::jsonb), '{triage}', ${JSON.stringify(next)}::jsonb)` })
    .where(and(
      eq(boardTasks.id, taskId),
      eq(boardTasks.projectId, projectId),
      sql`(${boardTasks.metadata} -> 'triage') = ${JSON.stringify(expectedRaw)}::jsonb`,
    ))
    .returning({ id: boardTasks.id })
  if (rows.length > 0) await touchProject(projectId, { type: 'task:updated' })
  return rows.length > 0
}
