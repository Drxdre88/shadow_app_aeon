'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor } from './helpers'
import { updateMemberProfileSchema } from '@/lib/data/validators'
import { findAssignableMembers } from '@/lib/data/members'
import {
  findPrimaryRealmId,
  upsertMemberProfile,
  touchRealmProjects,
} from '@/lib/data/member-profiles'

/**
 * Set (or clear) one real member's display override for this project's realm.
 *
 * Authorisation is two-layered on purpose. `requireEditor` proves the caller
 * may write to THIS project; the assignable-members check proves the TARGET is
 * someone this project can actually see. Without the second, an editor of a
 * project that happens to share a realm could write a profile row for any user
 * id they could guess, and it would render on every board in that realm.
 */
export async function setMemberProfileAction(
  projectId: string,
  userId: string,
  updates: unknown,
) {
  const actorId = await requireEditor(projectId)
  const patch = updateMemberProfileSchema.parse(updates)

  const realmId = await findPrimaryRealmId(projectId)
  if (!realmId) {
    throw new Error('This project is not in a realm — member styling lives at realm level')
  }

  const assignable = await findAssignableMembers(projectId)
  if (!assignable.some((m) => m.userId === userId)) {
    throw new Error('That person is not a member of this project')
  }

  const row = await upsertMemberProfile(realmId, userId, patch, actorId)

  // Every project in the realm renders these avatars, so all of them are stale
  // now — not just the one the edit was made from.
  await touchRealmProjects(realmId, { type: 'task:updated' })
  revalidatePath(`/project/${projectId}`)

  return row
}
