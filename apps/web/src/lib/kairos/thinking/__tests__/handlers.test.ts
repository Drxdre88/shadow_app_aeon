import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({
  listJobs: vi.fn(),
  countCortexRowsSince: vi.fn(),
  listDominionsWithArchetypesSince: vi.fn(),
}))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn() }))
vi.mock('@/lib/kairos/aether', () => ({
  alreadyRanToday: vi.fn(),
  fetchAetherInputs: vi.fn(),
  persistAether: vi.fn(),
}))
vi.mock('@/lib/kairos/cortex', () => ({
  alreadyRanToday: vi.fn(),
  gatherCortexContext: vi.fn(),
  persistCortex: vi.fn(),
}))

import { countCortexRowsSince, listDominionsWithArchetypesSince, listJobs } from '@/lib/data/thinking-jobs'
import { findDominionsByUser } from '@/lib/data/dominions'
import * as aether from '@/lib/kairos/aether'
import * as cortex from '@/lib/kairos/cortex'
import { AETHER_SYSTEM_PROMPT, buildAetherUserPrompt } from '@/lib/kairos/aether-prompt'
import { CORTEX_SYSTEM_PROMPT, buildCortexUserPrompt, type CortexContext } from '@/lib/kairos/cortex-prompt'
import { aetherHandler } from '../handlers/aether'
import { cortexHandler } from '../handlers/cortex'
import { getThinkingHandlers } from '../registry'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM = '22222222-2222-4222-8222-222222222222'
const ARCH = '33333333-3333-4333-8333-333333333333'
const REFL = '44444444-4444-4444-8444-444444444444'
const DAY = '2026-10-01'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)

function ctx(overrides: Partial<CortexContext> = {}): CortexContext {
  return {
    dominionId: DOM,
    name: 'AEON',
    vision: 'Fluid board app.',
    missionLong: null,
    objectives: [],
    boardTasks: [{ name: 'ship queue', status: 'open', priority: 'high', projectName: 'P' }],
    reflections: [{ id: REFL, title: 'Queue first', summary: null, createdAt: new Date('2026-09-30T10:00:00Z') }],
    archetypes: [{ id: ARCH, title: 'Brain build-out', summary: null, themes: [] }],
    prior: null,
    ...overrides,
  }
}

function jobRow(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    userId: USER,
    kind: 'cortex',
    dominionId: DOM,
    externalKey: `cortex:${DOM}:${DAY}`,
    status: 'claimed',
    input: { system: 's', prompt: 'p' },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('02:45'),
    deadlineAt: at('02:58'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('02:41'),
    updatedAt: at('02:41'),
    ...overrides,
  }
}

const aetherInputs = {
  cortexSnapshots: [{
    id: ARCH, dominionId: DOM, dominionName: 'AEON', dominionColor: null, createdAt: at('02:50'),
    visionAnchor: 'x', currentState: [], driftSignals: [],
  }],
  topReflections: [{ id: REFL, dominionId: DOM, dominionName: 'AEON', title: 'Queue first', summary: null, createdAt: at('01:00') }],
  archetypes: [],
  prior: null,
  todaySoFar: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('02:50'))
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(countCortexRowsSince).mockResolvedValue(0)
  vi.mocked(listDominionsWithArchetypesSince).mockResolvedValue(new Set([DOM]))
  vi.mocked(findDominionsByUser).mockResolvedValue([{ id: DOM, name: 'AEON', archivedAt: null }] as never)
  vi.mocked(cortex.alreadyRanToday).mockResolvedValue(false)
  vi.mocked(cortex.gatherCortexContext).mockResolvedValue(ctx())
  vi.mocked(aether.alreadyRanToday).mockResolvedValue(false)
  vi.mocked(aether.fetchAetherInputs).mockResolvedValue(aetherInputs as never)
})

afterEach(() => { vi.useRealTimers() })

describe('registry', () => {
  it('registers the aether and cortex handlers', () => {
    expect(getThinkingHandlers().map((h) => h.kind)).toEqual(expect.arrayContaining(['aether', 'cortex', 'concept']))
  })
})

describe('cortex handler — plan', () => {
  it('plans one job per Dominion with exactly the cron prompt, fed archetype ids and a 02:58Z deadline', async () => {
    const now = at('02:40')
    const [spec, ...rest] = await cortexHandler.plan(USER, now)
    expect(rest).toEqual([])
    expect(spec).toMatchObject({ kind: 'cortex', dominionId: DOM, externalKey: `cortex:${DOM}:${DAY}` })
    expect(spec.input.system).toBe(CORTEX_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildCortexUserPrompt(ctx(), DAY))
    expect(spec.input.validMemoryIds).toEqual([ARCH])
    expect(new Date(now.getTime() + spec.deadlineMinutes * 60_000).toISOString()).toBe('2026-10-01T02:58:00.000Z')
  })

  it('waits for tonight\'s archetypes before planning anything', async () => {
    vi.mocked(listDominionsWithArchetypesSince).mockResolvedValue(new Set())
    expect(await cortexHandler.plan(USER, at('02:40'))).toEqual([])
    expect(cortex.gatherCortexContext).not.toHaveBeenCalled()
  })

  it('an active Dominion without its own archetype today is deferred (never anchors on yesterday)', async () => {
    vi.mocked(listDominionsWithArchetypesSince).mockResolvedValue(new Set(['other-dominion']))
    expect(await cortexHandler.plan(USER, at('02:40'))).toEqual([])
  })

  it('skips already planned keys, already-ran Dominions, and a closed window', async () => {
    vi.mocked(listJobs).mockResolvedValue([jobRow()])
    expect(await cortexHandler.plan(USER, at('02:40'))).toEqual([])
    vi.mocked(listJobs).mockResolvedValue([])
    vi.mocked(cortex.alreadyRanToday).mockResolvedValue(true)
    expect(await cortexHandler.plan(USER, at('02:40'))).toEqual([])
    expect(await cortexHandler.plan(USER, at('02:58'))).toEqual([])
  })
})

describe('cortex handler — apply', () => {
  const planned = async () => {
    const [spec] = await cortexHandler.plan(USER, at('02:40'))
    return jobRow({ input: spec.input })
  }
  const answer = JSON.stringify({
    visionAnchor: 'A fluid board app becoming a thinking partner.',
    currentState: ['Queue lands tonight'],
    activeThreads: [{ id: ARCH, title: 'Brain', pulse: 'high', lastAdvance: 'queue' }, { id: 'invented', title: 'X', pulse: 'low', lastAdvance: 'y' }],
  })

  it('strictly parses, grounds thread ids against the fed archetypes and persists with provenance', async () => {
    vi.mocked(cortex.persistCortex).mockResolvedValue({ cortexMemoryId: 'mem-c', archivedPrior: 1 })
    const job = await planned()
    const out = await cortexHandler.apply(job, '```json\n' + answer + '\n```', 'routine')
    expect(out).toEqual({ ok: true, memoryIds: ['mem-c'] })
    const [uid, rctx, payload, runId, date, extra] = vi.mocked(cortex.persistCortex).mock.calls[0]
    expect(uid).toBe(USER)
    expect(rctx).toMatchObject({ dominionId: DOM, name: 'AEON' })
    expect(rctx.reflections[0].createdAt).toBeInstanceOf(Date)
    expect(payload.activeThreads.map((t) => t.id)).toEqual([ARCH, undefined])
    expect(runId).toBe(`cortex:routine:${DOM}:${DAY}`)
    expect(date).toBe(DAY)
    expect(extra).toEqual({ thinkingJobId: job.id, answeredBy: 'routine' })
  })

  it('rejects malformed output without persisting (no repair round-trip)', async () => {
    const out = await cortexHandler.apply(await planned(), '{"visionAnchor":"short"}', 'routine')
    expect(out.ok).toBe(false)
    expect(!out.ok && out.reason).toMatch(/^parse_failed: /)
    expect(cortex.persistCortex).not.toHaveBeenCalled()
  })

  it('refuses when the cron already wrote today\'s cortex', async () => {
    const job = await planned()
    vi.mocked(cortex.alreadyRanToday).mockResolvedValue(true)
    const out = await cortexHandler.apply(job, answer, 'routine')
    expect(out).toMatchObject({ ok: false })
    expect(cortex.persistCortex).not.toHaveBeenCalled()
  })

  it('fallback defers to the cron', async () => {
    expect(await cortexHandler.fallback(jobRow())).toMatchObject({ ok: false })
  })
})

describe('aether handler — plan (lazy prerequisites)', () => {
  it('waits while any cortex job for today is open', async () => {
    vi.mocked(listJobs).mockResolvedValue([jobRow({ status: 'queued' })])
    expect(await aetherHandler.plan(USER, at('02:50'))).toEqual([])
  })

  it('treats an open cortex job past its deadline (not yet swept) as settled', async () => {
    vi.mocked(listJobs).mockResolvedValue([jobRow({ status: 'claimed', deadlineAt: at('02:58') })])
    const [spec] = await aetherHandler.plan(USER, at('03:00'))
    expect(spec).toMatchObject({ kind: 'aether', externalKey: `aether:${DAY}` })
  })

  it('waits when no cortex work settled yet (no jobs, no rows, before 02:58)', async () => {
    expect(await aetherHandler.plan(USER, at('02:50'))).toEqual([])
    expect(aether.fetchAetherInputs).not.toHaveBeenCalled()
  })

  it.each([
    ['cortex jobs are done/expired', () => vi.mocked(listJobs).mockResolvedValue([jobRow({ status: 'done' }), jobRow({ status: 'expired' })]), '02:50'],
    ['today\'s cortex rows exist', () => vi.mocked(countCortexRowsSince).mockResolvedValue(2), '02:50'],
    ['the cortex deadline passed', () => {}, '03:00'],
  ])('plans once %s — exact cron prompt, fed ids, 03:13Z deadline', async (_label, arrange, hhmm) => {
    arrange()
    const now = at(hhmm)
    const [spec] = await aetherHandler.plan(USER, now)
    expect(spec).toMatchObject({ kind: 'aether', dominionId: null, externalKey: `aether:${DAY}` })
    expect(spec.input.system).toBe(AETHER_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildAetherUserPrompt({ userId: USER, today: DAY, ...aetherInputs } as never))
    expect(spec.input.validMemoryIds?.sort()).toEqual([ARCH, REFL].sort())
    expect(new Date(now.getTime() + spec.deadlineMinutes * 60_000).toISOString()).toBe('2026-10-01T03:13:00.000Z')
  })

  it('does not plan after its deadline, when already planned, or when aether already ran', async () => {
    vi.mocked(countCortexRowsSince).mockResolvedValue(1)
    expect(await aetherHandler.plan(USER, at('03:13'))).toEqual([])
    vi.mocked(listJobs).mockResolvedValue([jobRow({ kind: 'aether', externalKey: `aether:${DAY}`, status: 'failed' })])
    expect(await aetherHandler.plan(USER, at('02:50'))).toEqual([])
    vi.mocked(listJobs).mockResolvedValue([])
    vi.mocked(aether.alreadyRanToday).mockResolvedValue(true)
    expect(await aetherHandler.plan(USER, at('02:50'))).toEqual([])
  })
})

describe('aether handler — apply', () => {
  const job = () => jobRow({
    kind: 'aether',
    dominionId: null,
    externalKey: `aether:${DAY}`,
    input: { system: 's', prompt: 'p', validMemoryIds: [ARCH, REFL], context: { date: DAY } },
  })
  const thought = (id: string, cites: string[]) => ({
    id, title: 'Queue', insight: 'The queue moves thinking to Max.', salience: 0.7, kind: 'conclusion',
    sourceMemoryIds: cites, ageDays: 0,
  })

  it('grounds citations to the fed ids, mints ids server-side and persists as the cron would', async () => {
    vi.mocked(aether.persistAether).mockResolvedValue({ aetherMemoryId: 'mem-a', archivedPrior: 1 })
    const text = JSON.stringify({
      generatedAt: `${DAY}T02:55:00Z`,
      coreNarrative: 'Kairos is moving its thinking onto the routine.',
      thoughts: [thought('t1', [REFL, 'not-fed']), thought('t2', ['not-fed'])],
      tensions: [],
      shifts: [],
    })
    const out = await aetherHandler.apply(job(), text, 'routine')
    expect(out).toEqual({ ok: true, memoryIds: ['mem-a'] })
    const [uid, payload, runId, date, source, extra] = vi.mocked(aether.persistAether).mock.calls[0]
    expect(uid).toBe(USER)
    expect(payload.thoughts).toHaveLength(1)
    expect(payload.thoughts[0].sourceMemoryIds).toEqual([REFL])
    expect(payload.thoughts[0].id).not.toBe('t1')
    expect(runId).toBe(`aether:routine:${USER}:${DAY}`)
    expect(date).toBe(DAY)
    expect(source).toBe('cron')
    expect(extra).toMatchObject({ answeredBy: 'routine' })
  })

  it('rejects an answer whose every thought is ungrounded', async () => {
    const text = JSON.stringify({
      generatedAt: 'now', coreNarrative: 'Kairos is moving its thinking onto the routine.',
      thoughts: [thought('t1', ['nope'])],
    })
    const out = await aetherHandler.apply(job(), text, 'routine')
    expect(out).toMatchObject({ ok: false })
    expect(!out.ok && out.reason).toMatch(/^all_thoughts_ungrounded/)
    expect(aether.persistAether).not.toHaveBeenCalled()
  })

  it('rejects non-JSON and a job from another day', async () => {
    expect(await aetherHandler.apply(job(), 'I think the operator…', 'routine')).toMatchObject({ ok: false })
    vi.setSystemTime(new Date('2026-10-02T00:10:00Z'))
    const out = await aetherHandler.apply(job(), '{}', 'routine')
    expect(!out.ok && out.reason).toMatch(/^stale_job/)
    expect(aether.persistAether).not.toHaveBeenCalled()
  })
})
