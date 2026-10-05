import { db } from '@/lib/db'
import { dominionMembers, dominions, projects } from '@/lib/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { livingDominionsMode } from '@/lib/kairos/living/flag'
import { listLiveDominions } from './dominion-focus'
import { rankByActivity } from '@/lib/kairos/living/focus'
import { getUnattributedActivity } from './dominion-activity'
import { upsertOwnerMember } from './dominions'

// Living Dominions API seam (research/vorath_0510/living_dominions.md §2 C–D):
// board membership on project assignment and the ranked focus read shared by
// the get_dominion_focus MCP tool and GET /api/v1/dominions/focus.

/**
 * Point one user's 'board' membership for a project at `next` (inside a transaction):
 * every other active board link of that user for the project is dropped, and the
 * new link is written only when `next` is that user's own Dominion.
 */
export async function syncBoardMembership(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: { userId: string; projectId: string; next: string | null },
) {
  const { userId, projectId, next } = args
  await tx
    .delete(dominionMembers)
    .where(and(
      eq(dominionMembers.userId, userId),
      eq(dominionMembers.kind, 'board'),
      eq(dominionMembers.ref, projectId),
      eq(dominionMembers.status, 'active'),
      ...(next ? [ne(dominionMembers.dominionId, next)] : []),
    ))
  if (!next) return
  const [owned] = await tx
    .select({ id: dominions.id })
    .from(dominions)
    .where(and(eq(dominions.id, next), eq(dominions.userId, userId)))
    .limit(1)
  if (owned) await upsertOwnerMember(tx, { userId, dominionId: next, kind: 'board', ref: projectId })
}

/**
 * Set (or clear with null) a project's Dominion and keep the acting user's
 * 'board' membership in step (see syncBoardMembership). Callers verify project access.
 */
export async function assignProjectDominion(projectId: string, userId: string, dominionId: string | null) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(projects)
      .set({ dominionId, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning()
    if (!updated) return null

    await syncBoardMembership(tx, { userId, projectId, next: dominionId })
    return updated
  })
}

/** Update a project (any fields, incl. dominionId) and move the acting user's board membership in one transaction. */
export async function updateProjectAndBoardMembership(
  projectId: string,
  userId: string,
  set: Partial<typeof projects.$inferInsert>,
  next: string | null,
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(projects).set(set).where(eq(projects.id, projectId)).returning()
    if (!updated) return null
    await syncBoardMembership(tx, { userId, projectId, next })
    return updated
  })
}

/** Ranked live Dominions plus recent work that maps to none. Read-only. */
export async function getDominionFocus(userId: string) {
  const [live, unattributed] = await Promise.all([
    listLiveDominions(userId),
    getUnattributedActivity(userId),
  ])
  return {
    mode: livingDominionsMode(),
    dominions: rankByActivity(live).map((d) => ({
      id: d.id,
      name: d.name,
      activityScore: d.activityScore,
      lastActiveAt: d.lastActiveAt,
      focusState: d.focusState,
      pinned: d.pinned,
      dormant: d.dormant,
      activity: d.activity,
    })),
    unattributed,
  }
}
