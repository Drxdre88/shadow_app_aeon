import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'

// Voice-sample proposals (character check, Lane B). Pure DB, no business
// rules: the weekly character check proposes one of Kairos's own texts as a
// "this is your real voice" anchor; the owner approves or vetoes it through
// the proposal-decision registry. Rows are type 'inbound', streamClass 'trace'
// (kept out of retrieval and every Kairos prompt), tags ['proposal',
// 'voice_sample']. Top-level sourceMetadata.status is the claim:
// pending → approved | vetoed | expired, each a compare-and-set. jsonb only.

export const VOICE_SAMPLE_KIND = 'voice_sample' as const
export type VoiceSampleStatus = 'pending' | 'approved' | 'vetoed' | 'expired'

const kindIs = sql`${memories.sourceMetadata}->>'kind' = ${VOICE_SAMPLE_KIND}`
const statusIs = (s: VoiceSampleStatus) => sql`${memories.sourceMetadata}->>'status' = ${s}`
const expiresAt = sql`(${memories.sourceMetadata}->>'expiresAt')::timestamptz`
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`
const scope = (userId: string) => and(eq(memories.userId, userId), eq(memories.type, 'inbound'), kindIs)!

export interface VoiceSampleInsert {
  // `voice_sample:<isoWeek>` — one proposal per week at most.
  externalKey: string
  title: string
  bodyMd: string
  text: string
  source: string
  isoWeek: string
  expiresAt: string
  jobId: string
  now: Date
}

// Idempotent per externalKey (advisory lock + check, like insertDriftObservation).
export async function insertVoiceSampleProposal(
  userId: string,
  input: VoiceSampleInsert,
): Promise<{ id: string; written: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${input.externalKey}))`)
    const [existing] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(scope(userId), sql`${memories.sourceMetadata}->>'externalKey' = ${input.externalKey}`))
      .limit(1)
    if (existing) return { id: existing.id, written: false }
    const [row] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        title: input.title.slice(0, 255),
        bodyMd: input.bodyMd,
        summary: input.text.slice(0, 240),
        type: 'inbound',
        streamClass: 'trace',
        source: 'cron',
        confidence: confidenceForStreamClass('trace'),
        links: [],
        tags: ['proposal', VOICE_SAMPLE_KIND],
        sourceMetadata: {
          kind: VOICE_SAMPLE_KIND,
          status: 'pending',
          externalKey: input.externalKey,
          // Top level too: the decision function's expiry check reads it there.
          expiresAt: input.expiresAt,
          jobId: input.jobId,
          voiceSample: { text: input.text, source: input.source, isoWeek: input.isoWeek, expiresAt: input.expiresAt },
        },
        pinned: false,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning({ id: memories.id })
    if (!row) throw new Error('voice sample insert returned no row')
    return { id: row.id, written: true }
  })
}

// Pending and not yet past expiry.
export async function countPendingVoiceSamples(userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(scope(userId), statusIs('pending'), sql`${expiresAt} > ${ts(now)}`))
  return Number(row?.n ?? 0)
}

// Compare-and-set on the top-level status. False = the row was not `from`
// (already decided, expired, missing or not this user's).
export async function casVoiceSampleStatus(
  userId: string,
  id: string,
  from: VoiceSampleStatus,
  to: VoiceSampleStatus,
  now: Date,
): Promise<boolean> {
  const patch = JSON.stringify({ status: to, decidedAt: now.toISOString() })
  const rows = await db
    .update(memories)
    .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${patch}::jsonb`, updatedAt: now })
    .where(and(eq(memories.id, id), scope(userId), statusIs(from)))
    .returning({ id: memories.id })
  return rows.length > 0
}

// Pending past expiry → expired (no reaction). Returns the ids it moved.
export async function expireVoiceSamples(userId: string, now: Date): Promise<string[]> {
  const patch = JSON.stringify({ status: 'expired', decidedAt: now.toISOString() })
  const rows = await db
    .update(memories)
    .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${patch}::jsonb`, updatedAt: now })
    .where(and(scope(userId), statusIs('pending'), sql`${expiresAt} <= ${ts(now)}`))
    .returning({ id: memories.id })
  return rows.map((r) => r.id)
}

export interface ApprovedVoiceSample {
  id: string
  text: string
  source: string
}

// The newest approved samples — the character check's anchors.
export async function listApprovedVoiceSamples(userId: string, limit = 6): Promise<ApprovedVoiceSample[]> {
  const rows = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(scope(userId), statusIs('approved')))
    .orderBy(desc(sql`${memories.sourceMetadata}->>'decidedAt'`), desc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), 20))
  return rows.flatMap((r) => {
    const v = (r.sourceMetadata as Record<string, unknown> | null)?.voiceSample as Record<string, unknown> | undefined
    return typeof v?.text === 'string' && v.text.trim()
      ? [{ id: r.id, text: v.text, source: typeof v.source === 'string' ? v.source : 'unknown' }]
      : []
  })
}
