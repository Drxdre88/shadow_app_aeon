'use server'

import { requireEditor } from './helpers'
import { requestCardTree, type RequestCardTreeResult } from '@/lib/data/card-tree'
import { requestCardTreeSchema } from '@/lib/data/validators/kairos-card-tree'

// "Plan a goal with Vorath" on the board: queues a card_tree draft. Nothing is
// created here — the owner approves the drafted tree in the Vorath inbox.
export async function requestCardTreeAction(projectId: string, goal: string): Promise<RequestCardTreeResult | { ok: false; reason: 'invalid'; message: string }> {
  const userId = await requireEditor(projectId)
  const parsed = requestCardTreeSchema.safeParse({ projectId, goal })
  if (!parsed.success) return { ok: false, reason: 'invalid', message: parsed.error.issues[0].message }
  return requestCardTree(userId, parsed.data)
}
