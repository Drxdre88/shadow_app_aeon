import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memory-candidates', () => ({
  listPendingProposalCandidates: vi.fn(),
  findProposalSupports: vi.fn(),
  updatePendingProposal: vi.fn(),
}))

import {
  findProposalSupports,
  listPendingProposalCandidates,
  updatePendingProposal,
  type ProposalCandidateRow,
  type SupportRow,
} from '@/lib/data/memory-candidates'
import { BackUpStep, summariseSupport } from '../steps/back-up'
import type { EngineRunContext, MemoryOpInput } from '../types'

const USER = 'user-1'
const NOW = new Date('2026-10-01T01:30:00.000Z')
const PROPOSAL = 'prop-1'

function makeCtx(dryRun = false): EngineRunContext & { ops: MemoryOpInput[] } {
  const ops: MemoryOpInput[] = []
  return {
    userId: USER,
    runId: 'run-1',
    now: NOW,
    dryRun,
    ops,
    changes: {
      runId: 'run-1',
      record: (op) => { ops.push(op) },
      pending: () => ops,
      flush: async () => ops.length,
    },
  }
}

function candidate(overrides: Partial<ProposalCandidateRow> = {}): ProposalCandidateRow {
  return {
    id: PROPOSAL,
    title: 'Operator prefers small PRs',
    createdAt: new Date('2026-09-25T02:00:00.000Z'),
    streamClass: 'agentic',
    confidence: 0.45,
    sourceMetadata: { introspection: true, kind: 'pattern', status: 'pending', citations: ['c1'] },
    hasEmbedding: true,
    ...overrides,
  }
}

function support(id: string, at: string, overrides: Partial<SupportRow> = {}): SupportRow {
  return { id, source: 'claude', createdAt: new Date(at), sourceMetadata: {}, links: [], similarity: 0.85, ...overrides }
}

// An operator-origin support (unlabelled 'manual' row → inferred operator).
const OPERATOR: Partial<SupportRow> = { source: 'manual' }

// Live runs: ops travel with the write (4th arg) so they share its transaction.
function liveOps(): MemoryOpInput[] {
  return vi.mocked(updatePendingProposal).mock.calls.flatMap((c) => [...(c[3]?.ops ?? [])])
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(updatePendingProposal).mockResolvedValue(true)
  vi.mocked(findProposalSupports).mockResolvedValue([])
})

describe('summariseSupport — independence rules', () => {
  it('counts independent rows and their distinct UTC days', () => {
    expect(summariseSupport(PROPOSAL, [
      support('a', '2026-09-26T23:59:00Z'),
      support('b', '2026-09-27T00:01:00Z'),
      support('c', '2026-09-27T10:00:00Z'),
    ])).toEqual({ independentSupports: 3, distinctDays: 2, anchoredSupports: 0 })
  })

  it("excludes Kairos's own cron/system writes but keeps Hangar missions and board pages", () => {
    expect(summariseSupport(PROPOSAL, [
      support('cron', '2026-09-26T10:00:00Z', { source: 'cron' }),
      support('sys', '2026-09-26T10:00:00Z', { source: 'system', sourceMetadata: { kind: 'digest' } }),
      support('mission', '2026-09-26T10:00:00Z', { source: 'system', sourceMetadata: { kind: 'hangar_mission' } }),
      support('day', '2026-09-27T10:00:00Z', { source: 'cron', sourceMetadata: { kind: 'board_day' } }),
      support('week', '2026-09-28T10:00:00Z', { source: 'cron', sourceMetadata: { kind: 'board_week' } }),
    ])).toEqual({ independentSupports: 3, distinctDays: 3, anchoredSupports: 3 })
  })

  it('collapses one session to a single support dated by its earliest row', () => {
    const session = { session: { sessionId: 's-1' } }
    expect(summariseSupport(PROPOSAL, [
      support('a', '2026-09-27T10:00:00Z', { sourceMetadata: session }),
      support('b', '2026-09-26T10:00:00Z', { sourceMetadata: session }),
      support('c', '2026-09-28T10:00:00Z', { sourceMetadata: session }),
    ])).toEqual({ independentSupports: 1, distinctDays: 1, anchoredSupports: 0 })
  })

  it('counts a collapsed session as anchored when any of its rows is', () => {
    const session = { session: { sessionId: 's-1' } }
    expect(summariseSupport(PROPOSAL, [
      support('a', '2026-09-27T10:00:00Z', { sourceMetadata: session }),
      support('b', '2026-09-26T10:00:00Z', { sourceMetadata: { ...session, origin: { kind: 'operator', via: 'ui' } } }),
      support('c', '2026-09-28T10:00:00Z', { sourceMetadata: { session: { sessionId: 's-2' } } }),
    ])).toEqual({ independentSupports: 2, distinctDays: 2, anchoredSupports: 1 })
  })

  it('reads the stored origin before inferring: a labelled agent board_day page is not anchored', () => {
    expect(summariseSupport(PROPOSAL, [
      support('spoof', '2026-09-26T10:00:00Z', { source: 'manual', sourceMetadata: { kind: 'board_day', origin: { kind: 'agent', via: 'rest' } } }),
      support('op', '2026-09-27T10:00:00Z', { source: 'claude', sourceMetadata: { origin: { kind: 'operator', via: 'telegram' } } }),
    ])).toEqual({ independentSupports: 2, distinctDays: 2, anchoredSupports: 1 })
  })

  it('excludes rows citing the proposal via links or citations', () => {
    expect(summariseSupport(PROPOSAL, [
      support('a', '2026-09-26T10:00:00Z', { links: [{ type: 'refers_to', target: PROPOSAL }] }),
      support('b', '2026-09-27T10:00:00Z', { sourceMetadata: { citations: [PROPOSAL] } }),
      support('c', '2026-09-28T10:00:00Z'),
    ])).toEqual({ independentSupports: 1, distinctDays: 1, anchoredSupports: 0 })
  })
})

describe('BackUpStep', () => {
  it('only asks for pending introspection candidates, capped per run', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([])
    await new BackUpStep({ cap: 7 }).run(makeCtx())
    expect(listPendingProposalCandidates).toHaveBeenCalledWith(USER, 7)
  })

  it('promotes with ≥2 independent supports on ≥2 UTC days and logs before/after', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate()])
    vi.mocked(findProposalSupports).mockResolvedValue([
      support('a', '2026-09-26T10:00:00Z', OPERATOR),
      support('b', '2026-09-27T10:00:00Z'),
    ])
    const ctx = makeCtx()

    const result = await new BackUpStep().run(ctx)

    expect(findProposalSupports).toHaveBeenCalledWith(USER, PROPOSAL, candidate().createdAt, expect.closeTo(0.2, 6))
    expect(result).toMatchObject({ step: 'backup', examined: 1, changed: 1, opsWritten: 1 })
    // Live: nothing buffered — the op rides in the write's own transaction.
    expect(ctx.ops).toEqual([])
    expect(updatePendingProposal).toHaveBeenCalledWith(USER, PROPOSAL, {
      sourceMetadata: expect.objectContaining({
        status: 'promoted',
        promotedAt: NOW.toISOString(),
        engine: { support: { independentSupports: 2, distinctDays: 2, anchoredSupports: 1 }, promotedAt: NOW.toISOString() },
        citations: ['c1'],
      }),
      streamClass: 'idea',
      confidence: 0.6,
      updatedAt: NOW,
    }, {
      runId: 'run-1',
      ops: [expect.objectContaining({
        memoryId: PROPOSAL,
        step: 'backup',
        op: 'promote',
        before: { status: 'pending', streamClass: 'agentic', confidence: 0.45 },
        after: { status: 'promoted', streamClass: 'idea', confidence: 0.6 },
      })],
    })
  })

  it('does not promote two supports on the same day; records progress without an op', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate()])
    vi.mocked(findProposalSupports).mockResolvedValue([
      support('a', '2026-09-26T10:00:00Z'),
      support('b', '2026-09-26T18:00:00Z'),
    ])
    const ctx = makeCtx()

    await new BackUpStep().run(ctx)

    expect(ctx.ops).toEqual([])
    expect(updatePendingProposal).toHaveBeenCalledWith(USER, PROPOSAL, {
      sourceMetadata: expect.objectContaining({ status: 'pending', engine: { support: { independentSupports: 2, distinctDays: 1, anchoredSupports: 0 } } }),
    })
  })

  it('does not promote a proposal backed only by agent-session summaries (P2.5 anchor)', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate()])
    vi.mocked(findProposalSupports).mockResolvedValue([
      support('a', '2026-09-26T10:00:00Z', { sourceMetadata: { session: { sessionId: 's-1' } } }),
      support('b', '2026-09-27T10:00:00Z', { source: 'codex', sourceMetadata: { session: { sessionId: 's-2' } } }),
      support('c', '2026-09-28T10:00:00Z', { source: 'hook', sourceMetadata: { origin: { kind: 'agent', via: 'mcp' } } }),
    ])

    await new BackUpStep().run(makeCtx())

    expect(liveOps()).toEqual([])
    expect(updatePendingProposal).toHaveBeenCalledWith(USER, PROPOSAL, {
      sourceMetadata: expect.objectContaining({
        status: 'pending',
        engine: { support: { independentSupports: 3, distinctDays: 3, anchoredSupports: 0 } },
      }),
    })
  })

  it.each([
    ['a board_day page', { source: 'cron', sourceMetadata: { kind: 'board_day' } }],
    ['an operator reflection', { source: 'claude', sourceMetadata: { origin: { kind: 'operator', via: 'ui' } } }],
  ] as const)('promotes once %s anchors the agent supports', async (_label, anchor) => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate()])
    vi.mocked(findProposalSupports).mockResolvedValue([
      support('a', '2026-09-26T10:00:00Z', { sourceMetadata: { session: { sessionId: 's-1' } } }),
      support('b', '2026-09-27T10:00:00Z', anchor),
    ])

    await new BackUpStep().run(makeCtx())

    expect(liveOps().map((o) => o.op)).toEqual(['promote'])
  })

  it('refreshes a pre-P2.5 recorded support that lacks anchoredSupports', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate({
      sourceMetadata: { introspection: true, status: 'pending', engine: { support: { independentSupports: 0, distinctDays: 0 } } },
    })])
    await new BackUpStep().run(makeCtx())
    expect(updatePendingProposal).toHaveBeenCalledWith(USER, PROPOSAL, {
      sourceMetadata: expect.objectContaining({ engine: { support: { independentSupports: 0, distinctDays: 0, anchoredSupports: 0 } } }),
    })
  })

  it('skips the write when the recorded support is unchanged', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate({
      sourceMetadata: { introspection: true, status: 'pending', engine: { support: { independentSupports: 0, distinctDays: 0, anchoredSupports: 0 } } },
    })])
    const result = await new BackUpStep().run(makeCtx())
    expect(updatePendingProposal).not.toHaveBeenCalled()
    expect(result.changed).toBe(0)
  })

  it('decays a candidate older than 21 days without enough support', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate({ createdAt: new Date('2026-09-08T00:00:00Z') })])
    vi.mocked(findProposalSupports).mockResolvedValue([support('a', '2026-09-26T10:00:00Z')])
    const ctx = makeCtx()

    await new BackUpStep().run(ctx)

    expect(liveOps()).toEqual([expect.objectContaining({
      op: 'decay',
      before: { status: 'pending', archivedAt: null },
      after: { status: 'decayed', archivedAt: NOW.toISOString() },
    })])
    expect(updatePendingProposal).toHaveBeenCalledWith(USER, PROPOSAL, expect.objectContaining({
      sourceMetadata: expect.objectContaining({
        status: 'decayed',
        engine: expect.objectContaining({ decayedAt: NOW.toISOString() }),
      }),
      archivedAt: NOW,
    }), expect.objectContaining({ runId: 'run-1' }))
  })

  it('reports a write whose op insert failed (rolled back) and keeps going', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([
      candidate({ id: 'bad', createdAt: new Date('2026-09-01T00:00:00Z') }),
      candidate({ id: 'good', createdAt: new Date('2026-09-02T00:00:00Z') }),
    ])
    vi.mocked(updatePendingProposal)
      .mockRejectedValueOnce(new Error('memory_ops insert failed'))
      .mockResolvedValueOnce(true)

    const result = await new BackUpStep().run(makeCtx())

    expect(result).toMatchObject({ examined: 2, changed: 1, opsWritten: 1, errors: ['bad: memory_ops insert failed'] })
    expect(result.notes).toContain('failed=1')
  })

  it('stops before the next candidate once the deadline has passed', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([
      candidate({ id: 'a', createdAt: new Date('2026-09-01T00:00:00Z') }),
      candidate({ id: 'b', createdAt: new Date('2026-09-02T00:00:00Z') }),
    ])
    let deadline = Date.now() + 60_000
    vi.mocked(updatePendingProposal).mockImplementation(async () => { deadline = 0; return true })
    const ctx = { ...makeCtx(), get deadline() { return deadline } }

    const result = await new BackUpStep().run(ctx)

    expect(updatePendingProposal).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ examined: 1, changed: 1, outOfTime: true })
    expect(result.notes).toContain('out of time after 1/2')
  })

  it('never searches supports for a candidate without an embedding (still ages it)', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate({ hasEmbedding: false, createdAt: new Date('2026-09-01T00:00:00Z') })])
    const ctx = makeCtx()
    await new BackUpStep().run(ctx)
    expect(findProposalSupports).not.toHaveBeenCalled()
    expect(liveOps().map((o) => o.op)).toEqual(['decay'])
  })

  it('dryRun records the ops but writes nothing', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([
      candidate(),
      candidate({ id: 'old', createdAt: new Date('2026-09-01T00:00:00Z'), hasEmbedding: false }),
    ])
    vi.mocked(findProposalSupports).mockResolvedValue([
      support('a', '2026-09-26T10:00:00Z', OPERATOR),
      support('b', '2026-09-27T10:00:00Z'),
    ])
    const ctx = makeCtx(true)

    const result = await new BackUpStep().run(ctx)

    expect(ctx.ops.map((o) => o.op)).toEqual(['promote', 'decay'])
    expect(result.changed).toBe(2)
    expect(updatePendingProposal).not.toHaveBeenCalled()
  })

  it('does not log a promote the pending guard rejected (operator acted mid-run)', async () => {
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([candidate()])
    vi.mocked(findProposalSupports).mockResolvedValue([
      support('a', '2026-09-26T10:00:00Z', OPERATOR),
      support('b', '2026-09-27T10:00:00Z'),
    ])
    vi.mocked(updatePendingProposal).mockResolvedValue(false)
    const ctx = makeCtx()

    const result = await new BackUpStep().run(ctx)

    expect(ctx.ops).toEqual([])
    expect(result.changed).toBe(0)
  })

  it('does not re-promote a vetoed promotion or re-decay a vetoed decay', async () => {
    const veto = (op: string) => ({ introspection: true, status: 'pending', engine: { veto: { op } } })
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([
      candidate({ sourceMetadata: veto('promote') }),
      candidate({ id: 'old', createdAt: new Date('2026-09-01T00:00:00Z'), sourceMetadata: veto('decay') }),
    ])
    vi.mocked(findProposalSupports).mockResolvedValue([
      support('a', '2026-09-26T10:00:00Z', OPERATOR),
      support('b', '2026-09-27T10:00:00Z'),
    ])
    const ctx = makeCtx()

    await new BackUpStep().run(ctx)

    // The vetoed-decay one still has enough support, so it may promote.
    expect(liveOps().map((o) => [o.memoryId, o.op])).toEqual([['old', 'promote']])
  })

  it('honours every slot of the per-op vetoes map (a decay veto does not erase a promote veto)', async () => {
    const at = { opId: 'op-0', at: '2026-09-30T00:00:00Z' }
    vi.mocked(listPendingProposalCandidates).mockResolvedValue([
      candidate({ sourceMetadata: { introspection: true, status: 'pending', engine: { vetoes: { promote: at } } } }),
      candidate({
        id: 'old',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        sourceMetadata: { introspection: true, status: 'pending', engine: { vetoes: { promote: at, decay: at } } },
      }),
    ])
    vi.mocked(findProposalSupports).mockResolvedValue([
      support('a', '2026-09-26T10:00:00Z', OPERATOR),
      support('b', '2026-09-27T10:00:00Z'),
    ])
    const ctx = makeCtx()

    await new BackUpStep().run(ctx)

    expect(liveOps()).toEqual([])
    expect(ctx.ops).toEqual([])
  })
})
