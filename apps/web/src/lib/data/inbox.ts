import { getPendingKairosAsk } from '@/lib/data/ask'
import { listMemories } from '@/lib/data/memories'

export type KairosInboxUrgency = 'low' | 'normal' | 'high'

// The daily message's externalId prefix (lib/kairos/daily-message.ts
// dailyMessageExternalId) — repeated here to keep the data layer import-free.
const DAILY_MESSAGE_ID_PREFIX = 'kairos-daily:'

// Will slice 2 — every inbox entry carries a discriminated `kind` so the
// panel (and any other surface) can render without sniffing metadata.
// `daily` marks the 08:00 daily message (the panel pins it first).
export type KairosInboxItem =
  | { kind: 'ask'; id: string; title: string; createdAt: Date }
  | { kind: 'proposal'; id: string; title: string; summary: string | null; createdAt: Date; idea?: KairosInboxIdea | null }
  | { kind: 'notify'; id: string; title: string; summary: string | null; urgency: KairosInboxUrgency; createdAt: Date; daily?: boolean }

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
  const [ask, inbound] = await Promise.all([
    getPendingKairosAsk(userId),
    listMemories(userId, { type: 'inbound' }),
  ])

  // The pending ask first, then Kairos's messages (today's daily message
  // pinned first), then proposals with tournament ideas leading.
  const items: KairosInboxItem[] = []
  if (ask) items.push({ kind: 'ask', id: ask.id, title: ask.title, createdAt: ask.createdAt })

  let latestDaily: KairosInboxItem | null = null
  const ideas: KairosInboxItem[] = []
  for (const memory of inbound) {
    const metadata = (memory.sourceMetadata ?? {}) as Record<string, unknown>
    if (metadata.status !== 'pending') continue
    // Contradiction notices are retired (Kairos 0.17); old pending rows stay
    // in the DB but never reach the inbox.
    if (metadata.contradictionCheck === true) continue
    if (metadata.kairosSpeak === true) {
      const urgency = metadata.urgency
      const isDaily = typeof metadata.externalId === 'string' && metadata.externalId.startsWith(DAILY_MESSAGE_ID_PREFIX)
      const item: KairosInboxItem = {
        kind: 'notify',
        id: memory.id,
        title: memory.title,
        summary: memory.summary,
        urgency: urgency === 'low' || urgency === 'high' ? urgency : 'normal',
        createdAt: memory.createdAt,
        ...(isDaily ? { daily: true } : {}),
      }
      items.push(item)
      if (isDaily && (!latestDaily || item.createdAt > latestDaily.createdAt)) latestDaily = item
    } else {
      const idea = readIdea(metadata)
      const item: KairosInboxItem = {
        kind: 'proposal',
        id: memory.id,
        title: memory.title,
        summary: memory.summary,
        createdAt: memory.createdAt,
        ...(idea ? { idea } : {}),
      }
      if (idea) ideas.push(item)
      else items.push(item)
    }
  }
  // Tournament survivors (1–3 a night) lead the proposals so they aren't
  // buried under older proposals.
  const firstProposal = items.findIndex((i) => i.kind === 'proposal')
  items.splice(firstProposal === -1 ? items.length : firstProposal, 0, ...ideas)
  // The newest daily message is pinned ahead of every other notify/proposal;
  // older undismissed ones keep their place.
  if (latestDaily) {
    items.splice(items.indexOf(latestDaily), 1)
    const firstNotify = items.findIndex((i) => i.kind === 'notify' || i.kind === 'proposal')
    items.splice(firstNotify === -1 ? items.length : firstNotify, 0, latestDaily)
  }

  return { items }
}

// Shared triage result — dismiss/accept live in lib/kairos/proposal-accept.ts
// (they apply reactions + constitution dispatch, which is not data-layer work).
export type InboxResolution =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'already_resolved' }
