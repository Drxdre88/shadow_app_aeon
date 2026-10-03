import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import type { NearMissRow } from '@/lib/kairos/incubation/shelf'

// Incubation reads (wave 3 lane C). Pure DB: the idea rows of the tournament
// nights in [fromDay, toDay] that matter to the shelf — survivors (to count
// each night's survivors) and ranked_out candidates (the near-misses).

const SCAN_CAP = 200

const ideaField = (key: string) => sql`${memories.sourceMetadata}->'idea'->>${key}`

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

export async function listNearMissCandidates(userId: string, fromDay: string, toDay: string): Promise<NearMissRow[]> {
  const rows = await db
    .select({ id: memories.id, title: memories.title, idea: sql<unknown>`${memories.sourceMetadata}->'idea'` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`jsonb_typeof(${memories.sourceMetadata}->'idea') = 'object'`,
      sql`${ideaField('tournamentDate')} >= ${fromDay}`,
      sql`${ideaField('tournamentDate')} <= ${toDay}`,
      sql`(${ideaField('status')} = 'survivor' OR ${ideaField('eliminatedReason')} = 'ranked_out')`,
    ))
    .orderBy(sql`${ideaField('tournamentDate')} ASC`, memories.id)
    .limit(SCAN_CAP)
  return rows.map((r) => {
    const idea = (r.idea && typeof r.idea === 'object' ? r.idea : {}) as Record<string, unknown>
    return {
      id: r.id,
      title: r.title,
      claim: str(idea.claim),
      nextStep: str(idea.nextStep),
      direction: str(idea.direction),
      tournamentDate: str(idea.tournamentDate),
      rank: typeof idea.rank === 'number' && Number.isFinite(idea.rank) ? idea.rank : null,
      status: str(idea.status),
      eliminatedReason: typeof idea.eliminatedReason === 'string' ? idea.eliminatedReason : null,
    }
  })
}
