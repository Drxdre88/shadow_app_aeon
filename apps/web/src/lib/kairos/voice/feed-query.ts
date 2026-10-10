import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { notHeldSensitive } from '@/lib/kairos/sensitive/held'
import type { VoiceFeedRow, VoiceFeedWindow } from './feed'

// The desk alert feed, read half: one read-only query for the candidate rows
// (Morghul relays, open asks, spoken questions) created strictly after
// `since`, oldest first. toVoiceFeedItem makes the final call on each row.
// Nothing is written: no read marks, no ask numbering, no awaiting-reply.

// Over-fetch so rows the pure filter drops don't starve a page.
const CANDIDATE_FACTOR = 3

export async function loadVoiceFeedRows(userId: string, window: VoiceFeedWindow): Promise<VoiceFeedRow[]> {
  const meta = memories.sourceMetadata
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      summary: memories.summary,
      type: memories.type,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isNull(memories.archivedAt),
      notHeldSensitive,
      // Postgres keeps microseconds, the ISO cursor milliseconds: compare at
      // millisecond precision so the row at the cursor is never returned twice.
      // created_at is a UTC `timestamp` (no zone): compare UTC wall time.
      sql`date_trunc('milliseconds', ${memories.createdAt}) > ${window.since.toISOString().slice(0, 23)}::timestamp`,
      or(
        sql`${meta}->>'kind' = 'morghul_finding'`,
        sql`lower(${meta}->>'channel') = 'morghul'`,
        and(eq(memories.type, 'advisory'), sql`${meta}->>'kairosAskStatus' = 'pending'`),
        and(sql`${meta}->>'kairosSpeak' = 'true'`, sql`${meta}->>'kind' = 'question'`),
      ),
    ))
    .orderBy(asc(memories.createdAt))
    .limit(window.limit * CANDIDATE_FACTOR)
  return rows.map((row) => ({ ...row, sourceMetadata: (row.sourceMetadata ?? null) as Record<string, unknown> | null }))
}
