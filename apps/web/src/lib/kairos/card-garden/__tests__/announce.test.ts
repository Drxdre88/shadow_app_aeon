import { beforeEach, describe, expect, it, vi } from 'vitest'

// Card garden proposals reuse the shared gated Telegram path; a held one is
// released only while still pending, unexpired and not yet announced.

const h = vi.hoisted(() => ({ findCardGardenProposal: vi.fn(), sendProposal: vi.fn(async () => true), announceProposal: vi.fn(async () => true) }))
vi.mock('@/lib/data/card-garden-proposals', () => ({ findCardGardenProposal: h.findCardGardenProposal }))
vi.mock('@/lib/kairos/proposal-telegram', () => ({ sendProposal: h.sendProposal, announceProposal: h.announceProposal }))

import { announceCardGarden, CARD_GARDEN_HOLD_PREFIX, releaseHeldCardGarden } from '../announce'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const row = {
  id: 'm-1', title: 'Card garden: Kill "Old spike"', status: 'pending', expiresAt: '2026-10-13T12:00:00.000Z', hasTelegram: false,
  pick: {
    isoWeek: '2026-W41', taskId: 't-1', taskName: 'Old spike', projectId: 'p-1', projectName: 'Beta', columnName: 'Live', ageDays: 60,
    action: 'kill' as const, reason: 'Nobody touched it in two months.', mergeWith: null, parkColumn: null, doneColumn: null,
  },
}

beforeEach(() => vi.clearAllMocks())

describe('card garden announce', () => {
  it('announces through the shared gated proposal path with its own hold key', async () => {
    await announceCardGarden('u-1', row, NOW)
    expect(h.announceProposal).toHaveBeenCalledWith('u-1', expect.objectContaining({
      id: 'm-1', title: row.title, expiresAt: row.expiresAt, holdPrefix: CARD_GARDEN_HOLD_PREFIX, body: expect.stringContaining('Approve to archive it'),
    }), NOW)
  })

  it('releases a held proposal only while pending, unexpired and unannounced', async () => {
    h.findCardGardenProposal.mockResolvedValueOnce(row)
    expect(await releaseHeldCardGarden('u-1', 'm-1', NOW)).toBe(true)
    for (const over of [{ status: 'approved' }, { hasTelegram: true }, { expiresAt: '2026-10-01T00:00:00.000Z' }]) {
      h.findCardGardenProposal.mockResolvedValueOnce({ ...row, ...over })
      expect(await releaseHeldCardGarden('u-1', 'm-1', NOW)).toBe(false)
    }
    h.findCardGardenProposal.mockResolvedValueOnce(null)
    expect(await releaseHeldCardGarden('u-1', 'm-1', NOW)).toBe(false)
    expect(h.sendProposal).toHaveBeenCalledOnce()
  })
})
