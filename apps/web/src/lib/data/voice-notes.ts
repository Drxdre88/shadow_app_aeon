import { createHash, randomUUID } from 'node:crypto'
import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions, memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import type { Origin } from '@/lib/kairos/origin'
import {
  VOICE_NOTE_IDEMPOTENCY_MS,
  normaliseTranscript,
  readVoiceNote,
  splitTranscript,
  verbatimExcerpt,
  voiceNoteTitle,
  type VoiceNoteRef,
} from '@/lib/kairos/voice-note'
import type { KairosVoiceNoteInput } from './validators/voice-notes'

// Voice notes — pure DB writes (docs/kairos/32 §5 origin rules). A transcript
// is staged as pending reflection proposals (one per segment, agent origin)
// that the inbox already renders and accepts; accepting rewrites a segment as
// the operator's own words. Claude's optional summary is a separate agent note
// and never a proposal.

export const VOICE_NOTE_SUMMARY_KIND = 'voice_note_summary'

export interface StageVoiceNoteOptions {
  source: 'claude' | 'manual'
  via: string
}

export type StageVoiceNoteResult =
  | { ok: true; noteId: string; parts: number; created: boolean; proposalIds: string[]; summaryId: string | null }
  | { ok: false; reason: 'dominion_not_found' | 'empty_transcript' }

export interface VoiceNoteSegmentRow {
  id: string
  type: string
  status: string | null
  archivedAt: Date | null
  voiceNote: VoiceNoteRef
}

const segmentFilter = (userId: string) => and(
  eq(memories.userId, userId),
  sql`${memories.sourceMetadata}->>'introspection' = 'true'`,
  sql`${memories.sourceMetadata}->'voiceNote' IS NOT NULL`,
)

function toSegments(rows: Array<{ id: string; type: string; archivedAt: Date | null; sourceMetadata: unknown }>): VoiceNoteSegmentRow[] {
  return rows
    .flatMap((r) => {
      const voiceNote = readVoiceNote(r.sourceMetadata)
      if (!voiceNote) return []
      const status = (r.sourceMetadata as Record<string, unknown>).status
      return [{ id: r.id, type: r.type, archivedAt: r.archivedAt, status: typeof status === 'string' ? status : null, voiceNote }]
    })
    .sort((a, b) => a.voiceNote.part - b.voiceNote.part)
}

export function transcriptHash(transcript: string): string {
  return createHash('sha256').update(normaliseTranscript(transcript)).digest('hex')
}

export async function stageVoiceNote(
  userId: string,
  input: KairosVoiceNoteInput,
  opts: StageVoiceNoteOptions,
): Promise<StageVoiceNoteResult> {
  const segments = splitTranscript(input.transcript)
  if (segments.length === 0) return { ok: false, reason: 'empty_transcript' }

  const dominionId = input.dominionId ?? null
  if (dominionId) {
    const [dom] = await db
      .select({ id: dominions.id })
      .from(dominions)
      .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId), isNull(dominions.archivedAt)))
      .limit(1)
    if (!dom) return { ok: false, reason: 'dominion_not_found' }
  }

  const hash = transcriptHash(input.transcript)
  const origin: Origin = { kind: 'agent', via: opts.via }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${`voice-note:${hash}`}))`)
    const now = new Date()
    const recent = await tx
      .select({ id: memories.id, type: memories.type, archivedAt: memories.archivedAt, sourceMetadata: memories.sourceMetadata })
      .from(memories)
      .where(and(
        segmentFilter(userId),
        sql`${memories.sourceMetadata}->'voiceNote'->>'hash' = ${hash}`,
        gte(memories.createdAt, new Date(now.getTime() - VOICE_NOTE_IDEMPOTENCY_MS)),
        isNull(memories.archivedAt),
      ))
      .limit(200)
    const existing = toSegments(recent)
    if (existing.length > 0) {
      const noteId = existing[0].voiceNote.noteId
      const same = existing.filter((s) => s.voiceNote.noteId === noteId)
      return { ok: true as const, noteId, parts: same[0].voiceNote.of, created: false, proposalIds: same.map((s) => s.id), summaryId: null }
    }

    const noteId = randomUUID()
    const of = segments.length
    const inserted = await tx
      .insert(memories)
      .values(segments.map((bodyMd, i) => {
        const excerpt = verbatimExcerpt(bodyMd)
        return {
          userId,
          dominionId,
          title: voiceNoteTitle(i + 1, of, excerpt).slice(0, 255),
          bodyMd,
          summary: excerpt,
          type: 'inbound',
          streamClass: 'agentic',
          confidence: confidenceForStreamClass('agentic'),
          source: opts.source,
          sourceMetadata: {
            introspection: true,
            kind: 'reflection',
            status: 'pending',
            voiceNote: { noteId, part: i + 1, of, hash },
            origin,
          },
          links: [],
          tags: ['proposal', 'voice_note'],
          pinned: false,
          createdAt: now,
          updatedAt: now,
        }
      }))
      .returning({ id: memories.id, type: memories.type, archivedAt: memories.archivedAt, sourceMetadata: memories.sourceMetadata })
    const proposalIds = toSegments(inserted).map((s) => s.id)
    if (proposalIds.length !== of) throw new Error('voice note insert returned a partial result')

    let summaryId: string | null = null
    if (input.claudeSummary) {
      const [row] = await tx
        .insert(memories)
        .values({
          userId,
          dominionId,
          title: 'Claude’s summary of a voice note',
          bodyMd: input.claudeSummary,
          summary: null,
          type: 'note',
          streamClass: 'agentic',
          confidence: confidenceForStreamClass('agentic'),
          source: opts.source,
          sourceMetadata: { kind: VOICE_NOTE_SUMMARY_KIND, voiceNoteSummary: { noteId, of, hash }, origin },
          links: proposalIds.map((target) => ({ type: 'refers_to', target, target_kind: 'memory' as const })),
          tags: ['voice_note'],
          pinned: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: memories.id })
      summaryId = row?.id ?? null
    }

    return { ok: true as const, noteId, parts: of, created: true, proposalIds, summaryId }
  })
}

export async function listVoiceNoteSegments(userId: string, noteId: string): Promise<VoiceNoteSegmentRow[]> {
  const rows = await db
    .select({ id: memories.id, type: memories.type, archivedAt: memories.archivedAt, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(segmentFilter(userId), sql`${memories.sourceMetadata}->'voiceNote'->>'noteId' = ${noteId}`))
  return toSegments(rows)
}

export function isConfirmableSegment(s: VoiceNoteSegmentRow): boolean {
  return s.type === 'inbound' && !s.archivedAt && (s.status === 'pending' || s.status === 'promoted')
}

export async function discardVoiceNote(
  userId: string,
  noteId: string,
): Promise<{ noteId: string; parts: number; discarded: number } | null> {
  return db.transaction(async (tx) => {
    const now = new Date()
    const rows = await tx
      .select({ id: memories.id, type: memories.type, archivedAt: memories.archivedAt, sourceMetadata: memories.sourceMetadata })
      .from(memories)
      .where(and(segmentFilter(userId), sql`${memories.sourceMetadata}->'voiceNote'->>'noteId' = ${noteId}`))
    const segments = toSegments(rows)
    if (segments.length === 0) return null

    const discardable = segments.filter(isConfirmableSegment)
    for (const s of discardable) {
      await tx
        .update(memories)
        .set({
          archivedAt: now,
          updatedAt: now,
          sourceMetadata: sql`${memories.sourceMetadata} || ${JSON.stringify({ status: 'dismissed', dismissedAt: now.toISOString() })}::jsonb`,
        })
        .where(and(eq(memories.userId, userId), eq(memories.id, s.id), isNull(memories.archivedAt)))
    }

    if (!segments.some((s) => s.type !== 'inbound')) {
      await tx
        .update(memories)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(
          eq(memories.userId, userId),
          sql`${memories.sourceMetadata}->'voiceNoteSummary'->>'noteId' = ${noteId}`,
          ne(memories.type, 'inbound'),
          isNull(memories.archivedAt),
        ))
    }

    return { noteId, parts: segments[0].voiceNote.of, discarded: discardable.length }
  })
}
