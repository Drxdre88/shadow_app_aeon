import { beforeEach, describe, expect, it, vi } from 'vitest'

// card_tree handler: on-demand only (plans nothing), grounds the draft and
// stores ONE pending proposal for 7 days, then announces it. Never creates cards.

const h = vi.hoisted(() => ({
  insertCardTreeProposal: vi.fn(),
  writeCronSuccessTrace: vi.fn(async () => undefined),
  announceCardTree: vi.fn(async () => true),
}))
vi.mock('@/lib/data/card-tree-proposals', () => ({ insertCardTreeProposal: h.insertCardTreeProposal }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: h.writeCronSuccessTrace }))
vi.mock('@/lib/kairos/card-tree/announce', () => ({ announceCardTree: h.announceCardTree }))

import { cardTreeHandler } from '../handlers/card-tree'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

const USER = 'user-1'
const context = { v: 1, projectId: 'p-1', projectName: 'Beta', goal: 'Ship sign-up', labels: ['Frontend'], openCards: [] }

function job(ctx: unknown = context): ThinkingJobRow {
  return {
    id: 'job-1', userId: USER, kind: 'card_tree', dominionId: null, externalKey: 'card_tree:p-1:abc', status: 'claimed',
    input: { system: 's', prompt: 'p', context: ctx as Record<string, unknown> }, output: null, claimedBy: 'routine', claimToken: 't',
    claimedAt: new Date(), deadlineAt: new Date(), completedAt: null, attempts: 1, error: null, createdAt: new Date(), updatedAt: new Date(),
  }
}

const reply = (cards: unknown[]) => '```json\n' + JSON.stringify({ rationale: 'Because.', cards }) + '\n```'

beforeEach(() => {
  vi.clearAllMocks()
  h.insertCardTreeProposal.mockResolvedValue({ id: 'prop-1', written: true })
})

describe('card_tree handler', () => {
  it('plans nothing on its own and has no paid fallback', async () => {
    expect(await cardTreeHandler.plan(USER, new Date())).toEqual([])
    expect(await cardTreeHandler.fallback(job())).toMatchObject({ ok: false })
  })

  it('stores a pending 7-day proposal with only known labels and keys, then announces it', async () => {
    const before = Date.now()
    const res = await cardTreeHandler.apply(job(), reply([
      { key: 'A', name: 'Form', labels: ['Frontend', 'Nope'] },
      { key: 'B', name: 'API', dependsOn: ['A', 'Q'] },
    ]), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['prop-1'], output: { proposalId: 'prop-1', cards: 2 } })
    expect(h.insertCardTreeProposal).toHaveBeenCalledOnce()
    const [user, input] = h.insertCardTreeProposal.mock.calls[0]
    expect(user).toBe(USER)
    expect(input.externalKey).toBe('card_tree_proposal:job-1')
    expect(input.tree).toMatchObject({ projectId: 'p-1', goal: 'Ship sign-up' })
    expect(input.tree.cards[0].labels).toEqual(['Frontend'])
    expect(input.tree.cards[1].dependsOn).toEqual(['A'])
    const ttl = Date.parse(input.expiresAt) - before
    expect(ttl).toBeGreaterThanOrEqual(7 * 86_400_000 - 1000)
    expect(ttl).toBeLessThanOrEqual(7 * 86_400_000 + 5000)
    expect(h.announceCardTree).toHaveBeenCalledWith(USER, expect.objectContaining({ id: 'prop-1', expiresAt: input.expiresAt }), expect.any(Date))
  })

  it('caps the stored tree at 12 cards', async () => {
    const cards = Array.from({ length: 15 }, (_, i) => ({ key: `K${i}`, name: `Card ${i}` }))
    await cardTreeHandler.apply(job(), reply(cards), 'routine')
    expect(h.insertCardTreeProposal.mock.calls[0][1].tree.cards).toHaveLength(12)
  })

  it('skips a looping tree without storing anything', async () => {
    const res = await cardTreeHandler.apply(job(), reply([
      { key: 'A', name: 'One', dependsOn: ['B'] },
      { key: 'B', name: 'Two', dependsOn: ['A'] },
    ]), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: [], output: { skipped: 'cycle' } })
    expect(h.insertCardTreeProposal).not.toHaveBeenCalled()
    expect(h.announceCardTree).not.toHaveBeenCalled()
  })

  it('fails on a bad context or an unparseable reply', async () => {
    expect(await cardTreeHandler.apply(job({}), reply([]), 'routine')).toMatchObject({ ok: false })
    expect(await cardTreeHandler.apply(job(), 'no json', 'routine')).toMatchObject({ ok: false, reason: expect.stringContaining('parse_failed') })
  })

  it('a repeat apply does not announce twice, and a Telegram failure never fails the job', async () => {
    h.insertCardTreeProposal.mockResolvedValueOnce({ id: 'prop-1', written: false })
    await cardTreeHandler.apply(job(), reply([{ key: 'A', name: 'One' }]), 'routine')
    expect(h.announceCardTree).not.toHaveBeenCalled()
    h.announceCardTree.mockRejectedValueOnce(new Error('telegram down'))
    expect(await cardTreeHandler.apply(job(), reply([{ key: 'A', name: 'One' }]), 'routine')).toMatchObject({ ok: true })
  })
})
