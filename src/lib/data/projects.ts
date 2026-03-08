import { db } from '@/lib/db'
import { projects, rows, boardColumns, boardTasks, ganttTasks } from '@/lib/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import type { CreateProjectInput, UpdateProjectInput } from './validators'

export async function findProjectById(projectId: string, userId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))

  return project || null
}

export const verifyProjectOwnership = findProjectById

export async function findProjects(userId: string, limit = 100, offset = 0) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset(offset)
}

export async function createProject(userId: string, data: CreateProjectInput) {
  const [project] = await db.transaction(async (tx) => {
    const result = await tx
      .insert(projects)
      .values({
        userId,
        name: data.name,
        description: data.description || null,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        timeScale: data.timeScale,
      })
      .returning()

    await tx.insert(rows).values([
      { projectId: result[0].id, name: 'Planning', color: 'purple', orderIndex: 0 },
      { projectId: result[0].id, name: 'Development', color: 'cyan', orderIndex: 1 },
      { projectId: result[0].id, name: 'Testing', color: 'green', orderIndex: 2 },
    ])

    await tx.insert(boardColumns).values([
      { projectId: result[0].id, name: 'Todo', color: 'pink', icon: 'list-todo', orderIndex: 0 },
      { projectId: result[0].id, name: 'Doing', color: 'blue', icon: 'activity', orderIndex: 1 },
      { projectId: result[0].id, name: 'Review', color: 'purple', icon: 'eye', orderIndex: 2 },
      { projectId: result[0].id, name: 'Done', color: 'green', icon: 'check-circle', orderIndex: 3 },
    ])

    return result
  })

  return project
}

export async function updateProject(projectId: string, data: UpdateProjectInput) {
  const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description ?? null
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.timeScale !== undefined) updates.timeScale = data.timeScale

  const [project] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, projectId))
    .returning()

  return project || null
}

export async function deleteProject(projectId: string) {
  const [deleted] = await db
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id })

  return !!deleted
}

export async function getProjectSummary(projectId: string, userId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))

  if (!project) return null

  const statusCounts = await db
    .select({
      status: boardTasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(boardTasks)
    .where(eq(boardTasks.projectId, projectId))
    .groupBy(boardTasks.status)

  const counts: Record<string, number> = { todo: 0, 'in-progress': 0, done: 0 }
  let total = 0
  for (const row of statusCounts) {
    counts[row.status] = row.count
    total += row.count
  }

  const now = new Date()
  const overdue = await db
    .select({ id: boardTasks.id, name: boardTasks.name, endDate: boardTasks.endDate })
    .from(boardTasks)
    .where(
      and(
        eq(boardTasks.projectId, projectId),
        sql`${boardTasks.endDate} < ${now}`,
        sql`${boardTasks.status} != 'done'`
      )
    )

  const progressPct = total > 0 ? Math.round((counts['done'] / total) * 100) : 0

  const [ganttAgg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      avgProgress: sql<number>`coalesce(avg(${ganttTasks.progress})::int, 0)`,
    })
    .from(ganttTasks)
    .where(eq(ganttTasks.projectId, projectId))

  return {
    project: { id: project.id, name: project.name },
    boardTasks: { total, statusCounts: counts, progressPct, overdue },
    ganttTasks: { total: ganttAgg.total, avgProgress: ganttAgg.avgProgress },
  }
}
