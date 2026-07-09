import { describe, it, expect, beforeEach, vi } from 'vitest'

// acceptProposal — the operator gate in propose-not-commit. Pins two branches:
// the original introspection promote-to-belief path (unchanged) and the
// widened contradiction-notice path (supersedes the loser with the WINNING
// belief's id, never the proposal row's own id, and archives the notice
// instead of promoting it). The contradiction branch runs inside a transaction,
// validates the winner exists, and only supersedes a still-live loser.

const selectQueue: unknown[][] = []
const updateQueue: unknown[][] = []
const setCalls: Record<string, unknown>[] = []

vi.mock('@/lib/db', () => {
  function makeSelectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  function makeUpdateChain(returningRows: unknown[]) {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => {
      setCalls.push(patch)
      return chain
    }
    chain.where = () => chain
    chain.returning = () => Promise.resolve(returningRows)
    chain.then = (resolve: (v: unknown) => unknown) => resolve(returningRows)
    return chain
  }
  const update = vi.fn(() => makeUpdateChain(updateQueue.shift() ?? []))
  return {
    db: {
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
      update,
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ update })),
    },
  }
})

import { acceptProposal } from '../memories'

const USER = 'user-1'
const PROPOSAL_ID = 'proposal-1'
const WINNER_ID = 'winner-1'
const LOSER_ID = 'loser-1'

function contradictionProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    userId: USER,
    type: 'inbound',
    links: [],
    sourceMetadata: {
      contradictionCheck: true,
      kind: 'contradiction',
      status: 'pending',
      confidence: 0.8,
      winnerId: WINNER_ID,
      loserId: LOSER_ID,
      rationale: 'cadence changed',
      citations: ['probe-1', 'candidate-1'],
      runId: 'contradiction:dom-1:2026-07-08',
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  updateQueue.length = 0
  setCalls.length = 0
})

describe('acceptProposal — contradiction branch', () => {
  it('supersedes the live loser with winnerId (not the proposal id) and archives the notice', async () => {
    const proposal = contradictionProposal()
    selectQueue.push([proposal])                       // findMemoryById(proposalId)
    selectQueue.push([{ id: WINNER_ID, userId: USER }]) // findMemoryById(winnerId) — winner exists
    updateQueue.push([{ id: LOSER_ID }])               // loser supersede (.returning) — still live
    updateQueue.push([{ ...proposal, sourceMetadata: { ...proposal.sourceMetadata, status: 'resolved' }, archivedAt: new Date() }]) // notice archive

    const result = await acceptProposal(PROPOSAL_ID, USER, { pin: false })

    expect(result?.ok).toBe(true)
    if (!result?.ok) throw new Error('expected ok:true')
    expect(result.memory.archivedAt).toBeInstanceOf(Date)

    // First update (inside txn) supersedes the LOSER with the WINNER's id.
    expect(setCalls[0]).toEqual({
      supersededAt: expect.any(Date),
      supersededById: WINNER_ID,
      updatedAt: expect.any(Date),
    })
    // Second update archives + resolves the notice row.
    expect(setCalls[1]).toMatchObject({ archivedAt: expect.any(Date) })
    expect((setCalls[1].sourceMetadata as Record<string, unknown>).status).toBe('resolved')
  })

  it('does not claim success when the loser is already superseded (stale conflict)', async () => {
    const proposal = contradictionProposal()
    selectQueue.push([proposal])                       // findMemoryById(proposalId)
    selectQueue.push([{ id: WINNER_ID, userId: USER }]) // winner exists
    updateQueue.push([])                               // loser supersede matched 0 rows (already superseded)
    updateQueue.push([{ ...proposal, archivedAt: new Date() }]) // notice still archived (marked stale)

    const result = await acceptProposal(PROPOSAL_ID, USER, { pin: false })

    expect(result).toEqual({ ok: false, reason: 'loser_already_superseded' })
    // Notice is still closed out as stale rather than left dangling.
    expect((setCalls[1].sourceMetadata as Record<string, unknown>).status).toBe('stale')
  })

  it('rejects when the winner memory no longer exists', async () => {
    selectQueue.push([contradictionProposal()]) // findMemoryById(proposalId)
    selectQueue.push([])                          // findMemoryById(winnerId) → gone

    const result = await acceptProposal(PROPOSAL_ID, USER, { pin: false })
    expect(result).toEqual({ ok: false, reason: 'winner_not_found' })
  })

  it('rejects a self-referential pair (winner === loser)', async () => {
    selectQueue.push([contradictionProposal({ loserId: WINNER_ID })])
    const result = await acceptProposal(PROPOSAL_ID, USER, { pin: false })
    expect(result).toEqual({ ok: false, reason: 'invalid_pair' })
  })

  it('rejects a contradiction proposal missing winnerId/loserId', async () => {
    selectQueue.push([{
      id: PROPOSAL_ID,
      userId: USER,
      type: 'inbound',
      links: [],
      sourceMetadata: { contradictionCheck: true, kind: 'contradiction', status: 'pending' },
    }])

    const result = await acceptProposal(PROPOSAL_ID, USER, { pin: false })
    expect(result).toEqual({ ok: false, reason: 'not_a_proposal' })
  })
})

describe('acceptProposal — introspection branch (unchanged)', () => {
  it('promotes a pending introspection proposal into a committed belief', async () => {
    const proposal = {
      id: PROPOSAL_ID,
      userId: USER,
      type: 'inbound',
      links: [{ type: 'refers_to', target: 'mem-1', target_kind: 'memory' }],
      sourceMetadata: { introspection: true, kind: 'reflection', confidence: 0.6, citations: ['mem-1'], runId: 'introspection:dom-1:2026-07-08', status: 'pending' },
    }
    selectQueue.push([proposal]) // findMemoryById
    updateQueue.push([{ ...proposal, type: 'reflection', streamClass: 'reflection' }]) // committed update

    const result = await acceptProposal(PROPOSAL_ID, USER, { pin: false })

    expect(result?.ok).toBe(true)
    if (!result?.ok) throw new Error('expected ok:true')
    expect(setCalls[0]).toMatchObject({ type: 'reflection', streamClass: 'reflection' })
    // Only one update call — the introspection branch never touches a second row
    // unless `supersedes` is passed.
    expect(setCalls).toHaveLength(1)
  })
})
