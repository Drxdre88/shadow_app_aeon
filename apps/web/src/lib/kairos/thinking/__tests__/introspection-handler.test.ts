import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

let insertedRows: Array<Record<string, unknown>> | null = null

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: (v: Array<Record<string, unknown>>) => {
        insertedRows = v
        return { returning: () => Promise.resolve(v.map((_, i) => ({ id: `proposal-${i}` }))) }
      },
    })),
  },
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn(), isJobDone: vi.fn() }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn(), inspectDominion: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
  findMemoryOriginKinds: vi.fn(async () => ['operator']),
}))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
// The gates read the DB; persistIntrospectionProposals stays real (shared write path).
vi.mock('@/lib/kairos/introspection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kairos/introspection')>()),
  alreadyRanToday: vi.fn(),
  gatherIntrospectionContext: vi.fn(),
}))

import { listJobs } from '@/lib/data/thinking-jobs'
import { findDominionsByUser } from '@/lib/data/dominions'
import { captureMemory } from '@/lib/data/memories'
import * as introspection from '@/lib/kairos/introspection'
import {
  INTROSPECTION_SYSTEM_PROMPT,
  buildIntrospectionUserPrompt,
  type IntrospectionContext,
} from '@/lib/kairos/introspection-prompt'
import { introspectionHandler } from '../handlers/introspection'
import { INTROSPECTION_WINDOW_UTC, deadlineOn } from '../deadlines'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM = '22222222-2222-4222-8222-222222222222'
const MEM = '33333333-3333-4333-8333-333333333333'
const JOB_ID = '55555555-5555-4555-8555-555555555555'
const DAY = '2026-10-01'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)

const ctx: IntrospectionContext = {
  dominionId: DOM,
  name: 'AEON',
  vision: 'Fluid board app.',
  cortexBody: 'Momentum on the queue.',
  recentMemories: [{ id: MEM, title: 'Queue first', type: 'reflection', summary: null, createdAt: new Date('2026-09-30T10:00:00Z') }],
}

const answer = (citations: string[]) => JSON.stringify({
  proposals: [{ kind: 'tension', title: 'Drift', body: 'A grounded observation worth surfacing.', citations, confidence: 0.6 }],
})

function jobRow(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: JOB_ID,
    userId: USER,
    kind: 'introspection',
    dominionId: DOM,
    externalKey: `introspection:${DOM}:${DAY}`,
    status: 'claimed',
    input: { system: 's', prompt: 'p', validMemoryIds: [MEM], context: { dominionId: DOM, date: DAY } },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('05:40'),
    deadlineAt: at('06:28'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('05:31'),
    updatedAt: at('05:31'),
    ...overrides,
  }
}

const traces = () => vi.mocked(captureMemory).mock.calls
  .map((c) => c[1])
  .filter((i) => i.streamClass === 'trace')
  .map((i) => i.sourceMetadata as Record<string, unknown>)

beforeEach(() => {
  vi.clearAllMocks()
  insertedRows = null
  delete process.env.KAIROS_RAW_INTROSPECTION
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('05:45'))
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(findDominionsByUser).mockResolvedValue([{ id: DOM, name: 'AEON', archivedAt: null }] as never)
  vi.mocked(introspection.alreadyRanToday).mockResolvedValue(false)
  vi.mocked(introspection.gatherIntrospectionContext).mockResolvedValue(ctx)
  vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'trace' } as never, created: true })
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.KAIROS_RAW_INTROSPECTION
})

describe('introspection handler — plan', () => {
  it('plans nothing outside its window (closes 06:28Z), before any DB read', async () => {
    const opens = deadlineOn(at('00:00'), INTROSPECTION_WINDOW_UTC.notBefore)
    expect(await introspectionHandler.plan(USER, new Date(opens.getTime() - 60_000))).toEqual([])
    expect(await introspectionHandler.plan(USER, at('06:28'))).toEqual([])
    expect(await introspectionHandler.plan(USER, at('07:00'))).toEqual([])
    expect(findDominionsByUser).not.toHaveBeenCalled()
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('plans nothing while raw introspection is retired', async () => {
    process.env.KAIROS_RAW_INTROSPECTION = 'off'
    expect(await introspectionHandler.plan(USER, at('05:45'))).toEqual([])
    expect(findDominionsByUser).not.toHaveBeenCalled()
  })

  it('plans one job per Dominion with exactly the cron prompt, fed ids and a 06:28Z deadline', async () => {
    const now = at('05:45')
    const [spec, ...rest] = await introspectionHandler.plan(USER, now)
    expect(rest).toEqual([])
    expect(spec).toMatchObject({ kind: 'introspection', dominionId: DOM, externalKey: `introspection:${DOM}:${DAY}` })
    expect(spec.input.system).toBe(INTROSPECTION_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildIntrospectionUserPrompt(ctx, DAY))
    expect(spec.input.validMemoryIds).toEqual([MEM])
    expect(spec.input.maxOutputTokens).toBe(8000)
    expect(spec.input.context).toEqual({ dominionId: DOM, date: DAY })
    expect(new Date(now.getTime() + spec.deadlineMinutes * 60_000).toISOString()).toBe('2026-10-01T06:28:00.000Z')
  })

  it('applies the cron gates: planned key, already ran, no context, no recent substrate', async () => {
    vi.mocked(listJobs).mockResolvedValue([jobRow()])
    expect(await introspectionHandler.plan(USER, at('05:45'))).toEqual([])
    vi.mocked(listJobs).mockResolvedValue([])

    vi.mocked(introspection.alreadyRanToday).mockResolvedValueOnce(true)
    expect(await introspectionHandler.plan(USER, at('05:45'))).toEqual([])

    vi.mocked(introspection.gatherIntrospectionContext).mockResolvedValueOnce(null)
    expect(await introspectionHandler.plan(USER, at('05:45'))).toEqual([])

    vi.mocked(introspection.gatherIntrospectionContext).mockResolvedValueOnce({ ...ctx, recentMemories: [] })
    expect(await introspectionHandler.plan(USER, at('05:45'))).toEqual([])
  })
})

describe('introspection handler — apply', () => {
  it('stages grounded proposals through the cron write path and writes its ok trace', async () => {
    const outcome = await introspectionHandler.apply(jobRow(), answer([MEM]), 'routine')
    expect(outcome).toEqual({ ok: true, memoryIds: ['proposal-0'] })
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows![0]).toMatchObject({
      userId: USER,
      dominionId: DOM,
      type: 'inbound',
      streamClass: 'agentic',
      source: 'cron',
      sourceMetadata: {
        introspection: true,
        kind: 'tension',
        citations: [MEM],
        runId: `introspection:${DOM}:${DAY}`,
        status: 'pending',
        origin: { kind: 'kairos', via: 'cron:introspection' },
        thinkingJobId: JOB_ID,
        answeredBy: 'routine',
      },
      links: [{ type: 'refers_to', target: MEM, target_kind: 'memory' }],
    })
    expect(traces()).toEqual([expect.objectContaining({ cronName: 'introspection', outcome: 'ok' })])
  })

  it('zero grounded proposals closes the night: ok with no ids and the cron\'s ungrounded trace', async () => {
    const outcome = await introspectionHandler.apply(jobRow(), answer(['44444444-4444-4444-8444-444444444444']), 'routine')
    expect(outcome).toEqual({ ok: true, memoryIds: [] })
    expect(insertedRows).toBeNull()
    expect(traces()).toEqual([expect.objectContaining({ cronName: 'introspection', reason: 'all_thoughts_ungrounded' })])
  })

  it('rejects stale jobs, already-ran Dominions and unparseable answers without writing', async () => {
    const stale = jobRow({ input: { ...jobRow().input, context: { dominionId: DOM, date: '2026-09-30' } } })
    expect(await introspectionHandler.apply(stale, answer([MEM]), 'routine')).toEqual({ ok: false, reason: 'stale_job: planned for 2026-09-30' })

    vi.mocked(introspection.alreadyRanToday).mockResolvedValueOnce(true)
    expect(await introspectionHandler.apply(jobRow(), answer([MEM]), 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^already_ran/) })

    const garbage = await introspectionHandler.apply(jobRow(), 'I think the queue is drifting.', 'routine')
    expect(garbage).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed: /) })
    const badShape = await introspectionHandler.apply(jobRow(), JSON.stringify({ proposals: [{ kind: 'tension', confidence: 3 }] }), 'routine')
    expect(badShape).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed: proposals\.0\./) })

    expect(await introspectionHandler.apply(jobRow({ input: { system: 's', prompt: 'p' } }), answer([MEM]), 'routine'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^bad_job/) })
    expect(insertedRows).toBeNull()
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('fallback defers to the introspection cron', async () => {
    expect(await introspectionHandler.fallback(jobRow())).toEqual({ ok: false, reason: 'deferred to the 06:30 UTC introspection cron' })
  })
})
