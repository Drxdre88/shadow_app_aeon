import { listOpenKairosAsks } from '@/lib/data/ask'
import { listMemories } from '@/lib/data/memories'
import { listPendingVoiceSamples } from '@/lib/data/voice-samples'
import { listPendingCardTrees } from '@/lib/data/card-tree-proposals'
import { listPendingCardGardens } from '@/lib/data/card-garden-proposals'
import { CARD_TREE_KIND, readCardTree, type CardTree } from '@/lib/kairos/card-tree/types'
import { CARD_GARDEN_KIND, readCardGarden, type CardGardenPick } from '@/lib/kairos/card-garden/types'
import { GOAL_PROPOSAL_KIND, readGoalMeta } from '@/lib/kairos/goals/parse'
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
  goal?: KairosInboxGoal | null
  cardTree?: KairosInboxCardTree | null
  cardGarden?: KairosInboxCardGarden | null
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

// Kairos's own goal proposal (Phase 2) awaiting Approve / Veto. One past its
// 72h expiry can no longer be decided, so it is not listed.
export interface KairosInboxGoal { question: string; why: string; successCheck: string; dueInDays: number; expiresAt: string }

function readGoal(metadata: Record<string, unknown>, now: Date): KairosInboxGoal | null {
  if (metadata.kind !== GOAL_PROPOSAL_KIND) return null
  const goal = readGoalMeta(metadata)
  if (!goal || goal.state !== 'proposed') return null
  if (!(Date.parse(goal.expiresAt) > now.getTime())) return null
  return { question: goal.question, why: goal.why, successCheck: goal.successCheck.text, dueInDays: goal.dueInDays, expiresAt: goal.expiresAt }
}

// Vorath's drafted card tree (Workforce L4) awaiting Approve / Veto. One past
// its 7-day expiry can no longer be decided, so it is not listed.
export type KairosInboxCardTree = CardTree & { expiresAt: string }

function readInboxCardTree(metadata: Record<string, unknown>, now: Date): KairosInboxCardTree | null {
  const tree = readCardTree(metadata)
  if (!tree || typeof metadata.expiresAt !== 'string' || !(Date.parse(metadata.expiresAt) > now.getTime())) return null
  return { ...tree, expiresAt: metadata.expiresAt }
}

// Vorath's weekly card garden suggestion (one card) awaiting Approve / Veto.
export type KairosInboxCardGarden = CardGardenPick & { expiresAt: string }

function readInboxCardGarden(metadata: Record<string, unknown>, now: Date): KairosInboxCardGarden | null {
  const pick = readCardGarden(metadata)
  if (!pick || typeof metadata.expiresAt !== 'string' || !(Date.parse(metadata.expiresAt) > now.getTime())) return null
  return { ...pick, expiresAt: metadata.expiresAt }
}

export async function getKairosInbox(userId: string, now: Date = new Date()): Promise<{ items: KairosInboxItem[] }> {
  const [asks, inbound, voiceSamples, cardTrees, cardGardens] = await Promise.all([
    listOpenKairosAsks(userId),
    listMemories(userId, { type: 'inbound', limit: INBOUND_LIMIT }),
    // Voice samples are filed as 'trace' (out of retrieval), which
    // listMemories hides, so they are read separately.
    listPendingVoiceSamples(userId, now).catch(() => []),
    listPendingCardTrees(userId, now).catch(() => []),
    listPendingCardGardens(userId, now).catch(() => []),
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
  const goals: KairosInboxEntry[] = []
  const ideas: KairosInboxEntry[] = []
  for (const memory of [...inbound, ...voiceSamples, ...cardTrees, ...cardGardens]) {
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
      const goal = readGoal(metadata, now)
      if (metadata.kind === GOAL_PROPOSAL_KIND && !goal) continue
      const cardTree = readInboxCardTree(metadata, now)
      if (metadata.kind === CARD_TREE_KIND && !cardTree) continue
      const cardGarden = readInboxCardGarden(metadata, now)
      if (metadata.kind === CARD_GARDEN_KIND && !cardGarden) continue
      const idea = readIdea(metadata)
      const voiceNote = readVoiceNote(metadata)
      const item: KairosInboxEntry = {
        kind: 'proposal',
        id: memory.id,
        title: memory.title,
        summary: memory.summary,
        createdAt: memory.createdAt,
        ...(goal ? { goal } : {}),
        ...(cardTree ? { cardTree } : {}),
        ...(cardGarden ? { cardGarden } : {}),
        ...(idea ? { idea } : {}),
        ...(voiceNote ? { voiceNote } : {}),
      }
      if (goal || cardTree || cardGarden) goals.push(item)
      else if (idea) ideas.push(item)
      else entries.push(item)
    }
  }
  // Only proposals carrying a voiceNote ref are grouped (see voice-note.ts).
  const items: KairosInboxItem[] = groupVoiceNoteProposals(entries).map((i) => (
    i.kind === 'voice_note' ? { ...(i as VoiceNoteGroup<KairosInboxProposal>), id: i.noteId } : i
  ))
  const isProposalLike = (i: KairosInboxItem) => i.kind === 'proposal' || i.kind === 'voice_note'
  // Kairos's goal proposals, then tournament survivors (1–3 a night), lead
  // the proposals so they aren't buried under older proposals.
  const firstProposal = items.findIndex(isProposalLike)
  items.splice(firstProposal === -1 ? items.length : firstProposal, 0, ...goals, ...ideas)
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
