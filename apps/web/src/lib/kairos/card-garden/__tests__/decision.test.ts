import { beforeEach, describe, expect, it, vi } from 'vitest'

// card_garden through the one decision function: Approve re-checks edit
// access, claims once and does exactly one thing; a merge never writes to the
// board; veto and expiry change nothing on the board.

const h = vi.hoisted(() => ({
  findProposalForDecision: vi.fn(),
  recordProposalDecision: vi.fn(async () => true),
  findCardGardenProposal: vi.fn(),
  casCardGardenStatus: vi.fn(),
  expireCardGardens: vi.fn(async () => [] as string[]),
  applyCardGardenDecision: vi.fn(),
  canEditProject: vi.fn(async () => true),
  touchProject: vi.fn(async () => undefined),
  emitActivity: vi.fn(async () => undefined),
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
vi.mock('@/lib/data/card-tree-proposals', () => ({ findCardTreeProposal: vi.fn(), casCardTreeStatus: vi.fn(), expireCardTrees: vi.fn(async () => []) }))
vi.mock('@/lib/data/card-tree', () => ({ createCardTree: vi.fn() }))
vi.mock('@/lib/data/card-garden-proposals', () => ({
  findCardGardenProposal: h.findCardGardenProposal,
  casCardGardenStatus: h.casCardGardenStatus,
  expireCardGardens: h.expireCardGardens,
  applyCardGardenDecision: h.applyCardGardenDecision,
}))
vi.mock('@/lib/data/hangar-access', () => ({ canEditProject: h.canEditProject }))
vi.mock('@/lib/data/projects', () => ({ touchProject: h.touchProject }))
vi.mock('@/lib/data/activity', () => ({ emitActivity: h.emitActivity }))
vi.mock('@/lib/kairos/goals/transitions', () => ({ approveGoal: vi.fn(), vetoGoal: vi.fn(), expireStaleGoals: vi.fn(async () => ({ expired: [], timedOut: [] })) }))
vi.mock('@/lib/kairos/promises/create', () => ({ createKairosPromises: vi.fn() }))
vi.mock('@/lib/kairos/reactions', () => ({ reactOutcome: vi.fn(async () => undefined) }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: vi.fn(async () => undefined) }))

import { decideKairosProposal, isDecidableProposalKind, sweepExpiredProposals } from '@/lib/kairos/proposal-decision'
import type { CardGardenAction } from '../types'

const USER = 'owner-1'
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const NOW = new Date('2026-10-06T12:00:00.000Z')
const EXPIRES = '2026-10-13T12:00:00.000Z'

const pickFor = (action: CardGardenAction) => ({
  isoWeek: '2026-W41', taskId: 't-1', taskName: 'Write docs', projectId: 'p-1', projectName: 'Beta', columnName: 'Live', ageDays: 40,
  action, reason: 'Stale.', mergeWith: action === 'merge' ? { taskId: 't-2', name: 'Docs writing' } : null, parkColumn: 'Cryo', doneColumn: 'Done',
})
const memoryRow = { id: ID, title: 'Card garden: Finish "Write docs"', type: 'inbound', archivedAt: null, sourceMetadata: { kind: 'card_garden', status: 'pending', expiresAt: EXPIRES } }
const rowFor = (action: CardGardenAction, over: Record<string, unknown> = {}) => ({ id: ID, title: memoryRow.title, status: 'pending', expiresAt: EXPIRES, hasTelegram: false, pick: pickFor(action), ...over })
const outcome = (action: CardGardenAction, note: string, wrote: boolean) =>
  ({ ok: true, outcome: { action, note, wrote, taskName: 'Write docs', fromColumnId: 'c-live', toColumnId: note === 'moved' ? 'c-cryo' : note === 'finished' ? 'c-done' : null } })

beforeEach(() => {
  vi.clearAllMocks()
  h.findProposalForDecision.mockResolvedValue(memoryRow)
  h.canEditProject.mockResolvedValue(true)
})

describe('card_garden proposals', () => {
  it('is a decidable kind', () => {
    expect(isDecidableProposalKind('card_garden')).toBe(true)
  })

  it.each([
    ['finish', 'finished', 'completed', 'task:updated'],
    ['park', 'moved', 'moved', 'task:moved'],
    ['kill', 'archived', 'archived', 'task:updated'],
  ] as const)('approve %s: one claimed write, then the board is touched and the activity logged', async (action, note, activity, type) => {
    h.findCardGardenProposal.mockResolvedValue(rowFor(action))
    h.applyCardGardenDecision.mockResolvedValue(outcome(action, note, true))
    const res = await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })
    expect(res).toMatchObject({ ok: true, verdict: 'approve', kind: 'card_garden' })
    expect(h.canEditProject).toHaveBeenCalledWith('p-1', USER)
    expect(h.applyCardGardenDecision).toHaveBeenCalledOnce()
    expect(h.applyCardGardenDecision).toHaveBeenCalledWith(USER, ID, pickFor(action), NOW)
    expect(h.touchProject).toHaveBeenCalledWith('p-1', { type })
    expect(h.emitActivity).toHaveBeenCalledWith('p-1', 'task', 't-1', activity, 'Write docs', expect.objectContaining({ via: 'card_garden' }), USER)
    expect(h.recordProposalDecision).toHaveBeenCalledOnce()
  })

  it('approve merge records the decision but never writes to the board', async () => {
    h.findCardGardenProposal.mockResolvedValue(rowFor('merge'))
    h.applyCardGardenDecision.mockResolvedValue(outcome('merge', 'merge_suggested', false))
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'telegram', now: NOW })).toMatchObject({ ok: true, verdict: 'approve' })
    expect(h.touchProject).not.toHaveBeenCalled()
    expect(h.emitActivity).not.toHaveBeenCalled()
  })

  it('a park on a board with no backlog column is approved as a no-op', async () => {
    h.findCardGardenProposal.mockResolvedValue(rowFor('park'))
    h.applyCardGardenDecision.mockResolvedValue(outcome('park', 'no_backlog_column', false))
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: true })
    expect(h.touchProject).not.toHaveBeenCalled()
  })

  it('refuses an owner who can no longer edit the board, and an agent, without any write or record', async () => {
    h.findCardGardenProposal.mockResolvedValue(rowFor('kill'))
    h.canEditProject.mockResolvedValue(false)
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: false, reason: 'forbidden_actor' })
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'rest-session', origin: { kind: 'agent', via: 'mcp' } as never, now: NOW }))
      .toMatchObject({ ok: false, reason: 'forbidden_actor' })
    expect(h.applyCardGardenDecision).not.toHaveBeenCalled()
    expect(h.recordProposalDecision).not.toHaveBeenCalled()
  })

  it('claims once: a lost claim or a decided row is already decided and writes nothing more', async () => {
    h.findCardGardenProposal.mockResolvedValue(rowFor('kill'))
    h.applyCardGardenDecision.mockResolvedValue({ ok: false, reason: 'already_decided' })
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'telegram', now: NOW })).toMatchObject({ ok: false, reason: 'already_decided' })
    h.findCardGardenProposal.mockResolvedValue(rowFor('kill', { status: 'approved' }))
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: false, reason: 'already_decided' })
    expect(h.applyCardGardenDecision).toHaveBeenCalledOnce()
    expect(h.touchProject).not.toHaveBeenCalled()
    expect(h.recordProposalDecision).not.toHaveBeenCalled()
  })

  it('veto only moves the status; expiry decides nothing and the sweep moves it', async () => {
    h.casCardGardenStatus.mockResolvedValue(true)
    expect(await decideKairosProposal(USER, ID, { verdict: 'veto', reason: 'keep it', via: 'inbox', now: NOW })).toMatchObject({ ok: true, verdict: 'veto' })
    expect(h.casCardGardenStatus).toHaveBeenCalledWith(USER, ID, 'pending', 'vetoed', NOW)
    expect(h.applyCardGardenDecision).not.toHaveBeenCalled()
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: new Date('2026-10-14T00:00:00Z') })).toMatchObject({ ok: false, reason: 'expired' })
    h.expireCardGardens.mockResolvedValue([ID])
    expect(await sweepExpiredProposals(USER, NOW)).toMatchObject({ expired: 1 })
    expect(h.touchProject).not.toHaveBeenCalled()
  })
})
