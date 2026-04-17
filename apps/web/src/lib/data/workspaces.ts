import { eq, and, inArray, isNull, gte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { workspaceGroups, groupMembers, projectGroups, projects, users, realmInvites, projectInvites, projectMembers } from '@/lib/db/schema'
import { sendRealmInviteEmail, getBaseUrl } from '@/lib/email'

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

export async function findProjectsInGroup(groupId: string, callerRole?: string, callerId?: string) {
  const rows = await db
    .select({
      projectId: projectGroups.projectId,
      name: projects.name,
      planetImage: projects.planetImage,
      ownerId: projects.userId,
      addedBy: projectGroups.addedBy,
      visibility: projectGroups.visibility,
    })
    .from(projectGroups)
    .innerJoin(projects, eq(projects.id, projectGroups.projectId))
    .where(eq(projectGroups.groupId, groupId))
  if (callerRole === 'owner') return rows

  const membersOnlyIds = rows.filter((r) => r.visibility === 'members_only').map((r) => r.projectId)
  let memberOfSet = new Set<string>()
  if (membersOnlyIds.length > 0 && callerId) {
    const memberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(inArray(projectMembers.projectId, membersOnlyIds), eq(projectMembers.userId, callerId)))
    memberOfSet = new Set(memberRows.map((r) => r.projectId))
  }

  return rows.filter((r) => {
    if (r.visibility === 'all') return true
    if (r.visibility === 'members_only') {
      return (callerId && r.ownerId === callerId) || memberOfSet.has(r.projectId)
    }
    return false
  })
}

export async function findProjectAccessList(projectId: string) {
  return db
    .select({
      userId: projectMembers.userId,
      role: projectMembers.role,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
}

export async function setProjectAccessList(projectId: string, groupId: string, userIds: string[], invitedBy: string) {
  const realmMembers = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
  const realmUserIds = new Set(realmMembers.map((r) => r.userId))

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId))
    const realmScopedIds = existing.filter((r) => realmUserIds.has(r.userId)).map((r) => r.userId)
    if (realmScopedIds.length > 0) {
      await tx.delete(projectMembers).where(
        and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, realmScopedIds))
      )
    }
    if (userIds.length > 0) {
      await tx.insert(projectMembers).values(
        userIds.map((userId) => ({ projectId, userId, role: 'editor' as const, invitedBy }))
      ).onConflictDoNothing()
    }
  })
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
  const [member] = await db.insert(groupMembers).values({ groupId, userId, role }).onConflictDoNothing().returning()
  return member || null
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

export async function ensureOrphanProjectsInPersonalWorkspace(userId: string, personalGroupId?: string): Promise<number> {
  if (!personalGroupId) personalGroupId = await findOrCreatePersonalWorkspace(userId)

  await db.update(projects)
    .set({ group: null })
    .where(and(eq(projects.userId, userId), eq(projects.group, 'null')))

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

export async function consolidateSoloWorkspaces(userId: string, personalGroupId?: string): Promise<number> {
  if (!personalGroupId) personalGroupId = await findOrCreatePersonalWorkspace(userId)

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
        .select({ memberCount: sql<number>`(select count(*)::int from group_members gm2 where gm2.group_id = ${ws.id})` })
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

const REALM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function createRealmInvite(groupId: string, email: string, role: string, invitedBy: string) {
  const lowerEmail = email.toLowerCase()
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  const expiresAt = new Date(Date.now() + REALM_INVITE_TTL_MS)

  return db.transaction(async (tx) => {
    await tx.delete(realmInvites).where(and(
      eq(realmInvites.groupId, groupId),
      eq(realmInvites.email, lowerEmail),
      isNull(realmInvites.acceptedAt),
    ))

    const [invite] = await tx
      .insert(realmInvites)
      .values({ groupId, email: lowerEmail, role, invitedBy, token, expiresAt })
      .returning()

    return invite
  })
}

export async function findRealmInviteByToken(token: string) {
  const [invite] = await db
    .select()
    .from(realmInvites)
    .where(and(eq(realmInvites.token, token), isNull(realmInvites.acceptedAt)))

  return invite || null
}

export async function acceptRealmInvite(token: string, userId: string, callerEmail: string) {
  const invite = await findRealmInviteByToken(token)
  if (!invite) return null
  if (new Date() > invite.expiresAt) return null
  if (callerEmail.toLowerCase() !== invite.email.toLowerCase()) return null

  await db.transaction(async (tx) => {
    await tx
      .insert(groupMembers)
      .values({
        groupId: invite.groupId,
        userId,
        role: invite.role,
      })
      .onConflictDoNothing()

    await tx
      .update(realmInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(realmInvites.id, invite.id))
  })

  return invite
}

export async function findPendingRealmInvites(groupId: string) {
  return db
    .select({
      id: realmInvites.id,
      email: realmInvites.email,
      role: realmInvites.role,
      expiresAt: realmInvites.expiresAt,
      createdAt: realmInvites.createdAt,
    })
    .from(realmInvites)
    .where(and(
      eq(realmInvites.groupId, groupId),
      isNull(realmInvites.acceptedAt),
      gte(realmInvites.expiresAt, new Date()),
    ))
}

export async function inviteOrAddRealmMember(groupId: string, email: string, role: string, invitedBy: string) {
  const lowerEmail = email.toLowerCase()
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, lowerEmail))

  if (user) {
    const member = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(groupMembers)
        .values({ groupId, userId: user.id, role })
        .onConflictDoNothing()
        .returning()
      await tx.delete(realmInvites).where(and(
        eq(realmInvites.groupId, groupId),
        eq(realmInvites.email, lowerEmail),
        isNull(realmInvites.acceptedAt),
      ))
      return inserted || null
    })
    return { type: 'added' as const, email: lowerEmail, member }
  }

  const invite = await createRealmInvite(groupId, lowerEmail, role, invitedBy)
  const [group] = await db.select({ name: workspaceGroups.name }).from(workspaceGroups).where(eq(workspaceGroups.id, groupId))
  const baseUrl = getBaseUrl()
  if (baseUrl) {
    sendRealmInviteEmail(lowerEmail, group?.name || 'Untitled', 'A team member', `${baseUrl}/invite/realm/${invite.token}`)
      .catch((err) => console.error('[inviteOrAddRealmMember] email dispatch failed', err))
  }
  return { type: 'invited' as const, email: lowerEmail }
}

export async function hasValidPendingInvite(email: string): Promise<boolean> {
  const lowerEmail = email.toLowerCase()
  const now = new Date()

  const [realm] = await db
    .select({ id: realmInvites.id })
    .from(realmInvites)
    .where(and(
      eq(realmInvites.email, lowerEmail),
      isNull(realmInvites.acceptedAt),
      gte(realmInvites.expiresAt, now),
    ))
    .limit(1)
  if (realm) return true

  const [project] = await db
    .select({ id: projectInvites.id })
    .from(projectInvites)
    .where(and(
      eq(projectInvites.email, lowerEmail),
      isNull(projectInvites.acceptedAt),
      gte(projectInvites.expiresAt, now),
    ))
    .limit(1)
  return !!project
}

export async function cancelRealmInvite(groupId: string, inviteId: string): Promise<{ id: string } | null> {
  const [deleted] = await db
    .delete(realmInvites)
    .where(and(eq(realmInvites.id, inviteId), eq(realmInvites.groupId, groupId)))
    .returning({ id: realmInvites.id })
  return deleted ?? null
}

export async function resendRealmInvite(groupId: string, inviteId: string) {
  const newExpiresAt = new Date(Date.now() + REALM_INVITE_TTL_MS)

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(realmInvites)
      .where(and(
        eq(realmInvites.id, inviteId),
        eq(realmInvites.groupId, groupId),
        isNull(realmInvites.acceptedAt),
      ))
    if (!invite) return null

    const [updated] = await tx
      .update(realmInvites)
      .set({ expiresAt: newExpiresAt })
      .where(and(eq(realmInvites.id, inviteId), eq(realmInvites.groupId, groupId)))
      .returning()

    const [group] = await tx
      .select({ name: workspaceGroups.name })
      .from(workspaceGroups)
      .where(eq(workspaceGroups.id, groupId))

    return { invite, updated, groupName: group?.name || 'Untitled' }
  })

  if (!result) return null

  const baseUrl = getBaseUrl()
  if (baseUrl) {
    sendRealmInviteEmail(
      result.invite.email,
      result.groupName,
      'A team member',
      `${baseUrl}/invite/realm/${result.invite.token}`,
    ).catch((err) => console.error('[resendRealmInvite] email dispatch failed', err))
  }

  return result.updated
}

export async function resolveUserPendingInvites(userId: string, email: string): Promise<number> {
  const lowerEmail = email.toLowerCase()
  const now = new Date()

  return db.transaction(async (tx) => {
    const pendingRealms = await tx
      .select({
        id: realmInvites.id,
        groupId: realmInvites.groupId,
        role: realmInvites.role,
      })
      .from(realmInvites)
      .where(and(
        eq(realmInvites.email, lowerEmail),
        isNull(realmInvites.acceptedAt),
        gte(realmInvites.expiresAt, now),
      ))

    const pendingProjects = await tx
      .select({
        id: projectInvites.id,
        projectId: projectInvites.projectId,
        role: projectInvites.role,
        invitedBy: projectInvites.invitedBy,
      })
      .from(projectInvites)
      .where(and(
        eq(projectInvites.email, lowerEmail),
        isNull(projectInvites.acceptedAt),
        gte(projectInvites.expiresAt, now),
      ))

    if (pendingRealms.length === 0 && pendingProjects.length === 0) return 0

    for (const inv of pendingRealms) {
      await tx
        .insert(groupMembers)
        .values({ groupId: inv.groupId, userId, role: inv.role })
        .onConflictDoNothing()
    }
    for (const inv of pendingProjects) {
      await tx
        .insert(projectMembers)
        .values({ projectId: inv.projectId, userId, role: inv.role, invitedBy: inv.invitedBy })
        .onConflictDoNothing()
    }

    if (pendingRealms.length > 0) {
      await tx
        .update(realmInvites)
        .set({ acceptedAt: now })
        .where(and(
          inArray(realmInvites.id, pendingRealms.map((p) => p.id)),
          isNull(realmInvites.acceptedAt),
        ))
    }
    if (pendingProjects.length > 0) {
      await tx
        .update(projectInvites)
        .set({ acceptedAt: now })
        .where(and(
          inArray(projectInvites.id, pendingProjects.map((p) => p.id)),
          isNull(projectInvites.acceptedAt),
        ))
    }

    return pendingRealms.length + pendingProjects.length
  })
}

