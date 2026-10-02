import { listOpenKairosAsks } from '@/lib/data/ask'
import { listMemories } from '@/lib/data/memories'
import { groupVoiceNoteProposals, readVoiceNote, type VoiceNoteGroup, type VoiceNoteRef } from '@/lib/kairos/voice-note'

export type KairosInboxUrgency = 'low' | 'normal' | 'high'

// The daily message's externalId prefix (lib/kairos/daily-message.ts
// dailyMessageExternalId) — repeated here to keep the data layer import-free.
const DAILY_MESSAGE_ID_PREFIX = 'kairos-daily:'

// Will slice 2 — every inbox entry carries a discriminated `kind` so the
// panel (and any other surface) can render without sniffing metadata.
// `daily` marks the 06:00 daily message (the panel pins it first). Every open
// Kairos question is its own `ask` item, carrying its stable Q number. The
// pending parts of one voice note collapse into ONE `voice_note` item (at the
// position of its first listed part), confirmed or discarded as a whole.
export type KairosInboxProposal = {
  kind: 'proposal'
  id: string
  title: string
  summary: string | null
  createdAt: Date
  idea?: KairosInboxIdea | null
  voiceNote?: VoiceNoteRef | null
}
type KairosInboxEntry =
  | { kind: 'ask'; id: string; seq: number; title: string; createdAt: Date }
  | KairosInboxProposal
  | { kind: 'notify'; id: string; title: string; summary: string | null; urgency: KairosInboxUrgency; createdAt: Date; daily?: boolean }
// `parts` = the note's total; `segments` = its parts still pending, in order;
// `id` = the noteId (what confirm / discard take).
export type KairosInboxVoiceNote = VoiceNoteGroup<KairosInboxProposal> & { id: string }
export type KairosInboxItem = KairosInboxEntry | KairosInboxVoiceNote

// Inbound rows read per inbox load: enough for a long voice note (~100
// parts) plus the usual messages and proposals, still bounded.
const INBOUND_LIMIT = 200

// Idea-tournament survivor details (docs/kairos/35) for the inbox card.
export interface KairosInboxIdea { claim: string; why: string; nextStep: string; survivedBecause: string | null }

function readIdea(metadata: Record<string, unknown>): KairosInboxIdea | null {
  if (metadata.kind !== 'idea' || !metadata.idea || typeof metadata.idea !== 'object') return null
  const idea = metadata.idea as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    claim: text(idea.claim),
    why: text(idea.why),
    nextStep: text(idea.nextStep),
    survivedBecause: typeof idea.survivedBecause === 'string' ? idea.survivedBecause : null,
  }
}

export async function getKairosInbox(userId: string): Promise<{ items: KairosInboxItem[] }> {
  const [asks, inbound] = await Promise.all([
    listOpenKairosAsks(userId),
    listMemories(userId, { type: 'inbound', limit: INBOUND_LIMIT }),
  ])

  // Open questions first (oldest first, by Q number), then Kairos's messages
  // (today's daily message pinned first), then proposals with tournament
  // ideas leading.
  const entries: KairosInboxEntry[] = asks.map((ask) => ({
    kind: 'ask' as const,
    id: ask.id,
    seq: ask.seq,
    title: ask.title,
    createdAt: ask.createdAt,
  }))

  let latestDaily: KairosInboxEntry | null = null
  const ideas: KairosInboxEntry[] = []
  for (const memory of inbound) {
    const metadata = (memory.sourceMetadata ?? {}) as Record<string, unknown>
    if (metadata.status !== 'pending') continue
    // Contradiction notices are retired (Kairos 0.17); old pending rows stay
    // in the DB but never reach the inbox.
    if (metadata.contradictionCheck === true) continue
    if (metadata.kairosSpeak === true) {
      const urgency = metadata.urgency
      const isDaily = typeof metadata.externalId === 'string' && metadata.externalId.startsWith(DAILY_MESSAGE_ID_PREFIX)
      const item: KairosInboxEntry = {
        kind: 'notify',
        id: memory.id,
        title: memory.title,
        summary: memory.summary,
        urgency: urgency === 'low' || urgency === 'high' ? urgency : 'normal',
        createdAt: memory.createdAt,
        ...(isDaily ? { daily: true } : {}),
      }
      entries.push(item)
      if (isDaily && (!latestDaily || item.createdAt > latestDaily.createdAt)) latestDaily = item
    } else {
      const idea = readIdea(metadata)
      const voiceNote = readVoiceNote(metadata)
      const item: KairosInboxEntry = {
        kind: 'proposal',
        id: memory.id,
        title: memory.title,
        summary: memory.summary,
        createdAt: memory.createdAt,
        ...(idea ? { idea } : {}),
        ...(voiceNote ? { voiceNote } : {}),
      }
      if (idea) ideas.push(item)
      else entries.push(item)
    }
  }
  // Only proposals carrying a voiceNote ref are grouped (see voice-note.ts).
  const items: KairosInboxItem[] = groupVoiceNoteProposals(entries).map((i) => (
    i.kind === 'voice_note' ? { ...(i as VoiceNoteGroup<KairosInboxProposal>), id: i.noteId } : i
  ))
  const isProposalLike = (i: KairosInboxItem) => i.kind === 'proposal' || i.kind === 'voice_note'
  // Tournament survivors (1–3 a night) lead the proposals so they aren't
  // buried under older proposals.
  const firstProposal = items.findIndex(isProposalLike)
  items.splice(firstProposal === -1 ? items.length : firstProposal, 0, ...ideas)
  // The newest daily message is pinned ahead of every other notify/proposal;
  // older undismissed ones keep their place.
  if (latestDaily) {
    items.splice(items.indexOf(latestDaily), 1)
    const firstNotify = items.findIndex((i) => i.kind === 'notify' || isProposalLike(i))
    items.splice(firstNotify === -1 ? items.length : firstNotify, 0, latestDaily)
  }

  return { items }
}

// Shared triage result — dismiss/accept live in lib/kairos/proposal-accept.ts
// (they apply reactions + constitution dispatch, which is not data-layer work).
export type InboxResolution =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'already_resolved' }
