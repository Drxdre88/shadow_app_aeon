import { db } from '@/lib/db'
import { boardColumns, boardTasks, projectMembers, projects } from '@/lib/db/schema'
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'

const DAY_MS = 24 * 60 * 60 * 1000

const taskFields = {
  taskId: boardTasks.id,
  name: boardTasks.name,
  projectId: projects.id,
  projectName: projects.name,
  columnName: boardColumns.name,
  priority: boardTasks.priority,
}

function cutoffDate(now: Date, days: number) {
  return new Date(now.getTime() - days * DAY_MS)
}

function accessibleTo(userId: string) {
  return or(eq(projects.userId, userId), eq(projectMembers.userId, userId))
}

export async function listStaleTasks({
  userId,
  days = 21,
  limit = 12,
}: {
  userId: string
  days?: number
  limit?: number
}) {
  const now = new Date()

  const rows = await db
    .selectDistinct({
      ...taskFields,
      updatedAt: boardTasks.updatedAt,
      ageDays: sql<number>`floor(extract(epoch from (${now} - ${boardTasks.updatedAt})) / 86400)::int`,
    })
    .from(boardTasks)
    .innerJoin(projects, eq(projects.id, boardTasks.projectId))
    .leftJoin(boardColumns, eq(boardColumns.id, boardTasks.columnId))
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(
      accessibleTo(userId),
      isNull(boardTasks.archivedAt),
      ne(boardTasks.status, 'done'),
      lt(boardTasks.updatedAt, cutoffDate(now, days))
    ))
    .orderBy(asc(boardTasks.updatedAt))
    .limit(limit)

  return rows.map((row) => ({
    taskId: row.taskId,
    name: row.name,
    projectId: row.projectId,
    projectName: row.projectName,
    columnName: row.columnName,
    priority: row.priority,
    ageDays: row.ageDays,
  }))
}

export async function listRecentlyCompletedTasks({
  userId,
  days = 7,
  limit = 12,
}: {
  userId: string
  days?: number
  limit?: number
}) {
  const now = new Date()

  return db
    .selectDistinct({
      ...taskFields,
      completedAt: boardTasks.completedAt,
    })
    .from(boardTasks)
    .innerJoin(projects, eq(projects.id, boardTasks.projectId))
    .leftJoin(boardColumns, eq(boardColumns.id, boardTasks.columnId))
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(
      accessibleTo(userId),
      isNull(boardTasks.archivedAt),
      isNotNull(boardTasks.completedAt),
      gte(boardTasks.completedAt, cutoffDate(now, days))
    ))
    .orderBy(desc(boardTasks.completedAt))
    .limit(limit)
}

// Pure counts for a fixed [start, end) window (used by the Evening Digest,
// which needs exact totals, not a capped preview list). COUNT(DISTINCT id)
// guards against the projectMembers leftJoin fan-out inflating the count
// for multi-member projects. createdCount deliberately does NOT exclude
// status='done' — a task created and finished the same day must still
// count as created.
export async function countTasksCompletedBetween(userId: string, start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(DISTINCT ${boardTasks.id})::int` })
    .from(boardTasks)
    .innerJoin(projects, eq(projects.id, boardTasks.projectId))
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(
      accessibleTo(userId),
      isNull(boardTasks.archivedAt),
      isNotNull(boardTasks.completedAt),
      gte(boardTasks.completedAt, start),
      lt(boardTasks.completedAt, end),
    ))
  return row?.n ?? 0
}

export async function countTasksCreatedBetween(userId: string, start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(DISTINCT ${boardTasks.id})::int` })
    .from(boardTasks)
    .innerJoin(projects, eq(projects.id, boardTasks.projectId))
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(
      accessibleTo(userId),
      isNull(boardTasks.archivedAt),
      gte(boardTasks.createdAt, start),
      lt(boardTasks.createdAt, end),
    ))
  return row?.n ?? 0
}

export async function listRecentlyCreatedTasks({
  userId,
  days = 7,
  limit = 12,
}: {
  userId: string
  days?: number
  limit?: number
}) {
  const now = new Date()

  return db
    .selectDistinct({
      ...taskFields,
      createdAt: boardTasks.createdAt,
    })
    .from(boardTasks)
    .innerJoin(projects, eq(projects.id, boardTasks.projectId))
    .leftJoin(boardColumns, eq(boardColumns.id, boardTasks.columnId))
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(
      accessibleTo(userId),
      isNull(boardTasks.archivedAt),
      ne(boardTasks.status, 'done'),
      gte(boardTasks.createdAt, cutoffDate(now, days))
    ))
    .orderBy(desc(boardTasks.createdAt))
    .limit(limit)
}
