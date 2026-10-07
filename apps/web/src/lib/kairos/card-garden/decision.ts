import { applyCardGardenDecision, casCardGardenStatus, expireCardGardens, findCardGardenProposal, type CardGardenOutcome } from '@/lib/data/card-garden-proposals'
import { emitActivity, type ActivityAction } from '@/lib/data/activity'
import { canEditProject } from '@/lib/data/hangar-access'
import { touchProject } from '@/lib/data/projects'
import type { ProposalKindHandler } from '@/lib/kairos/proposal-decision'

// The card_garden kind of the one decision function (proposal-decision.ts).
// Approve re-checks that the deciding owner can still edit the board, then
// one transaction claims the proposal and does exactly one thing to the card:
// finish → done (into the Done column when the board has one), park → the
// first backlog-like column (none: approved, nothing moved), kill → archived,
// merge → nothing (the owner fuses the cards on the board, app-only). Veto
// and expiry only move the proposal's status.

const BOARD_EVENT: Record<'finished' | 'moved' | 'archived', { activity: ActivityAction; type: string }> = {
  finished: { activity: 'completed', type: 'task:updated' },
  moved: { activity: 'moved', type: 'task:moved' },
  archived: { activity: 'archived', type: 'task:updated' },
}

async function announceWrite(userId: string, projectId: string, taskId: string, outcome: CardGardenOutcome): Promise<void> {
  if (!outcome.wrote || !(outcome.note in BOARD_EVENT)) return
  const event = BOARD_EVENT[outcome.note as keyof typeof BOARD_EVENT]
  await touchProject(projectId, { type: event.type })
  const meta = outcome.note === 'archived'
    ? { via: 'card_garden' }
    : { via: 'card_garden', fromColumnId: outcome.fromColumnId, toColumnId: outcome.toColumnId }
  emitActivity(projectId, 'task', taskId, event.activity, outcome.taskName, meta, userId).catch((err) => {
    console.error('[kairos:card-garden] activity event failed:', err instanceof Error ? err.message : String(err))
  })
}

export const cardGardenKind: ProposalKindHandler = {
  async approve({ userId, id, now }) {
    const row = await findCardGardenProposal(userId, id)
    if (!row) return { ok: false, reason: 'not_found' }
    if (row.status !== 'pending') return { ok: false, reason: 'already_decided' }
    if (!(await canEditProject(row.pick.projectId, userId))) return { ok: false, reason: 'forbidden_actor' }
    const res = await applyCardGardenDecision(userId, id, row.pick, now)
    if (!res.ok) return { ok: false, reason: 'already_decided' }
    await announceWrite(userId, row.pick.projectId, row.pick.taskId, res.outcome)
    return { ok: true }
  },
  async veto({ userId, id, now }) {
    return (await casCardGardenStatus(userId, id, 'pending', 'vetoed', now)) ? { ok: true } : { ok: false, reason: 'already_decided' }
  },
  async expire(userId, now) {
    return expireCardGardens(userId, now)
  },
}
