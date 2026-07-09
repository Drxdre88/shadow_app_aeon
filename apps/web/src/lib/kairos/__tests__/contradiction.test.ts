import { describe, it, expect, vi, beforeEach } from 'vitest'

// DB-mocked runner tests, mirroring introspection.test.ts's failure-trace
// suite. findSimilarBeliefs is mocked directly (its own retrieval logic is
// covered by the data-layer test) so these tests focus purely on the scan
// pass: probe -> candidates -> judge -> grounded findings -> staged proposal.

const selectQueue: unknown[][] = []
let insertedRows: unknown[] | null = null

vi.mock('@/lib/db', () => {
  function makeSelectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => ({
        values: (v: unknown[]) => {
          insertedRows = v
          return Promise.resolve(v)
        },
      })),
    },
  }
})

vi.mock('@/lib/data/memories', () => ({
  findSimilarBeliefs: vi.fn(),
  BELIEF_TYPES: ['reflection', 'fact', 'decision', 'observation', 'note', 'idea'],
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

vi.mock('../cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

const USER_ID = 'user-1'
const DOMINION_ID = '33333333-3333-4333-8333-333333333333'
const PROBE_ID = '11111111-1111-4111-8111-111111111111'
const CANDIDATE_ID = '22222222-2222-4222-8222-222222222222'

const probeRow = {
  id: PROBE_ID,
  title: 'We ship weekly on Fridays',
  bodyMd: 'Release cadence is weekly, every Friday.',
  type: 'decision',
  createdAt: new Date('2026-07-01'),
  confidence: 0.9,
}

const candidateRow = {
  id: CANDIDATE_ID,
  title: 'We ship biweekly now',
  aiTitle: null,
  bodyMd: 'Switched release cadence to every other week.',
  type: 'decision',
  createdAt: new Date('2026-06-01'),
  confidence: 0.8,
}

function queueDominionAndProbes() {
  selectQueue.push([{ id: DOMINION_ID, name: 'AEON', archivedAt: null }]) // dominion lookup
  selectQueue.push([{ n: 0 }]) // alreadyRanToday
  selectQueue.push([probeRow]) // fetchProbes
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  insertedRows = null
})

// Same headroom as introspection-prompt.test.ts's C1 suite: dynamic-import
// heavy tests can exceed the default 5s timeout under full-suite load.
describe('runContradictionScanForDominion', { timeout: 20000 }, () => {
  it('emits one inbound proposal with correct sourceMetadata + contradicts link', async () => {
    const { findSimilarBeliefs } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')

    queueDominionAndProbes()
    selectQueue.push([{ n: 0 }]) // hasPendingProposalFor — no existing proposal

    vi.mocked(findSimilarBeliefs).mockResolvedValueOnce([candidateRow] as never)
    vi.mocked(getProviderForTask).mockResolvedValue({
      provider: {
        ask: vi.fn().mockResolvedValue({
          text: `\`\`\`json\n${JSON.stringify({
            findings: [{ candidateId: CANDIDATE_ID, contradicts: true, winner: 'probe', confidence: 0.85, rationale: 'cadence changed' }],
          })}\n\`\`\``,
        }),
      },
    } as never)

    const { runContradictionScanForDominion } = await import('../contradiction')
    const result = await runContradictionScanForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('created')
    expect(result.proposalsCreated).toBe(1)
    expect(insertedRows).toHaveLength(1)

    const row = insertedRows![0] as {
      type: string
      sourceMetadata: Record<string, unknown>
      links: Array<{ type: string; target: string }>
      tags: string[]
    }
    expect(row.type).toBe('inbound')
    expect(row.sourceMetadata).toMatchObject({
      contradictionCheck: true,
      kind: 'contradiction',
      status: 'pending',
      confidence: 0.85,
      winnerId: PROBE_ID,
      loserId: CANDIDATE_ID,
      citations: [PROBE_ID, CANDIDATE_ID],
    })
    expect(row.links).toContainEqual({ type: 'contradicts', target: CANDIDATE_ID, target_kind: 'memory' })
    expect(row.links).toContainEqual({ type: 'refers_to', target: PROBE_ID, target_kind: 'memory' })
    expect(row.tags).toEqual(['proposal', 'contradiction'])
  })

  it('dedup guard skips a duplicate {winnerId,loserId} pair', async () => {
    const { findSimilarBeliefs } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')

    queueDominionAndProbes()
    selectQueue.push([{ n: 1 }]) // hasPendingProposalFor — already an unresolved proposal for this pair

    vi.mocked(findSimilarBeliefs).mockResolvedValueOnce([candidateRow] as never)
    vi.mocked(getProviderForTask).mockResolvedValue({
      provider: {
        ask: vi.fn().mockResolvedValue({
          text: `\`\`\`json\n${JSON.stringify({
            findings: [{ candidateId: CANDIDATE_ID, contradicts: true, winner: 'probe', confidence: 0.85, rationale: 'cadence changed' }],
          })}\n\`\`\``,
        }),
      },
    } as never)

    const { runContradictionScanForDominion } = await import('../contradiction')
    const result = await runContradictionScanForDominion(USER_ID, DOMINION_ID)

    expect(result.proposalsCreated).toBe(0)
    expect(insertedRows).toBeNull()
  })

  it('no candidates → no proposal, no failure trace', async () => {
    const { findSimilarBeliefs } = await import('@/lib/data/memories')
    const { writeCronFailureTrace } = await import('../cron-trace')

    queueDominionAndProbes()
    vi.mocked(findSimilarBeliefs).mockResolvedValueOnce([])

    const { runContradictionScanForDominion } = await import('../contradiction')
    const result = await runContradictionScanForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('created')
    expect(result.proposalsCreated).toBe(0)
    expect(insertedRows).toBeNull()
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('writes a failure trace on parse failure', async () => {
    const { findSimilarBeliefs } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    const { writeCronFailureTrace } = await import('../cron-trace')

    queueDominionAndProbes()
    vi.mocked(findSimilarBeliefs).mockResolvedValueOnce([candidateRow] as never)
    vi.mocked(getProviderForTask).mockResolvedValue({
      provider: { ask: vi.fn().mockResolvedValue({ text: 'not json at all' }) },
    } as never)

    const { runContradictionScanForDominion } = await import('../contradiction')
    const result = await runContradictionScanForDominion(USER_ID, DOMINION_ID)

    expect(result.proposalsCreated).toBe(0)
    expect(insertedRows).toBeNull()
    expect(writeCronFailureTrace).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ cronName: 'contradiction-scan', reason: 'parse_failed' }),
    )
  })
})
