'use server'

import { requireAuth, requireEditor } from './helpers'
import { cardTreeAvailability, requestCardTree, type CardTreeAvailability, type RequestCardTreeResult } from '@/lib/data/card-tree'
import { requestCardTreeSchema } from '@/lib/data/validators/kairos-card-tree'
import { canUseVorath } from '@/lib/vorath-access'

// Whether the board should offer "Plan a goal" at all: hidden while the switch
// is off or the caller's brain routine is not connected (nothing would draft it).
export async function getCardTreeAvailabilityAction(): Promise<CardTreeAvailability> {
  const userId = await requireAuth()
  if (!canUseVorath(userId)) return { available: false, reason: 'off', message: 'Not available' }
  return cardTreeAvailability(userId)
}

// "Plan a goal with Vorath" on the board: queues a card_tree draft. Nothing is
// created here — the owner approves the drafted tree in the Vorath inbox.
export async function requestCardTreeAction(projectId: string, goal: string): Promise<RequestCardTreeResult | { ok: false; reason: 'invalid'; message: string }> {
  const userId = await requireEditor(projectId)
  if (!canUseVorath(userId)) return { ok: false, reason: 'forbidden', message: 'Not available' }
  const parsed = requestCardTreeSchema.safeParse({ projectId, goal })
  if (!parsed.success) return { ok: false, reason: 'invalid', message: parsed.error.issues[0].message }
  return requestCardTree(userId, parsed.data)
}
