import { beforeEach, describe, expect, it, vi } from 'vitest'

// card_tree through the one decision function: Approve is the only path that
// creates cards (once), refuses agents and owners who lost edit access, and a
// failed Chronos layout never undoes the approval. Veto creates nothing.

const h = vi.hoisted(() => ({
  findProposalForDecision: vi.fn(),
  recordProposalDecision: vi.fn(async () => true),
  findCardTreeProposal: vi.fn(),
  casCardTreeStatus: vi.fn(),
  expireCardTrees: vi.fn(async () => [] as string[]),
  createCardTree: vi.fn(),
  solveProjectSchedule: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/proposal-decision', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/proposal-decision')>()
  return {
    readDecision: actual.readDecision,
    readTelegramRef: actual.readTelegramRef,
    findProposalForDecision: h.findProposalForDecision,
    recordProposalDecision: h.recordProposalDecision,
    listExpiredTelegramProposals: vi.fn(async () => []),
    markTelegramClosed: vi.fn(async () => undefined),
  }
})
vi.mock('@/lib/data/goals', () => ({ casGoalUpdate: vi.fn() }))
vi.mock('@/lib/data/voice-samples', () => ({ VOICE_SAMPLE_KIND: 'voice_sample', casVoiceSampleStatus: vi.fn(), expireVoiceSamples: vi.fn(async () => []) }))
vi.mock('@/lib/data/card-tree-proposals', () => ({
  findCardTreeProposal: h.findCardTreeProposal,
  casCardTreeStatus: h.casCardTreeStatus,
  expireCardTrees: h.expireCardTrees,
}))
vi.mock('@/lib/data/card-tree', () => ({ createCardTree: h.createCardTree }))
vi.mock('@/lib/data/card-garden-proposals', () => ({ expireCardGardens: vi.fn(async () => []) }))
vi.mock('@/lib/schedule/solve-project', () => ({ solveProjectSchedule: h.solveProjectSchedule }))
vi.mock('@/lib/kairos/goals/transitions', () => ({ approveGoal: vi.fn(), vetoGoal: vi.fn(), expireStaleGoals: vi.fn(async () => ({ expired: [], timedOut: [] })) }))
vi.mock('@/lib/kairos/promises/create', () => ({ createKairosPromises: vi.fn() }))
vi.mock('@/lib/kairos/reactions', () => ({ reactOutcome: vi.fn(async () => undefined) }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: vi.fn(async () => undefined) }))

import { decideKairosProposal, isDecidableProposalKind, sweepExpiredProposals } from '@/lib/kairos/proposal-decision'

const USER = 'owner-1'
const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOW = new Date('2026-10-06T12:00:00.000Z')
const TREE = {
  projectId: 'p-1', projectName: 'Beta', goal: 'Ship', rationale: '',
  cards: [{ key: 'A', name: 'One', description: '', priority: 'medium', labels: [], checklist: [], dependsOn: [] }],
}
const memoryRow = { id: ID, title: 'Card tree proposal: Beta', type: 'inbound', archivedAt: null, sourceMetadata: { kind: 'card_tree', status: 'pending', expiresAt: '2026-10-13T12:00:00.000Z' } }
const proposalRow = { id: ID, title: memoryRow.title, status: 'pending', expiresAt: '2026-10-13T12:00:00.000Z', hasTelegram: false, tree: TREE }

beforeEach(() => {
  vi.clearAllMocks()
  h.findProposalForDecision.mockResolvedValue(memoryRow)
  h.findCardTreeProposal.mockResolvedValue(proposalRow)
  h.createCardTree.mockResolvedValue({ ok: true, taskIds: ['t-1'] })
  h.solveProjectSchedule.mockResolvedValue({})
})

describe('card_tree proposals', () => {
  it('is a decidable kind', () => {
    expect(isDecidableProposalKind('card_tree')).toBe(true)
  })

  it('approve creates the tree once, then lays it out with Chronos', async () => {
    const res = await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })
    expect(res).toMatchObject({ ok: true, verdict: 'approve', kind: 'card_tree' })
    expect(h.createCardTree).toHaveBeenCalledOnce()
    expect(h.createCardTree).toHaveBeenCalledWith(USER, ID, TREE, NOW)
    expect(h.solveProjectSchedule).toHaveBeenCalledWith('p-1', { canWrite: true, now: NOW })
    expect(h.recordProposalDecision).toHaveBeenCalledOnce()
  })

  it('a second approve is already decided and creates nothing', async () => {
    h.findProposalForDecision.mockResolvedValue({ ...memoryRow, sourceMetadata: { ...memoryRow.sourceMetadata, status: 'approved', decision: { verdict: 'approve', via: 'inbox', at: NOW.toISOString(), reason: null, awaitingReason: false } } })
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'telegram', now: NOW })).toMatchObject({ ok: false, reason: 'already_decided' })
    h.findProposalForDecision.mockResolvedValue(memoryRow)
    h.findCardTreeProposal.mockResolvedValue({ ...proposalRow, status: 'approved' })
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'telegram', now: NOW })).toMatchObject({ ok: false, reason: 'already_decided' })
    h.findCardTreeProposal.mockResolvedValue(proposalRow)
    h.createCardTree.mockResolvedValue({ ok: false, reason: 'already_decided' })
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'telegram', now: NOW })).toMatchObject({ ok: false, reason: 'already_decided' })
    expect(h.solveProjectSchedule).not.toHaveBeenCalled()
  })

  it('refuses an agent, and an owner who can no longer edit the board, without recording a decision', async () => {
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'rest-session', origin: { kind: 'agent', via: 'mcp' } as never, now: NOW }))
      .toMatchObject({ ok: false, reason: 'forbidden_actor' })
    expect(h.createCardTree).not.toHaveBeenCalled()
    h.createCardTree.mockResolvedValue({ ok: false, reason: 'forbidden' })
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: false, reason: 'forbidden_actor' })
    expect(h.recordProposalDecision).not.toHaveBeenCalled()
    expect(h.solveProjectSchedule).not.toHaveBeenCalled()
  })

  it('a Chronos failure never fails the approval', async () => {
    h.solveProjectSchedule.mockRejectedValue(new Error('solver exploded'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: true })
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Chronos layout failed'), 'solver exploded')
    err.mockRestore()
  })

  it('veto marks the proposal vetoed and creates nothing', async () => {
    h.casCardTreeStatus.mockResolvedValue(true)
    expect(await decideKairosProposal(USER, ID, { verdict: 'veto', reason: 'not now', via: 'inbox', now: NOW })).toMatchObject({ ok: true, verdict: 'veto' })
    expect(h.casCardTreeStatus).toHaveBeenCalledWith(USER, ID, 'pending', 'vetoed', NOW)
    expect(h.createCardTree).not.toHaveBeenCalled()
    h.casCardTreeStatus.mockResolvedValue(false)
    expect(await decideKairosProposal(USER, ID, { verdict: 'veto', via: 'inbox', now: NOW })).toMatchObject({ ok: false, reason: 'already_decided' })
  })

  it('past its 7 days it expires: no decision, and the sweep moves it', async () => {
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: new Date('2026-10-14T00:00:00Z') })).toMatchObject({ ok: false, reason: 'expired' })
    expect(h.createCardTree).not.toHaveBeenCalled()
    h.expireCardTrees.mockResolvedValue([ID])
    expect(await sweepExpiredProposals(USER, NOW)).toMatchObject({ expired: 1 })
  })
})
