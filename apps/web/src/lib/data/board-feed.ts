import { db } from '@/lib/db'
import {
  activityEvents,
  boardColumns,
  boardTasks,
  checklistItems,
  labels,
  memories,
  taskLabels,
  taskVault,
} from '@/lib/db/schema'
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { AnyColumn } from 'drizzle-orm'

// ─────────────────────────────────────────────────────────────────────────
// Kairos board feed — pure DB reads. No business logic; page assembly lives
// in lib/kairos/board-feed.ts (+ board-feed-render.ts). Every query is
// project-scoped; callers own the userId → project authorisation.
// ─────────────────────────────────────────────────────────────────────────

export type FeedTaskRow = {
  id: string
  name: string
  description: string | null
  status: string
  columnId: string | null
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
  completedAt: Date | null
  archivedAt: Date | null
}

const taskColumns = {
  id: boardTasks.id,
  name: boardTasks.name,
  description: boardTasks.description,
  status: boardTasks.status,
  columnId: boardTasks.columnId,
  createdAt: boardTasks.createdAt,
  updatedAt: boardTasks.updatedAt,
  startedAt: boardTasks.startedAt,
  completedAt: boardTasks.completedAt,
  archivedAt: boardTasks.archivedAt,
}

/** Cards created, started, or completed inside [start, end). Includes archived (not vaulted) rows. */
export async function listBoardTasksActiveBetween(projectId: string, start: Date, end: Date): Promise<FeedTaskRow[]> {
  const within = (col: AnyColumn) => and(gte(col, start), lt(col, end))
  return db
    .select(taskColumns)
    .from(boardTasks)
    .where(and(
      eq(boardTasks.projectId, projectId),
      or(within(boardTasks.createdAt), within(boardTasks.startedAt), within(boardTasks.completedAt)),
    ))
    .orderBy(desc(boardTasks.updatedAt))
    .limit(500)
}

/** Live (non-archived) cards on the board. */
export async function listLiveBoardTasks(projectId: string): Promise<FeedTaskRow[]> {
  return db
    .select(taskColumns)
    .from(boardTasks)
    .where(and(eq(boardTasks.projectId, projectId), isNull(boardTasks.archivedAt)))
    .orderBy(asc(boardTasks.orderIndex))
    .limit(1000)
}

export async function listBoardTasksByIds(projectId: string, taskIds: string[]): Promise<FeedTaskRow[]> {
  if (taskIds.length === 0) return []
  return db
    .select(taskColumns)
    .from(boardTasks)
    .where(and(eq(boardTasks.projectId, projectId), inArray(boardTasks.id, taskIds)))
}

export type FeedColumnRow = { id: string; name: string; orderIndex: number }

export async function listBoardColumnsForFeed(projectId: string): Promise<FeedColumnRow[]> {
  return db
    .select({ id: boardColumns.id, name: boardColumns.name, orderIndex: boardColumns.orderIndex })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.orderIndex))
}

export type FeedMoveRow = {
  taskId: string
  taskName: string | null
  metadata: unknown
  createdAt: Date
}

/** Task 'moved' activity events inside [start, end), newest first. */
export async function listTaskMoveEvents(projectId: string, start: Date, end: Date): Promise<FeedMoveRow[]> {
  return db
    .select({
      taskId: activityEvents.entityId,
      taskName: activityEvents.entityName,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(and(
      eq(activityEvents.projectId, projectId),
      eq(activityEvents.entityType, 'task'),
      eq(activityEvents.action, 'moved'),
      gte(activityEvents.createdAt, start),
      lt(activityEvents.createdAt, end),
    ))
    .orderBy(desc(activityEvents.createdAt))
    .limit(500)
}

export type FeedVaultRow = {
  id: string
  originalTaskId: string | null
  name: string
  description: string | null
  columnName: string | null
  daysTaken: number | null
  labelSnapshot: unknown
  checklistSnapshot: unknown
  archivedAt: Date
  completedAt: Date | null
}

/** Vault rows archived inside [start, end), newest first. */
export async function listVaultedBetween(projectId: string, start: Date, end: Date): Promise<FeedVaultRow[]> {
  return db
    .select({
      id: taskVault.id,
      originalTaskId: taskVault.originalTaskId,
      name: taskVault.name,
      description: taskVault.description,
      columnName: taskVault.columnName,
      daysTaken: taskVault.daysTaken,
      labelSnapshot: taskVault.labelSnapshot,
      checklistSnapshot: taskVault.checklistSnapshot,
      archivedAt: taskVault.archivedAt,
      completedAt: taskVault.completedAt,
    })
    .from(taskVault)
    .where(and(
      eq(taskVault.projectId, projectId),
      gte(taskVault.archivedAt, start),
      lt(taskVault.archivedAt, end),
    ))
    .orderBy(desc(taskVault.archivedAt))
    .limit(500)
}

export type FeedChecklistRow = { taskId: string; title: string; state: string; completed: boolean }

export async function listChecklistForTasks(taskIds: string[]): Promise<FeedChecklistRow[]> {
  if (taskIds.length === 0) return []
  return db
    .select({
      taskId: checklistItems.taskId,
      title: checklistItems.title,
      state: checklistItems.state,
      completed: checklistItems.completed,
    })
    .from(checklistItems)
    .where(inArray(checklistItems.taskId, taskIds))
    .orderBy(asc(checklistItems.orderIndex))
}

export async function listLabelNamesForTasks(taskIds: string[]): Promise<Array<{ taskId: string; name: string }>> {
  if (taskIds.length === 0) return []
  return db
    .select({ taskId: taskLabels.taskId, name: labels.name })
    .from(taskLabels)
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .where(inArray(taskLabels.taskId, taskIds))
}

export type BoardDayPageRow = {
  id: string
  projectId: string | null
  dominionId: string | null
  sourceMetadata: unknown
}

/** Live board_day feed pages the user owns for one UTC date. */
export async function listBoardDayPages(userId: string, date: string): Promise<BoardDayPageRow[]> {
  return db
    .select({
      id: memories.id,
      projectId: memories.projectId,
      dominionId: memories.dominionId,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'kind' = 'board_day'`,
      sql`${memories.sourceMetadata}->>'date' = ${date}`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(20)
}
