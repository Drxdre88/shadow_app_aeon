import { eq, and, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { workspaceGroups, groupMembers, projectGroups, projects, users } from '@/lib/db/schema'

export async function createWorkspaceGroup(ownerId: string, data: { name: string; icon?: string; color?: string }) {
  const [group] = await db.insert(workspaceGroups).values({
    name: data.name,
    ownerId,
    icon: data.icon ?? null,
    color: data.color ?? 'purple',
  }).returning()

  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: ownerId,
    role: 'owner',
  })

  return group
}

export async function findGroupsForUser(userId: string) {
  const memberships = await db
    .select({
      group: workspaceGroups,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(workspaceGroups, eq(workspaceGroups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(workspaceGroups.name)

  return memberships.map((m) => ({ ...m.group, memberRole: m.role }))
}

export async function findGroupMembers(groupId: string) {
  return db
    .select({
      userId: groupMembers.userId,
      role: groupMembers.role,
      name: users.name,
      email: users.email,
      image: users.image,
      createdAt: groupMembers.createdAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
}

export async function findProjectsInGroup(groupId: string) {
  return db
    .select({
      projectId: projectGroups.projectId,
      name: projects.name,
      planetImage: projects.planetImage,
      ownerId: projects.userId,
      addedBy: projectGroups.addedBy,
    })
    .from(projectGroups)
    .innerJoin(projects, eq(projects.id, projectGroups.projectId))
    .where(eq(projectGroups.groupId, groupId))
}

export async function addProjectToGroup(projectId: string, groupId: string, addedBy: string) {
  await db.insert(projectGroups).values({ projectId, groupId, addedBy }).onConflictDoNothing()
}

export async function removeProjectFromGroup(projectId: string, groupId: string) {
  await db.delete(projectGroups).where(
    and(eq(projectGroups.projectId, projectId), eq(projectGroups.groupId, groupId))
  )
}

export async function addGroupMember(groupId: string, userId: string, role: string = 'editor') {
  await db.insert(groupMembers).values({ groupId, userId, role }).onConflictDoNothing()
}

export async function removeGroupMember(groupId: string, userId: string) {
  await db.delete(groupMembers).where(
    and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
  )
}

export async function updateGroupMemberRole(groupId: string, userId: string, role: string) {
  await db.update(groupMembers)
    .set({ role })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
}

export async function updateWorkspaceGroup(groupId: string, data: { name?: string; icon?: string | null; color?: string }) {
  const values: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) values.name = data.name
  if (data.icon !== undefined) values.icon = data.icon
  if (data.color !== undefined) values.color = data.color

  const [updated] = await db.update(workspaceGroups)
    .set(values)
    .where(eq(workspaceGroups.id, groupId))
    .returning()
  return updated
}

export async function isPersonalWorkspace(groupId: string): Promise<boolean> {
  const [ws] = await db
    .select({ isPersonal: workspaceGroups.isPersonal })
    .from(workspaceGroups)
    .where(eq(workspaceGroups.id, groupId))
  return ws?.isPersonal ?? false
}

export async function deleteWorkspaceGroup(groupId: string) {
  return db.transaction(async (tx) => {
    const [ws] = await tx
      .select({ isPersonal: workspaceGroups.isPersonal })
      .from(workspaceGroups)
      .where(eq(workspaceGroups.id, groupId))
    if (!ws) throw new Error('Workspace not found')
    if (ws.isPersonal) throw new Error('Cannot delete personal workspace')
    await tx.delete(workspaceGroups).where(eq(workspaceGroups.id, groupId))
  })
}

export async function getGroupRole(groupId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  return row?.role ?? null
}

export async function canAccessProject(userId: string, projectId: string): Promise<boolean> {
  const [project] = await db
    .select({ userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId))

  if (!project) return false
  if (project.userId === userId) return true

  const groups = await db
    .select({ groupId: projectGroups.groupId })
    .from(projectGroups)
    .where(eq(projectGroups.projectId, projectId))

  if (groups.length > 0) {
    const groupIds = groups.map((g) => g.groupId)
    const [membership] = await db
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(and(
        inArray(groupMembers.groupId, groupIds),
        eq(groupMembers.userId, userId)
      ))
    if (membership) return true
  }

  return false
}

export async function findOrCreatePersonalWorkspace(userId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: workspaceGroups.id })
      .from(workspaceGroups)
      .where(and(eq(workspaceGroups.ownerId, userId), eq(workspaceGroups.isPersonal, true)))

    if (existing) return existing.id

    const [ws] = await tx.insert(workspaceGroups).values({
      name: 'Personal',
      ownerId: userId,
      isPersonal: true,
      color: 'blue',
    }).onConflictDoNothing().returning({ id: workspaceGroups.id })

    if (!ws) {
      const [fallback] = await tx
        .select({ id: workspaceGroups.id })
        .from(workspaceGroups)
        .where(and(eq(workspaceGroups.ownerId, userId), eq(workspaceGroups.isPersonal, true)))
      if (!fallback) throw new Error('Personal workspace race: row not found after conflict')
      await tx.insert(groupMembers).values({
        groupId: fallback.id,
        userId,
        role: 'owner',
      }).onConflictDoNothing()
      return fallback.id
    }

    await tx.insert(groupMembers).values({
      groupId: ws.id,
      userId,
      role: 'owner',
    }).onConflictDoNothing()

    return ws.id
  })
}

export async function ensureOrphanProjectsInPersonalWorkspace(userId: string): Promise<number> {
  const personalGroupId = await findOrCreatePersonalWorkspace(userId)

  return db.transaction(async (tx) => {
    const orphanProjects = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(
        eq(projects.userId, userId),
        sql`NOT EXISTS (
          SELECT 1 FROM project_groups pg WHERE pg.project_id = ${projects.id}
        )`
      ))

    if (orphanProjects.length === 0) return 0

    await tx.insert(projectGroups).values(
      orphanProjects.map((p) => ({
        projectId: p.id,
        groupId: personalGroupId,
        addedBy: userId,
      }))
    ).onConflictDoNothing()

    return orphanProjects.length
  })
}

export async function consolidateSoloWorkspaces(userId: string): Promise<number> {
  const personalGroupId = await findOrCreatePersonalWorkspace(userId)

  const [personalWs] = await db
    .select({ settings: workspaceGroups.settings })
    .from(workspaceGroups)
    .where(eq(workspaceGroups.id, personalGroupId))

  if ((personalWs?.settings as Record<string, unknown>)?.consolidated) return 0

  const soloWorkspaces = await db
    .select({
      id: workspaceGroups.id,
      name: workspaceGroups.name,
      memberCount: sql<number>`(select count(*)::int from group_members gm2 where gm2.group_id = ${workspaceGroups.id})`,
    })
    .from(workspaceGroups)
    .where(and(
      eq(workspaceGroups.ownerId, userId),
      eq(workspaceGroups.isPersonal, false)
    ))

  const soloIds = soloWorkspaces.filter((ws) => ws.memberCount <= 1)
  if (soloIds.length === 0) return 0

  let moved = 0

  for (const ws of soloIds) {
    await db.transaction(async (tx) => {
      const [recheck] = await tx
        .select({ memberCount: sql<number>`(select count(*)::int from group_members gm2 where gm2.group_id = ${workspaceGroups.id})` })
        .from(workspaceGroups)
        .where(eq(workspaceGroups.id, ws.id))
      if (!recheck || recheck.memberCount > 1) return

      const wsProjects = await tx
        .select({ projectId: projectGroups.projectId })
        .from(projectGroups)
        .where(eq(projectGroups.groupId, ws.id))

      for (const p of wsProjects) {
        await tx.insert(projectGroups).values({
          projectId: p.projectId,
          groupId: personalGroupId,
          addedBy: userId,
        }).onConflictDoNothing()
      }

      await tx.delete(projectGroups).where(eq(projectGroups.groupId, ws.id))
      await tx.delete(groupMembers).where(eq(groupMembers.groupId, ws.id))
      await tx.delete(workspaceGroups).where(eq(workspaceGroups.id, ws.id))
      moved += wsProjects.length
    })
  }

  await db.update(workspaceGroups)
    .set({ settings: { consolidated: true } })
    .where(eq(workspaceGroups.id, personalGroupId))

  return moved
}

