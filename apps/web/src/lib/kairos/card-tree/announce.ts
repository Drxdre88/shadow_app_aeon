import { findCardTreeProposal, type CardTreeProposalRow } from '@/lib/data/card-tree-proposals'
import { announceProposal, sendProposal, type AnnouncedProposal } from '@/lib/kairos/proposal-telegram'
import { renderCardTreeBody } from './render'

// Telegram for card tree proposals: the same gated announce and release as
// goal proposals (lib/kairos/proposal-telegram*.ts), with the card list as body.

export const CARD_TREE_HOLD_PREFIX = 'card-tree-hold:'

export function cardTreeAnnouncement(row: Pick<CardTreeProposalRow, 'id' | 'title' | 'expiresAt' | 'tree'>): AnnouncedProposal {
  return { id: row.id, title: row.title, body: renderCardTreeBody(row.tree), expiresAt: row.expiresAt, holdPrefix: CARD_TREE_HOLD_PREFIX }
}

export async function announceCardTree(userId: string, row: Pick<CardTreeProposalRow, 'id' | 'title' | 'expiresAt' | 'tree'>, now: Date): Promise<boolean> {
  return announceProposal(userId, cardTreeAnnouncement(row), now)
}

// Gate release: only a still-pending, unexpired, unannounced card tree goes out.
export async function releaseHeldCardTree(userId: string, proposalId: string, now: Date): Promise<boolean> {
  const row = await findCardTreeProposal(userId, proposalId)
  if (!row || row.status !== 'pending' || row.hasTelegram) return false
  if (!(Date.parse(row.expiresAt) > now.getTime())) return false
  return sendProposal(userId, cardTreeAnnouncement(row), now)
}
