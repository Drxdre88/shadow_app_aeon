import { db } from '@/lib/db'
import { boardTasks } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { verifyProjectAccess } from './projects'

// A session anchored to a card can rewrite that card (result cache, column,
// Plan checklist, follow-up seeds), so anchoring one needs the same editor
// right a card edit does. One message for every refusal: a missing card and a
// foreign card must look identical to the caller.

export const SESSION_ANCHOR_DENIED = 'You need editor access to the project this session is anchored to'

/** True when the user is an owner/editor (not a viewer) of the project. */
export async function canEditProject(projectId: string, userId: string): Promise<boolean> {
  const access = await verifyProjectAccess(projectId, userId)
  return access !== null && access.role !== 'viewer'
}

/** Null when the caller may anchor a session to these ids, else the refusal message. */
export type SessionAnchor = { ok: true; projectId: string | null } | { ok: false; message: string }

/**
 * The project a session may be anchored to, or the refusal. A card anchor
 * pins projectId to the card's own project (a conflicting projectId is
 * refused), so the stored row can never point at one project and write to
 * another's card.
 */
export async function resolveSessionAnchor(
  userId: string,
  anchors: { projectId?: string | null; taskId?: string | null },
): Promise<SessionAnchor> {
  const denied = { ok: false as const, message: SESSION_ANCHOR_DENIED }
  if (anchors.taskId) {
    const [card] = await db
      .select({ projectId: boardTasks.projectId })
      .from(boardTasks)
      .where(eq(boardTasks.id, anchors.taskId))
      .limit(1)
    if (!card) return denied
    if (anchors.projectId && anchors.projectId !== card.projectId) {
      return { ok: false, message: 'taskId does not belong to projectId' }
    }
    return (await canEditProject(card.projectId, userId)) ? { ok: true, projectId: card.projectId } : denied
  }
  if (anchors.projectId) {
    return (await canEditProject(anchors.projectId, userId)) ? { ok: true, projectId: anchors.projectId } : denied
  }
  return { ok: true, projectId: null }
}
