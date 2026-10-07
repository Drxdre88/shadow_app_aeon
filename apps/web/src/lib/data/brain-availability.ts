import { and, eq, gte, inArray, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { thinkingJobs } from '@/lib/db/schema'
import { getRoutine } from '@/lib/kairos/routines/catalog'

// Is the user's brain routine connected? On-demand brain jobs (card_tree) are
// only ever claimed by the caller's own brain routine, so a user whose routine
// has not claimed anything recently would queue a goal nobody drafts.

// Same window as brain-status's ROUTINE_SILENT_AFTER_MS: a nightly routine claims within 26 h.
export const BRAIN_ROUTINE_RECENT_MS = 26 * 60 * 60 * 1000

/** True when the user's brain routine claimed any of its jobs in the last 26 h. */
export async function brainRoutineClaimedRecently(userId: string, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - BRAIN_ROUTINE_RECENT_MS)
  const [row] = await db
    .select({ id: thinkingJobs.id })
    .from(thinkingJobs)
    .where(and(
      eq(thinkingJobs.userId, userId),
      gte(thinkingJobs.claimedAt, since),
      like(thinkingJobs.claimedBy, 'routine%'),
      inArray(thinkingJobs.kind, [...getRoutine('brain').allowedKinds]),
    ))
    .limit(1)
  return Boolean(row)
}
