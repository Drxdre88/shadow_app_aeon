import { db } from '@/lib/db'
import { projects, projectMembers, boardTasks, ganttTasks, projectGroups, groupMembers, workspaceGroups, favoriteProjects } from '@/lib/db/schema'
import { eq, and, desc, sql, or, inArray, ne } from 'drizzle-orm'
import type { CreateProjectInput, UpdateProjectInput } from './validators'

export async function verifyProjectAccess(projectId: string, userId: string) {
  // Query 1: project + direct membership in one shot
  const [row] = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      dominionId: projects.dominionId,
      name: projects.name,
      description: projects.description,
      timeScale: projects.timeScale,
      startDate: projects.startDate,
      endDate: projects.endDate,
      settings: projects.settings,
      group: projects.group,
      planetImage: projects.planetImage,
      boardVersion: projects.boardVersion,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      directRole: projectMembers.role,
    })
    .from(projects)
    .leftJoin(projectMembers, and(
      eq(projectMembers.projectId, projects.id),
      eq(projectMembers.userId, userId)
    ))
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!row) return null

  const { directRole, ...project } = row

  // Direct member — role is known
  if (directRole) return { project, role: directRole }

  // Project owner (legacy path — no membership row)
  if (project.userId === userId) return { project, role: 'owner' }

  // Query 2: realm membership (only when not direct member/owner)
  const [realmMembership] = await db
    .select({ role: groupMembers.role })
    .from(projectGroups)
    .innerJoin(groupMembers, and(
      eq(groupMembers.groupId, projectGroups.groupId),
      eq(groupMembers.userId, userId)
    ))
    .where(eq(projectGroups.projectId, projectId))
    .limit(1)

  if (realmMembership) return { project, role: realmMembership.role }

  return null
}

export async function verifyProjectOwnership(projectId: string, userId: string) {
  const access = await verifyProjectAccess(projectId, userId)
  return access?.project ?? null
}

export const findProjectById = verifyProjectOwnership

export async function touchProject(projectId: string, event?: { type: string }) {
  await db.update(projects).set({
    updatedAt: new Date(),
    boardVersion: sql`${projects.boardVersion} + 1`,
  }).where(eq(projects.id, projectId))

  if (event) {
    import('@/lib/realtime').then(({ publishBoardEvent }) =>
      publishBoardEvent(projectId, event as import('@/lib/realtime').BoardEvent)
    ).catch((err) => console.error('[touchProject] Pusher publish failed:', err))
  }
}

export async function findProjectBasic(projectId: string) {
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
  return project || null
}

export async function findProjectSettings(projectId: string) {
  const [project] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId))
  return (project?.settings as Record<string, unknown>) ?? null
}

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
  const access = await verifyProjectAccess(projectId, userId)
  return access?.role ?? null
}

export async function findProjects(userId: string, limit = 100, offset = 0) {
  return db
    .selectDistinct({
      id: projects.id,
      userId: projects.userId,
      dominionId: projects.dominionId,
      name: projects.name,
      description: projects.description,
      timeScale: projects.timeScale,
      startDate: projects.startDate,
      endDate: projects.endDate,
      settings: projects.settings,
      group: projects.group,
      planetImage: projects.planetImage,
      boardVersion: projects.boardVersion,
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

export async function findProjectsWithRealmName(userId: string, limit = 500) {
  const allProjects = await findProjects(userId, limit)
  const projectIds = allProjects.map((p) => p.id)
  if (projectIds.length === 0) return []

  const realmInfo = await db
    .select({
      projectId: projectGroups.projectId,
      realmName: workspaceGroups.name,
      isPersonal: workspaceGroups.isPersonal,
    })
    .from(projectGroups)
    .innerJoin(workspaceGroups, eq(workspaceGroups.id, projectGroups.groupId))
    .where(inArray(projectGroups.projectId, projectIds))

  const realmByProject = new Map<string, string>()
  for (const r of realmInfo) {
    if (!realmByProject.has(r.projectId) || !r.isPersonal)
      realmByProject.set(r.projectId, r.isPersonal ? 'Personal' : r.realmName)
  }

  return allProjects.map((p) => ({
    ...p,
    realmName: realmByProject.get(p.id) ?? null,
  }))
}

export async function findSiblingProjects(projectId: string, userId: string) {
  const realmRows = await db
    .select({
      groupId: projectGroups.groupId,
      name: workspaceGroups.name,
      isPersonal: workspaceGroups.isPersonal,
    })
    .from(projectGroups)
    .innerJoin(workspaceGroups, eq(workspaceGroups.id, projectGroups.groupId))
    .where(eq(projectGroups.projectId, projectId))

  if (realmRows.length === 0) return { realmName: null, projects: [] }

  // Prefer team realm over personal
  const realm = realmRows.find((r) => !r.isPersonal) ?? realmRows[0]
  if (realm.isPersonal) return { realmName: null, projects: [] }

  const siblingRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      planetImage: projects.planetImage,
    })
    .from(projectGroups)
    .innerJoin(projects, eq(projects.id, projectGroups.projectId))
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projectGroups.groupId, realm.groupId),
        ne(projectGroups.projectId, projectId),
        or(eq(projects.userId, userId), eq(projectMembers.userId, userId))
      )
    )
    .orderBy(desc(projects.updatedAt))

  const seen = new Set<string>()
  const unique = siblingRows.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })

  return {
    realmName: realm.name,
    projects: unique,
  }
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
      dominionId: projects.dominionId,
      group: projects.group,
      planetImage: projects.planetImage,
      boardVersion: projects.boardVersion,
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

export async function toggleProjectFavorite(userId: string, projectId: string, favorite: boolean) {
  if (favorite) {
    await db.insert(favoriteProjects).values({ userId, projectId }).onConflictDoNothing()
  } else {
    await db.delete(favoriteProjects).where(
      and(eq(favoriteProjects.userId, userId), eq(favoriteProjects.projectId, projectId))
    )
  }
}

export async function findFavoriteProjects(userId: string) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      favoritedAt: favoriteProjects.createdAt,
    })
    .from(favoriteProjects)
    .innerJoin(projects, eq(favoriteProjects.projectId, projects.id))
    .where(eq(favoriteProjects.userId, userId))
    .orderBy(favoriteProjects.createdAt)
}

export async function findFavoriteProjectIds(userId: string) {
  const rows = await db
    .select({ projectId: favoriteProjects.projectId })
    .from(favoriteProjects)
    .where(eq(favoriteProjects.userId, userId))
  return new Set(rows.map((r) => r.projectId))
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

/**
 * Shallow-merge a patch into projects.settings IN SQL.
 *
 * Read-modify-write in JS loses concurrent writes: two savers both read the
 * old blob and the second one's assign reverts the first (board theme vs
 * sizing vs Auto AI config all live in this one column). `||` merges against
 * the row as it exists at write time, so unrelated keys always survive.
 */
export async function mergeProjectSettings(projectId: string, patch: Record<string, unknown>) {
  const [project] = await db
    .update(projects)
    .set({
      settings: sql`coalesce(${projects.settings}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning()
  return project || null
}

export async function updateProject(projectId: string, userId: string, data: UpdateProjectInput) {
  const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description ?? null
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.timeScale !== undefined) updates.timeScale = data.timeScale
  if (data.planetImage !== undefined) updates.planetImage = data.planetImage
  if (data.settings !== undefined) updates.settings = data.settings
  if (data.dominionId !== undefined) updates.dominionId = data.dominionId

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

  const now = new Date()
  const [statusCounts, overdue, [ganttAgg]] = await Promise.all([
    db.select({ status: boardTasks.status, count: sql<number>`count(*)::int` })
      .from(boardTasks).where(eq(boardTasks.projectId, projectId)).groupBy(boardTasks.status),
    db.select({ id: boardTasks.id, name: boardTasks.name, endDate: boardTasks.endDate })
      .from(boardTasks).where(and(
        eq(boardTasks.projectId, projectId),
        sql`${boardTasks.endDate} < ${now}`,
        sql`${boardTasks.status} != 'done'`
      )),
    db.select({
      total: sql<number>`count(*)::int`,
      avgProgress: sql<number>`coalesce(avg(${ganttTasks.progress})::int, 0)`,
    }).from(ganttTasks).where(eq(ganttTasks.projectId, projectId)),
  ])

  const counts: Record<string, number> = { todo: 0, 'in-progress': 0, done: 0 }
  let total = 0
  for (const row of statusCounts) {
    counts[row.status] = row.count
    total += row.count
  }
  const progressPct = total > 0 ? Math.round((counts['done'] / total) * 100) : 0

  return {
    project: { id: project.id, name: project.name },
    boardTasks: { total, statusCounts: counts, progressPct, overdue },
    ganttTasks: { total: ganttAgg.total, avgProgress: ganttAgg.avgProgress },
  }
}

const PROJECT_COLUMNS = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  timeScale: projects.timeScale,
  startDate: projects.startDate,
  endDate: projects.endDate,
  settings: projects.settings,
  userId: projects.userId,
  dominionId: projects.dominionId,
  group: projects.group,
  planetImage: projects.planetImage,
  boardVersion: projects.boardVersion,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
} as const

export async function findOwnProjects(userId: string) {
  return db
    .select(PROJECT_COLUMNS)
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt))
}

export async function findSharedProjects(userId: string) {
  return db
    .select(PROJECT_COLUMNS)
    .from(projects)
    .innerJoin(projectMembers, and(
      eq(projectMembers.projectId, projects.id),
      eq(projectMembers.userId, userId)
    ))
    .where(and(
      ne(projects.userId, userId),
      sql`NOT EXISTS (
        SELECT 1 FROM project_groups pg
        INNER JOIN group_members gm ON gm.group_id = pg.group_id AND gm.user_id = ${userId}
        WHERE pg.project_id = ${projects.id}
      )`
    ))
    .orderBy(desc(projects.createdAt))
}

export async function findWorkspaceProjects(userId: string) {
  const userGroups = await db
    .select({
      groupId: workspaceGroups.id,
      groupName: workspaceGroups.name,
      groupColor: workspaceGroups.color,
      groupIcon: workspaceGroups.icon,
      isPersonal: workspaceGroups.isPersonal,
      ownerId: workspaceGroups.ownerId,
      memberRole: groupMembers.role,
      memberCount: sql<number>`(select count(*)::int from group_members gm2 where gm2.group_id = ${workspaceGroups.id})`,
    })
    .from(groupMembers)
    .innerJoin(workspaceGroups, eq(workspaceGroups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(workspaceGroups.name)

  if (userGroups.length === 0) return []

  const groupIds = userGroups.map((g) => g.groupId)

  const groupProjectRows = await db
    .select({
      groupId: projectGroups.groupId,
      visibility: projectGroups.visibility,
      ...PROJECT_COLUMNS,
    })
    .from(projectGroups)
    .innerJoin(projects, eq(projects.id, projectGroups.projectId))
    .where(inArray(projectGroups.groupId, groupIds))
    .orderBy(desc(projects.createdAt))

  const roleByGroup = new Map(userGroups.map((g) => [g.groupId, g.memberRole]))

  const membersOnlyIds = groupProjectRows.filter((p) => p.visibility === 'members_only').map((p) => p.id)
  let memberOfSet = new Set<string>()
  if (membersOnlyIds.length > 0) {
    const memberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(inArray(projectMembers.projectId, membersOnlyIds), eq(projectMembers.userId, userId)))
    memberOfSet = new Set(memberRows.map((r) => r.projectId))
  }

  return userGroups.map((g) => {
    const role = roleByGroup.get(g.groupId)
    const isOwner = role === 'owner'
    return {
      ...g,
      projects: groupProjectRows
        .filter((p) => {
          if (p.groupId !== g.groupId) return false
          if (isOwner) return true
          if (p.visibility === 'all') return true
          if (p.visibility === 'members_only') return p.userId === userId || memberOfSet.has(p.id)
          return false
        }),
    }
  })
}
