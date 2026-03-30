import { eq, and, or, inArray } from 'drizzle-orm'
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

export async function deleteWorkspaceGroup(groupId: string) {
  await db.delete(workspaceGroups).where(eq(workspaceGroups.id, groupId))
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
