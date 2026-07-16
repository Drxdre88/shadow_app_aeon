import { getPendingKairosAsk } from '@/lib/data/ask'
import {
  acceptProposal,
  archiveMemory,
  findMemoryById,
  listMemories,
  listTodaysAdvisories,
} from '@/lib/data/memories'

export type KairosInboxUrgency = 'low' | 'normal' | 'high'

// Will slice 2 — every inbox entry carries a discriminated `kind` so the
// panel (and any other surface) can render without sniffing metadata.
export type KairosInboxItem =
  | { kind: 'brief'; id: string; title: string; bodyMd: string; dominionName: string | null; createdAt: Date }
  | { kind: 'ask'; id: string; title: string; createdAt: Date }
  | { kind: 'proposal'; id: string; title: string; summary: string | null; createdAt: Date }
  | { kind: 'notify'; id: string; title: string; summary: string | null; urgency: KairosInboxUrgency; createdAt: Date }

export async function getKairosInbox(userId: string): Promise<{ items: KairosInboxItem[] }> {
  const [briefs, ask, inbound] = await Promise.all([
    listTodaysAdvisories(userId),
    getPendingKairosAsk(userId),
    listMemories(userId, { type: 'inbound' }),
  ])

  // Briefs first (pinned top card), then the pending ask, then inbound triage.
  const items: KairosInboxItem[] = briefs.map((brief) => ({
    kind: 'brief' as const,
    id: brief.id,
    title: brief.title,
    bodyMd: brief.bodyMd,
    dominionName: brief.dominionName,
    createdAt: brief.createdAt,
  }))

  if (ask) items.push({ kind: 'ask', id: ask.id, title: ask.title, createdAt: ask.createdAt })

  for (const memory of inbound) {
    const metadata = (memory.sourceMetadata ?? {}) as Record<string, unknown>
    if (metadata.status !== 'pending') continue
    if (metadata.kairosSpeak === true) {
      const urgency = metadata.urgency
      items.push({
        kind: 'notify',
        id: memory.id,
        title: memory.title,
        summary: memory.summary,
        urgency: urgency === 'low' || urgency === 'high' ? urgency : 'normal',
        createdAt: memory.createdAt,
      })
    } else {
      items.push({
        kind: 'proposal',
        id: memory.id,
        title: memory.title,
        summary: memory.summary,
        createdAt: memory.createdAt,
      })
    }
  }

  return { items }
}

// Shared triage — both the inbox server actions and the Telegram webhook
// resolve items through these, so the two surfaces can never drift.
export type InboxResolution =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'already_resolved' }

export async function dismissInboxMemory(userId: string, memoryId: string): Promise<InboxResolution> {
  const memory = await findMemoryById(memoryId, userId)
  if (!memory || memory.type !== 'inbound') return { ok: false, reason: 'not_found' }

  const metadata = (memory.sourceMetadata ?? {}) as Record<string, unknown>
  // Idempotent: Telegram delivers duplicate updates; a second dismiss must
  // report "already handled" instead of erroring.
  if (memory.archivedAt || metadata.status !== 'pending') return { ok: false, reason: 'already_resolved' }

  const archived = await archiveMemory(memoryId, userId)
  if (!archived) return { ok: false, reason: 'not_found' }
  return { ok: true, id: archived.id }
}

export async function acceptInboxProposal(userId: string, memoryId: string): Promise<InboxResolution> {
  const result = await acceptProposal(memoryId, userId, { pin: false })
  if (!result) return { ok: false, reason: 'not_found' }
  if (!result.ok) return { ok: false, reason: 'already_resolved' }
  return { ok: true, id: result.memory.id }
}
