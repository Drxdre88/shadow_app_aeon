'use server'

import { requireVorath } from '@/lib/actions/helpers'
import { readKairosOwnerModel } from '@/lib/data/kairos-owner-model'
import { ownerItemCorrectionSchema, type OwnerItemKind } from '@/lib/data/validators/kairos-owner-model'
import { cardItems } from '@/lib/kairos/owner-model/card'
import { correctOwnerItem } from '@/lib/kairos/owner-model/correct'
import { ownerModelMode } from '@/lib/kairos/owner-model/flag'
import { isLongRunning } from '@/lib/kairos/owner-model/status'

// Owner-only "what I think you're carrying" controls for the web session. The
// Telegram operator chat is the other owner path; agents (MCP / REST bearer)
// only read the model.

export interface OwnerCardItem {
  id: string
  seq: number
  kind: OwnerItemKind
  candidate: boolean
  text: string
  firstSeenAt: string
  expiresAt: string | null
  longRunning: boolean
}

export type OwnerCardData = { enabled: false } | { enabled: true; items: OwnerCardItem[] }

export async function getKairosOwnerCard(): Promise<OwnerCardData> {
  const userId = await requireVorath()
  if (ownerModelMode() !== 'on') return { enabled: false }
  const now = new Date()
  const items = cardItems(await readKairosOwnerModel(userId), now).map((i) => ({
    id: i.id,
    seq: i.seq,
    kind: i.kind,
    candidate: i.status === 'candidate',
    text: i.text,
    firstSeenAt: i.firstSeenAt,
    expiresAt: i.expiresAt ?? null,
    longRunning: isLongRunning(i, now),
  }))
  return { enabled: true, items }
}

export async function correctKairosOwnerItem(itemId: string, action: 'still' | 'over' | 'wrong' | 'text', text?: string) {
  const userId = await requireVorath()
  if (ownerModelMode() !== 'on') return { ok: false as const, reason: 'disabled' as const }
  const input = ownerItemCorrectionSchema.parse({ itemId, action, ...(text !== undefined ? { text } : {}) })
  const res = await correctOwnerItem(userId, { itemId: input.itemId }, input.action, {
    via: 'session',
    ...(input.text ? { text: input.text } : {}),
  })
  return res.ok ? { ok: true as const, label: res.label } : { ok: false as const, reason: res.reason }
}
