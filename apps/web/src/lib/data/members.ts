import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { projectMembers, projectInvites, users, projectGroups, groupMembers, projects } from '@/lib/db/schema'
import { eq, and, isNull, gte, sql } from 'drizzle-orm'

export async function findMembers(projectId: string) {
  return db
    .select({
      userId: projectMembers.userId,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
}

// Everyone who can be assigned to a task on this project: the owner, explicit
// project members, AND members of any realm the project belongs to. Realm
// members get board access via `groupMembers` and are never written into
// `projectMembers`, so a projectMembers-only list is empty for realm projects
// (and omits the owner on every project). Precedence on role:
// realm membership < explicit project member < owner.
export async function findAssignableMembers(projectId: string) {
  const [direct, realm, owners] = await Promise.all([
    db
      .select({
        userId: projectMembers.userId,
        role: projectMembers.role,
        createdAt: projectMembers.createdAt,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId)),
    db
      .select({
        userId: groupMembers.userId,
        role: groupMembers.role,
        createdAt: groupMembers.createdAt,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(projectGroups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, projectGroups.groupId))
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(projectGroups.projectId, projectId)),
    db
      .select({
        userId: projects.userId,
        role: sql<string>`'owner'`,
        createdAt: projects.createdAt,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(projects.id, projectId)),
  ])

  const byId = new Map<string, (typeof direct)[number]>()
  for (const m of realm) byId.set(m.userId, m)
  for (const m of direct) byId.set(m.userId, m)
  for (const m of owners) byId.set(m.userId, m)
  return [...byId.values()]
}

export async function addMember(projectId: string, userId: string, role: string, invitedBy?: string) {
  const [member] = await db
    .insert(projectMembers)
    .values({ projectId, userId, role, invitedBy: invitedBy || null })
    .onConflictDoNothing()
    .returning()

  return member || null
}

export async function removeMember(projectId: string, userId: string) {
  const [removed] = await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning()

  return !!removed
}

export async function updateMemberRole(projectId: string, userId: string, role: string) {
  const [updated] = await db
    .update(projectMembers)
    .set({ role })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning()

  return updated || null
}

export async function createInvite(projectId: string, email: string, role: string, invitedBy: string) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const [invite] = await db
    .insert(projectInvites)
    .values({ projectId, email: email.toLowerCase(), role, invitedBy, token, expiresAt })
    .returning()

  return invite
}

export async function findInviteByToken(token: string) {
  const [invite] = await db
    .select()
    .from(projectInvites)
    .where(and(eq(projectInvites.token, token), isNull(projectInvites.acceptedAt)))

  return invite || null
}

export async function acceptInvite(token: string, userId: string) {
  const invite = await findInviteByToken(token)
  if (!invite) return null
  if (new Date() > invite.expiresAt) return null

  await db.transaction(async (tx) => {
    await tx
      .insert(projectMembers)
      .values({
        projectId: invite.projectId,
        userId,
        role: invite.role,
        invitedBy: invite.invitedBy,
      })
      .onConflictDoNothing()

    await tx
      .update(projectInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(projectInvites.id, invite.id))
  })

  return invite
}

export async function findPendingInvites(projectId: string) {
  return db
    .select()
    .from(projectInvites)
    .where(and(
      eq(projectInvites.projectId, projectId),
      isNull(projectInvites.acceptedAt),
      gte(projectInvites.expiresAt, new Date()),
    ))
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))

  return user || null
}
