import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

// Real contradiction.ts over a queued db mock (same idiom as
// contradiction.test.ts): every db.select resolves to the next queued rows,
// so apply runs the cron's own staging + pair dedup end to end.

const selectQueue: unknown[][] = []
let insertedRows: Array<Record<string, unknown>> | null = null

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
        values: (v: Array<Record<string, unknown>>) => {
          insertedRows = v
          return { returning: () => Promise.resolve(v.map((_, i) => ({ id: `proposal-${i}` }))) }
        },
      })),
    },
  }
})
vi.mock('@/lib/data/memories', () => ({
  findSimilarBeliefs: vi.fn(),
  BELIEF_TYPES: ['reflection', 'fact', 'decision', 'observation', 'note', 'idea'],
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn(), isJobDone: vi.fn() }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn() }))
vi.mock('@/lib/kairos/embeddings', () => ({ embeddingsEnabled: vi.fn() }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))

import { db } from '@/lib/db'
import { findDominionsByUser } from '@/lib/data/dominions'
import { findSimilarBeliefs } from '@/lib/data/memories'
import { listJobs } from '@/lib/data/thinking-jobs'
import { getProviderForTask } from '@/lib/ai/route-task'
import {
  CONTRADICTION_BATCH_SYSTEM_PROMPT,
  CONTRADICTION_SYSTEM_PROMPT,
  buildContradictionBatchUserPrompt,
  buildContradictionUserPrompt,
  filterGroundedBatchFindings,
  type ContradictionCandidate,
  type ContradictionProbe,
} from '@/lib/kairos/contradiction-prompt'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { embeddingsEnabled } from '@/lib/kairos/embeddings'
import { contradictionHandler } from '../handlers/contradiction'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM = '22222222-2222-4222-8222-222222222222'
const P1 = 'aaaaaaaa-1111-4111-8111-111111111111'
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222'
const P3 = 'cccccccc-3333-4333-8333-333333333333'
const CA = 'dddddddd-4444-4444-8444-444444444444'
const CB = 'eeeeeeee-5555-4555-8555-555555555555'
const DAY = '2026-10-01'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)

const belief = (id: string, title: string): ContradictionProbe => ({
  id, title, bodyMd: `${title}.`, type: 'decision', createdAt: new Date('2026-09-28'), confidence: 0.8,
})
const neighbour = (id: string, title: string): ContradictionCandidate => ({ ...belief(id, title), aiTitle: null })

const finding = (candidateId: string, winner: 'probe' | 'candidate' = 'probe') => ({
  candidateId, contradicts: true, winner, confidence: 0.8, rationale: 'cadence changed',
})
const answer = (probes: unknown[]) => `\`\`\`json\n${JSON.stringify({ probes })}\n\`\`\``

function jobRow(probes: Array<{ probeId: string; title: string; candidates: Array<{ id: string; title: string }> }>, date = DAY): ThinkingJobRow {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    userId: USER,
    kind: 'contradiction',
    dominionId: DOM,
    externalKey: `contradiction:${DOM}:${date}`,
    status: 'claimed',
    input: { system: CONTRADICTION_BATCH_SYSTEM_PROMPT, prompt: 'p', context: { dominionId: DOM, date, probes } },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('03:45'),
    deadlineAt: at('04:58'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('03:31'),
    updatedAt: at('03:31'),
  }
}

const twoProbes = [
  { probeId: P1, title: 'Ship weekly', candidates: [{ id: CA, title: 'Ship biweekly' }] },
  { probeId: P2, title: 'Freeze Fridays', candidates: [{ id: CB, title: 'Deploy Fridays' }] },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('03:45'))
  selectQueue.length = 0
  insertedRows = null
  vi.mocked(embeddingsEnabled).mockReturnValue(true)
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(findDominionsByUser).mockResolvedValue([{ id: DOM, name: 'AEON', archivedAt: null }] as never)
})

afterEach(() => { vi.useRealTimers() })

describe('contradiction batch prompt', () => {
  it('keeps the per-probe judging rules and reuses the per-probe payload under a probe header', () => {
    for (const rule of ['CONTRADICTORY claim', 'Only flag genuine contradictions', 'Default policy: more recent wins', '`rationale`: ≤280 chars']) {
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain(rule)
      expect(CONTRADICTION_BATCH_SYSTEM_PROMPT).toContain(rule)
    }
    expect(CONTRADICTION_BATCH_SYSTEM_PROMPT).toContain('"probeId"')
    const items = [
      { probe: belief(P1, 'Ship weekly'), candidates: [neighbour(CA, 'Ship biweekly')] },
      { probe: belief(P2, 'Freeze Fridays'), candidates: [neighbour(CB, 'Deploy Fridays')] },
    ]
    expect(buildContradictionBatchUserPrompt(items)).toBe([
      `### Probe 1 — probeId ${P1}\n${buildContradictionUserPrompt(items[0].probe, items[0].candidates)}`,
      `### Probe 2 — probeId ${P2}\n${buildContradictionUserPrompt(items[1].probe, items[1].candidates)}`,
    ].join('\n\n'))
  })

  it('grounds each finding against its own probe\'s candidates only', () => {
    const grounded = filterGroundedBatchFindings(
      {
        probes: [
          // A unique-prefix probe id resolves; CB belongs to probe 2, not probe 1.
          { probeId: P1.slice(0, 8), findings: [finding(CA), finding(CB)] },
          { probeId: P2, findings: [finding(CA)] },
          { probeId: 'ffffffff-0000-4000-8000-000000000000', findings: [finding(CA)] },
        ],
      },
      new Map([[P1, new Set([CA])], [P2, new Set([CB])]]),
    )
    expect(grounded).toEqual([{ probeId: P1, findings: [finding(CA)] }])
  })
})

describe('contradiction handler — plan', () => {
  it.each(['03:20', '04:58', '05:30'])('plans nothing at %s (window closed) without a DB read', async (hhmm) => {
    expect(await contradictionHandler.plan(USER, at(hhmm))).toEqual([])
    expect(findDominionsByUser).not.toHaveBeenCalled()
    expect(db.select).not.toHaveBeenCalled()
  })

  it('plans nothing when embeddings are disabled', async () => {
    vi.mocked(embeddingsEnabled).mockReturnValue(false)
    expect(await contradictionHandler.plan(USER, at('03:45'))).toEqual([])
    expect(findDominionsByUser).not.toHaveBeenCalled()
  })

  it('batches every probe with neighbours into one job per Dominion with a 04:58Z deadline', async () => {
    const p1 = belief(P1, 'Ship weekly')
    const p3 = belief(P3, 'Lonely belief')
    const ca = neighbour(CA, 'Ship biweekly')
    selectQueue.push([{ n: 0 }]) // alreadyRanToday
    selectQueue.push([p1, p3]) // fetchProbes
    vi.mocked(findSimilarBeliefs).mockImplementation(async (id) => (id === P1 ? [ca] : []) as never)

    const now = at('03:45')
    const [spec, ...rest] = await contradictionHandler.plan(USER, now)
    expect(rest).toEqual([])
    expect(spec).toMatchObject({ kind: 'contradiction', dominionId: DOM, externalKey: `contradiction:${DOM}:${DAY}`, input: { maxOutputTokens: 8000 } })
    expect(spec.input.system).toBe(CONTRADICTION_BATCH_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildContradictionBatchUserPrompt([{ probe: p1, candidates: [ca] }]))
    expect(spec.input.validMemoryIds).toEqual([P1, CA])
    expect(spec.input.context).toEqual({
      dominionId: DOM, date: DAY, probes: [{ probeId: P1, title: 'Ship weekly', candidates: [{ id: CA, title: 'Ship biweekly' }] }],
    })
    expect(new Date(now.getTime() + spec.deadlineMinutes * 60_000).toISOString()).toBe('2026-10-01T04:58:00.000Z')
  })

  it('skips an existing key, a Dominion that already ran, and one with no judgeable probe', async () => {
    vi.mocked(listJobs).mockResolvedValueOnce([{ externalKey: `contradiction:${DOM}:${DAY}` }] as never)
    expect(await contradictionHandler.plan(USER, at('03:45'))).toEqual([])
    expect(db.select).not.toHaveBeenCalled()

    selectQueue.push([{ n: 1 }]) // alreadyRanToday
    expect(await contradictionHandler.plan(USER, at('03:45'))).toEqual([])

    selectQueue.push([{ n: 0 }], [belief(P1, 'Ship weekly')])
    vi.mocked(findSimilarBeliefs).mockResolvedValue([])
    expect(await contradictionHandler.plan(USER, at('03:45'))).toEqual([])
  })

  it('plans once per day: any contradiction job today skips the probe search for every Dominion', async () => {
    vi.mocked(listJobs).mockResolvedValueOnce([{ externalKey: `contradiction:other-dom:${DAY}` }] as never)
    expect(await contradictionHandler.plan(USER, at('04:10'))).toEqual([])
    expect(findSimilarBeliefs).not.toHaveBeenCalled()
  })
})

describe('contradiction handler — apply', () => {
  it('stages grounded findings through the cron write path with queue provenance', async () => {
    selectQueue.push([{ n: 0 }]) // alreadyRanToday
    selectQueue.push([{ n: 0 }], [{ n: 0 }]) // hasPendingProposalFor × 2
    const text = answer([
      { probeId: P1, findings: [finding(CA), finding(CB)] }, // CB is probe 2's — dropped
      { probeId: P2, findings: [finding(CB, 'candidate')] },
    ])
    const res = await contradictionHandler.apply(jobRow(twoProbes), text, 'routine')

    expect(res).toEqual({ ok: true, memoryIds: ['proposal-0', 'proposal-1'] })
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows![0]).toMatchObject({
      dominionId: DOM,
      type: 'inbound',
      title: 'Contradiction: "Ship weekly" vs "Ship biweekly"',
      sourceMetadata: {
        contradictionCheck: true, kind: 'contradiction', status: 'pending', winnerId: P1, loserId: CA,
        citations: [P1, CA], runId: `contradiction:${DOM}:${DAY}`,
        thinkingJobId: '66666666-6666-4666-8666-666666666666', answeredBy: 'routine',
      },
      links: [{ type: 'contradicts', target: CA, target_kind: 'memory' }, { type: 'refers_to', target: P1, target_kind: 'memory' }],
    })
    expect(insertedRows![1].sourceMetadata).toMatchObject({ winnerId: CB, loserId: P2 })
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'contradiction-scan', dominionId: DOM })
    expect(getProviderForTask).not.toHaveBeenCalled()
  })

  it('dedups the same pair across probes and against a pending proposal', async () => {
    // P1 and P2 are each other's neighbour: one conflict seen from both sides.
    const mirrored = [
      { probeId: P1, title: 'Ship weekly', candidates: [{ id: P2, title: 'Ship biweekly' }] },
      { probeId: P2, title: 'Ship biweekly', candidates: [{ id: P1, title: 'Ship weekly' }] },
    ]
    selectQueue.push([{ n: 0 }], [{ n: 0 }]) // alreadyRanToday, hasPendingProposalFor (first side only)
    const text = answer([{ probeId: P1, findings: [finding(P2)] }, { probeId: P2, findings: [finding(P1, 'candidate')] }])
    expect(await contradictionHandler.apply(jobRow(mirrored), text, 'routine')).toEqual({ ok: true, memoryIds: ['proposal-0'] })
    expect(insertedRows).toHaveLength(1)

    insertedRows = null
    selectQueue.push([{ n: 0 }], [{ n: 1 }]) // alreadyRanToday, pending proposal exists
    expect(await contradictionHandler.apply(jobRow(twoProbes), answer([{ probeId: P1, findings: [finding(CA)] }]), 'routine'))
      .toEqual({ ok: true, memoryIds: [] })
    expect(insertedRows).toBeNull()
  })

  it('a clean scan is ok with no memories and the clean-scan trace', async () => {
    selectQueue.push([{ n: 0 }])
    expect(await contradictionHandler.apply(jobRow(twoProbes), '{"probes":[]}', 'routine')).toEqual({ ok: true, memoryIds: [] })
    expect(insertedRows).toBeNull()
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'contradiction-scan', dominionId: DOM })
  })

  it('rejects stale jobs, a Dominion that already ran, and garbage or wrongly shaped answers', async () => {
    expect(await contradictionHandler.apply(jobRow(twoProbes, '2026-09-30'), '{"probes":[]}', 'routine'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^stale_job/) })

    selectQueue.push([{ n: 1 }])
    expect(await contradictionHandler.apply(jobRow(twoProbes), '{"probes":[]}', 'routine'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^already_ran/) })

    selectQueue.push([{ n: 0 }])
    expect(await contradictionHandler.apply(jobRow(twoProbes), 'No contradictions here.', 'routine'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed: /) })
    selectQueue.push([{ n: 0 }])
    expect(await contradictionHandler.apply(jobRow(twoProbes), '{"findings":[]}', 'routine'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed: probes/) })
    expect(insertedRows).toBeNull()
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('fallback defers to the 05:00 cron', async () => {
    expect(await contradictionHandler.fallback(jobRow(twoProbes))).toEqual({ ok: false, reason: 'deferred to the 05:00 UTC contradiction-scan cron' })
  })
})
