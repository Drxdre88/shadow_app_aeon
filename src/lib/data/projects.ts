import { db } from '@/lib/db'
import { projects, projectMembers, boardTasks, ganttTasks } from '@/lib/db/schema'
import { eq, and, desc, sql, or } from 'drizzle-orm'
import type { CreateProjectInput, UpdateProjectInput } from './validators'

export async function verifyProjectOwnership(projectId: string, userId: string) {
  const [membership] = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))

  if (membership) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
    return project || null
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))

  return project || null
}

export const findProjectById = verifyProjectOwnership

export async function verifyProjectOwnerRole(projectId: string, userId: string) {
  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))

  if (membership?.role === 'owner') return true

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))

  return !!project
}

export async function getMemberRole(projectId: string, userId: string) {
  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))

  return membership?.role || null
}

export async function findProjects(userId: string, limit = 100, offset = 0) {
  return db
    .selectDistinct({
      id: projects.id,
      userId: projects.userId,
      name: projects.name,
      description: projects.description,
      timeScale: projects.timeScale,
      startDate: projects.startDate,
      endDate: projects.endDate,
      settings: projects.settings,
      group: projects.group,
      planetImage: projects.planetImage,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(or(eq(projects.userId, userId), eq(projectMembers.userId, userId)))
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset(offset)
}

export async function findProjectsWithStats(userId: string) {
  const projectRows = await db
    .selectDistinct({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      timeScale: projects.timeScale,
      startDate: projects.startDate,
      endDate: projects.endDate,
      settings: projects.settings,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      userId: projects.userId,
      group: projects.group,
      planetImage: projects.planetImage,
      totalTasks: sql<number>`coalesce((
        select count(*)::int from board_tasks
        where board_tasks.project_id = ${projects.id}
      ), 0)`,
      doneTasks: sql<number>`coalesce((
        select count(*)::int from board_tasks
        where board_tasks.project_id = ${projects.id}
        and board_tasks.status = 'done'
      ), 0)`,
    })
    .from(projects)
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(or(eq(projects.userId, userId), eq(projectMembers.userId, userId)))
    .orderBy(desc(projects.createdAt))

  return projectRows.map((row) => ({
    ...row,
    completionPct: row.totalTasks > 0 ? Math.round((row.doneTasks / row.totalTasks) * 100) : 0,
  }))
}

export async function setProjectGroup(projectId: string, group: string | null) {
  await db
    .update(projects)
    .set({ group: group || null })
    .where(eq(projects.id, projectId))
}

export async function renameGroup(userId: string, oldName: string, newName: string) {
  await db
    .update(projects)
    .set({ group: newName })
    .where(and(eq(projects.userId, userId), eq(projects.group, oldName)))
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

    await tx
      .insert(projectMembers)
      .values({
        projectId: result[0].id,
        userId,
        role: 'owner',
      })

    return result
  })

  return project
}

export async function updateProject(projectId: string, userId: string, data: UpdateProjectInput) {
  const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description ?? null
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.timeScale !== undefined) updates.timeScale = data.timeScale
  if (data.planetImage !== undefined) updates.planetImage = data.planetImage

  const [project] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, projectId))
    .returning()

  return project || null
}

export async function deleteProject(projectId: string, userId: string) {
  const isOwner = await verifyProjectOwnerRole(projectId, userId)
  if (!isOwner) return false

  const [deleted] = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id })

  return !!deleted
}

export async function getProjectSummary(projectId: string, userId: string) {
  const project = await verifyProjectOwnership(projectId, userId)
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
