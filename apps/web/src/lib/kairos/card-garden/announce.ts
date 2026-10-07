import { findCardGardenProposal, type CardGardenProposalRow } from '@/lib/data/card-garden-proposals'
import { announceProposal, sendProposal, type AnnouncedProposal } from '@/lib/kairos/proposal-telegram'
import { renderCardGardenBody } from './render'

// Telegram for card garden proposals: the same gated announce and release as
// goal and card tree proposals (lib/kairos/proposal-telegram*.ts).

export const CARD_GARDEN_HOLD_PREFIX = 'card-garden-hold:'

type Announceable = Pick<CardGardenProposalRow, 'id' | 'title' | 'expiresAt' | 'pick'>

export function cardGardenAnnouncement(row: Announceable): AnnouncedProposal {
  return { id: row.id, title: row.title, body: renderCardGardenBody(row.pick), expiresAt: row.expiresAt, holdPrefix: CARD_GARDEN_HOLD_PREFIX }
}

export async function announceCardGarden(userId: string, row: Announceable, now: Date): Promise<boolean> {
  return announceProposal(userId, cardGardenAnnouncement(row), now)
}

// Gate release: only a still-pending, unexpired, unannounced proposal goes out.
export async function releaseHeldCardGarden(userId: string, proposalId: string, now: Date): Promise<boolean> {
  const row = await findCardGardenProposal(userId, proposalId)
  if (!row || row.status !== 'pending' || row.hasTelegram) return false
  if (!(Date.parse(row.expiresAt) > now.getTime())) return false
  return sendProposal(userId, cardGardenAnnouncement(row), now)
}
