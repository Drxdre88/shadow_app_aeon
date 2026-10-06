import { beforeEach, describe, expect, it, vi } from 'vitest'

// Card trees reuse the goal proposals' gated Telegram path; a held one is
// released only while still pending, unexpired and not yet announced.

const h = vi.hoisted(() => ({ findCardTreeProposal: vi.fn(), sendProposal: vi.fn(async () => true), announceProposal: vi.fn(async () => true) }))
vi.mock('@/lib/data/card-tree-proposals', () => ({ findCardTreeProposal: h.findCardTreeProposal }))
vi.mock('@/lib/kairos/proposal-telegram', () => ({ sendProposal: h.sendProposal, announceProposal: h.announceProposal }))

import { announceCardTree, CARD_TREE_HOLD_PREFIX, releaseHeldCardTree } from '../announce'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const row = {
  id: 'm-1', title: 'Card tree proposal: Beta', status: 'pending', expiresAt: '2026-10-13T12:00:00.000Z', hasTelegram: false,
  tree: { projectId: 'p-1', projectName: 'Beta', goal: 'Ship', rationale: '', cards: [{ key: 'A', name: 'One', description: '', priority: 'medium' as const, labels: [], checklist: [], dependsOn: [] }] },
}

beforeEach(() => vi.clearAllMocks())

describe('card tree announce', () => {
  it('announces through the shared gated proposal path with its own hold key', async () => {
    await announceCardTree('u-1', row, NOW)
    expect(h.announceProposal).toHaveBeenCalledWith('u-1', expect.objectContaining({
      id: 'm-1', title: row.title, expiresAt: row.expiresAt, holdPrefix: CARD_TREE_HOLD_PREFIX, body: expect.stringContaining('1. One'),
    }), NOW)
  })

  it('releases a held tree only while pending, unexpired and unannounced', async () => {
    h.findCardTreeProposal.mockResolvedValueOnce(row)
    expect(await releaseHeldCardTree('u-1', 'm-1', NOW)).toBe(true)
    for (const over of [{ status: 'vetoed' }, { hasTelegram: true }, { expiresAt: '2026-10-01T00:00:00.000Z' }]) {
      h.findCardTreeProposal.mockResolvedValueOnce({ ...row, ...over })
      expect(await releaseHeldCardTree('u-1', 'm-1', NOW)).toBe(false)
    }
    h.findCardTreeProposal.mockResolvedValueOnce(null)
    expect(await releaseHeldCardTree('u-1', 'm-1', NOW)).toBe(false)
    expect(h.sendProposal).toHaveBeenCalledOnce()
  })
})
