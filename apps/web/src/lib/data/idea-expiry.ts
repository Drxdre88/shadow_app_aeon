import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { IDEA_EXPIRED_OUTCOME, IDEA_PROPOSAL_KIND } from '@/lib/kairos/ideas/types'

// Idea expiry (Wave 2): a surviving idea left undecided in the inbox for
// IDEA_EXPIRY_DAYS is archived as outcome 'ignored' — never deleted, still in
// the archive, and still counted by taste as ignored. Pure DB, one UPDATE.

export const IDEA_EXPIRY_DAYS = 7
const DAY_MS = 86_400_000

// Ids of the ideas expired by this call ([] when none were due).
export async function expireStaleIdeaProposals(
  userId: string,
  now: Date = new Date(),
  days: number = IDEA_EXPIRY_DAYS,
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - days * DAY_MS)
  const at = now.toISOString()
  const rows = await db
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(jsonb_set(jsonb_set(jsonb_set(${memories.sourceMetadata}, '{status}', to_jsonb(${IDEA_EXPIRED_OUTCOME}::text)), '{idea,outcome}', to_jsonb(${IDEA_EXPIRED_OUTCOME}::text)), '{idea,outcomeAt}', to_jsonb(${at}::text)), '{idea,expiredAt}', to_jsonb(${at}::text))`,
      archivedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'kind' = ${IDEA_PROPOSAL_KIND}`,
      sql`jsonb_typeof(${memories.sourceMetadata}->'idea') = 'object'`,
      sql`${memories.sourceMetadata}->'idea'->>'status' = 'survivor'`,
      sql`coalesce(${memories.sourceMetadata}->>'status', 'pending') = 'pending'`,
      sql`${memories.sourceMetadata}->'idea'->>'outcome' is null`,
      lt(memories.createdAt, cutoff),
    ))
    .returning({ id: memories.id })
  return rows.map((r) => r.id)
}
