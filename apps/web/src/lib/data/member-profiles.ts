import { db } from '@/lib/db'
import { memberProfiles, projectGroups } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { touchProject } from './projects'
import type { UpdateMemberProfileInput } from './validators'

// Per-realm display overrides for REAL members — the initials, colour and name
// their avatar renders. Mirrors lib/data/virtual-members.ts, which is
// realm-scoped for the same reason: identity that one team chooses must not
// leak into another team's view of the same person.

export type MemberProfileRow = {
  userId: string
  initials: string | null
  color: string | null
  displayName: string | null
}

/**
 * The realm a project writes its people into.
 *
 * Oldest membership first, matching `findRealmIdsForProject` and therefore
 * matching where `createVirtualMemberAction` files a new virtual member. The
 * two must agree: if overrides landed in one realm and virtual members in
 * another, a board would show half its people customised and half not.
 */
export async function findPrimaryRealmId(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ groupId: projectGroups.groupId })
    .from(projectGroups)
    .where(eq(projectGroups.projectId, projectId))
    .orderBy(projectGroups.createdAt)
    .limit(1)
  return row?.groupId ?? null
}

/** Overrides for one realm, keyed by userId. Empty map when the project has no realm. */
export async function findMemberProfilesForProject(
  projectId: string,
): Promise<Map<string, MemberProfileRow>> {
  const realmId = await findPrimaryRealmId(projectId)
  if (!realmId) return new Map()
  return findMemberProfilesForRealm(realmId)
}

export async function findMemberProfilesForRealm(
  realmId: string,
): Promise<Map<string, MemberProfileRow>> {
  const rows = await db
    .select({
      userId: memberProfiles.userId,
      initials: memberProfiles.initials,
      color: memberProfiles.color,
      displayName: memberProfiles.displayName,
    })
    .from(memberProfiles)
    .where(eq(memberProfiles.realmId, realmId))

  return new Map(rows.map((r) => [r.userId, r]))
}

/**
 * Apply an override patch for one person in one realm.
 *
 * `undefined` in the patch means "leave this field alone"; an explicit `null`
 * means "clear this override". When the merge leaves nothing set the row is
 * DELETED rather than written empty — the table's not-empty CHECK would reject
 * it, and a surviving all-null row would make "has an override" a three-column
 * question instead of a row-existence one.
 *
 * Returns the resulting row, or null when the override was cleared entirely.
 */
export async function upsertMemberProfile(
  realmId: string,
  userId: string,
  patch: UpdateMemberProfileInput,
  createdById: string,
): Promise<MemberProfileRow | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        initials: memberProfiles.initials,
        color: memberProfiles.color,
        displayName: memberProfiles.displayName,
      })
      .from(memberProfiles)
      .where(and(eq(memberProfiles.realmId, realmId), eq(memberProfiles.userId, userId)))

    const merged = {
      initials: patch.initials === undefined ? (existing?.initials ?? null) : patch.initials,
      color: patch.color === undefined ? (existing?.color ?? null) : patch.color,
      displayName: patch.displayName === undefined ? (existing?.displayName ?? null) : patch.displayName,
    }

    const empty = merged.initials === null && merged.color === null && merged.displayName === null

    if (empty) {
      if (existing) {
        await tx
          .delete(memberProfiles)
          .where(and(eq(memberProfiles.realmId, realmId), eq(memberProfiles.userId, userId)))
      }
      return null
    }

    if (existing) {
      await tx
        .update(memberProfiles)
        .set({ ...merged, updatedAt: new Date() })
        .where(and(eq(memberProfiles.realmId, realmId), eq(memberProfiles.userId, userId)))
    } else {
      await tx.insert(memberProfiles).values({ realmId, userId, ...merged, createdById })
    }

    return { userId, ...merged }
  })
}

/** Realm-scoped delete — a caller authorised for realm A cannot clear realm B's override. */
export async function deleteMemberProfile(realmId: string, userId: string): Promise<void> {
  await db
    .delete(memberProfiles)
    .where(and(eq(memberProfiles.realmId, realmId), eq(memberProfiles.userId, userId)))
}

/**
 * Every project in a realm shows the same overrides, so a write has to bump all
 * of them or a sibling board keeps serving the old avatar until its next cold
 * load. Realtime for the timeline's neighbours, effectively.
 */
export async function touchRealmProjects(realmId: string, event: { type: string }): Promise<void> {
  const rows = await db
    .select({ projectId: projectGroups.projectId })
    .from(projectGroups)
    .where(eq(projectGroups.groupId, realmId))
  if (rows.length === 0) return
  await Promise.all(rows.map((r) => touchProject(r.projectId, event)))
}

/** Guard: the user must actually be reachable from this realm before we store a profile for them. */
export async function userIsInRealm(realmId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const { groupMembers } = await import('@/lib/db/schema')
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, realmId), inArray(groupMembers.userId, userIds)))
  return new Set(rows.map((r) => r.userId))
}
