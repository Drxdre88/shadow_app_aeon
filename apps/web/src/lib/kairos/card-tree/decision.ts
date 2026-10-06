import { createCardTree } from '@/lib/data/card-tree'
import { casCardTreeStatus, expireCardTrees, findCardTreeProposal } from '@/lib/data/card-tree-proposals'
import type { ProposalKindHandler } from '@/lib/kairos/proposal-decision'

// The card_tree kind of the one decision function (proposal-decision.ts).
// Approve is the ONLY path that turns a drafted tree into cards: it re-checks
// that the deciding owner can still edit the board, then createCardTree claims
// the proposal and writes every card and dependency in one transaction.
// Chronos then lays the new cards out, best-effort: a failed solve never
// undoes the cards. Veto and expiry only move the proposal's status.

async function layOut(projectId: string, now: Date): Promise<void> {
  try {
    const { solveProjectSchedule } = await import('@/lib/schedule/solve-project')
    await solveProjectSchedule(projectId, { canWrite: true, now })
  } catch (err) {
    console.error('[kairos:card-tree] cards created but the Chronos layout failed:', err instanceof Error ? err.message : String(err))
  }
}

export const cardTreeKind: ProposalKindHandler = {
  async approve({ userId, id, now }) {
    const row = await findCardTreeProposal(userId, id)
    if (!row) return { ok: false, reason: 'not_found' }
    if (row.status !== 'pending') return { ok: false, reason: 'already_decided' }
    const res = await createCardTree(userId, id, row.tree, now)
    if (!res.ok) return { ok: false, reason: res.reason === 'forbidden' ? 'forbidden_actor' : 'already_decided' }
    await layOut(row.tree.projectId, now)
    return { ok: true }
  },
  async veto({ userId, id, now }) {
    return (await casCardTreeStatus(userId, id, 'pending', 'vetoed', now)) ? { ok: true } : { ok: false, reason: 'already_decided' }
  },
  async expire(userId, now) {
    return expireCardTrees(userId, now)
  },
}
