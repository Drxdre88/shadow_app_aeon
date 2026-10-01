import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn() }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn() }))
// Partial: daily-message-inputs (imported for its brief readers) needs the rest.
vi.mock('@/lib/data/memories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/memories')>()),
  captureMemory: vi.fn(),
  listTodaysAdvisories: vi.fn(),
}))
vi.mock('@/lib/data/aether', () => ({ getLatestAether: vi.fn() }))
vi.mock('@/lib/kairos/retrieve', () => ({ retrieveContext: vi.fn() }))
vi.mock('@/lib/kairos/conscience-context', () => ({
  createConscienceLoader: vi.fn(() => vi.fn(async () => '## Conscience\n1. Rest on Sundays')),
  loadConscienceBlock: vi.fn(async () => ''),
}))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))

import { listJobs } from '@/lib/data/thinking-jobs'
import { findDominionsByUser } from '@/lib/data/dominions'
import { captureMemory, listTodaysAdvisories } from '@/lib/data/memories'
import { getLatestAether } from '@/lib/data/aether'
import { retrieveContext } from '@/lib/kairos/retrieve'
import { getProviderForTask } from '@/lib/ai/route-task'
import { runRecipe } from '@/lib/kairos/dispatch'
import { createConscienceLoader } from '@/lib/kairos/conscience-context'
import { briefDominionName, briefFirstLines } from '@/lib/kairos/daily-message-inputs'
import { briefHandler, briefJobKey } from '../handlers/brief'
import { BRIEF_WINDOW_UTC, deadlineOn } from '../deadlines'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM = '22222222-2222-4222-8222-222222222222'
const DAY = '2026-10-01'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)
const BRIEF_TEXT = '## State\nThe queue is live.\n\n## Movement\nNothing moved.\n\n## Watch\nDrift.\n\n## Suggested next\nShip it.'

const bundle = {
  id: DOM,
  userId: USER,
  name: 'AEON',
  summary: null,
  vision: 'Fluid board app.',
  missionLong: 'Ship the brain.',
  objectives: [{ title: 'Thinking on Max', description: null, status: 'in_progress' }],
  projects: [{ id: 'p1', name: 'Aeon' }],
  recentMemories: [{ title: 'Queue first', type: 'reflection', summary: null }],
  boardTasks: [],
  archivedAt: null,
}
const retrieval = {
  bundle,
  cortex: { id: 'cx', title: 'AEON cortex', body: 'Momentum on the queue.', streamClass: 'cortex', createdAt: at('03:00') },
  archetypes: [],
  substrate: [],
  traces: [],
}

function jobRow(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    userId: USER,
    kind: 'brief',
    dominionId: DOM,
    externalKey: briefJobKey(DOM, DAY),
    status: 'claimed',
    input: {
      system: 's',
      prompt: 'p',
      context: { dominionId: DOM, dominionName: 'AEON', date: DAY, grounding: { cortex: true, aether: false, conscience: true } },
    },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('05:40'),
    deadlineAt: at('06:13'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('05:31'),
    updatedAt: at('05:31'),
    ...overrides,
  }
}

function captureCreated() {
  vi.mocked(captureMemory).mockImplementation(async (_u, input) => ({
    memory: { id: input.streamClass === 'trace' ? 'trace-1' : 'brief-1', title: input.title } as never,
    created: true,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('05:45'))
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(findDominionsByUser).mockResolvedValue([{ id: DOM, name: 'AEON', archivedAt: null }] as never)
  vi.mocked(listTodaysAdvisories).mockResolvedValue([])
  vi.mocked(getLatestAether).mockResolvedValue(null)
  vi.mocked(retrieveContext).mockResolvedValue(retrieval as never)
})

afterEach(() => { vi.useRealTimers() })

describe('brief handler — plan', () => {
  it('plans nothing outside its window (closes 06:13Z), before any DB read', async () => {
    const opens = deadlineOn(at('00:00'), BRIEF_WINDOW_UTC.notBefore)
    expect(await briefHandler.plan(USER, new Date(opens.getTime() - 60_000))).toEqual([])
    expect(await briefHandler.plan(USER, at('06:13'))).toEqual([])
    expect(await briefHandler.plan(USER, at('02:40'))).toEqual([])
    expect(findDominionsByUser).not.toHaveBeenCalled()
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('plans one job per Dominion with exactly the prompt the briefer cron sends, deadline 06:13Z', async () => {
    const now = at('05:45')
    const [spec, ...rest] = await briefHandler.plan(USER, now)
    expect(rest).toEqual([])
    expect(spec).toMatchObject({ kind: 'brief', dominionId: DOM, externalKey: `brief:${DOM}:${DAY}` })
    expect(spec.input.maxOutputTokens).toBe(1200)
    expect(new Date(now.getTime() + spec.deadlineMinutes * 60_000).toISOString()).toBe('2026-10-01T06:13:00.000Z')
    expect(spec.input.context).toEqual({
      dominionId: DOM,
      dominionName: 'AEON',
      date: DAY,
      grounding: { cortex: true, aether: false, conscience: true },
    })

    // The cron path (briefer route → runRecipe → BRIEF.flat) on the same substrate.
    const ask = vi.fn(async () => ({ text: BRIEF_TEXT, modelId: 'paid-model' }))
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
    captureCreated()
    await runRecipe('BRIEF', { userId: USER, dominionId: DOM, surface: 'byok', conscience: createConscienceLoader() })
    const sent = (ask.mock.calls as unknown as Array<[{ system: string; prompt: string; maxTokens: number }]>)[0][0]
    expect(spec.input.system).toBe(sent.system)
    expect(spec.input.prompt).toBe(sent.prompt)
    expect(spec.input.maxOutputTokens).toBe(sent.maxTokens)
  })

  it('skips planned keys, Dominions briefed today, no-bundle Dominions and archived ones', async () => {
    vi.mocked(listJobs).mockResolvedValue([jobRow()])
    expect(await briefHandler.plan(USER, at('05:45'))).toEqual([])

    vi.mocked(listJobs).mockResolvedValue([])
    vi.mocked(listTodaysAdvisories).mockResolvedValue([{ dominionId: DOM }] as never)
    expect(await briefHandler.plan(USER, at('05:45'))).toEqual([])
    expect(listTodaysAdvisories).toHaveBeenCalledWith(USER, DAY)

    vi.mocked(listTodaysAdvisories).mockResolvedValue([])
    vi.mocked(retrieveContext).mockResolvedValue({ ...retrieval, bundle: null } as never)
    expect(await briefHandler.plan(USER, at('05:45'))).toEqual([])

    vi.mocked(findDominionsByUser).mockResolvedValue([{ id: DOM, name: 'AEON', archivedAt: at('01:00') }] as never)
    expect(await briefHandler.plan(USER, at('05:45'))).toEqual([])
  })
})

describe('brief handler — apply', () => {
  const primaryOf = () => vi.mocked(captureMemory).mock.calls.map((c) => c[1]).find((i) => i.streamClass === 'advisory')!

  it('stores the brief through the dispatcher with the cron\'s exact primary row', async () => {
    captureCreated()
    const outcome = await briefHandler.apply(jobRow(), BRIEF_TEXT, 'routine')
    expect(outcome).toEqual({ ok: true, memoryIds: ['brief-1'] })
    const routinePrimary = primaryOf()

    const trace = vi.mocked(captureMemory).mock.calls.map((c) => c[1]).find((i) => i.streamClass === 'trace')!
    expect(trace.sourceMetadata).toMatchObject({
      recipe: 'BRIEF',
      primaryMemoryId: 'brief-1',
      date: DAY,
      model: 'claude-max-routine',
      answeredBy: 'routine',
      thinkingJobId: '55555555-5555-4555-8555-555555555555',
      grounding: { cortex: true, aether: false, conscience: true },
    })

    // The paid cron's row for the same text is identical, so readTodayBriefs,
    // the dashboard and externalId idempotency treat both the same.
    vi.mocked(captureMemory).mockClear()
    vi.mocked(getProviderForTask).mockResolvedValue({
      provider: { ask: vi.fn(async () => ({ text: BRIEF_TEXT, modelId: 'paid-model' })) },
    } as never)
    await runRecipe('BRIEF', { userId: USER, dominionId: DOM, surface: 'byok', conscience: createConscienceLoader() })
    expect(routinePrimary).toEqual(primaryOf())

    // What readTodayBriefs filters on and derives from the row.
    expect(routinePrimary).toMatchObject({
      type: 'advisory',
      source: 'cron',
      dominionId: DOM,
      sourceMetadata: { externalId: `briefer:${DAY}:${DOM}`, briefingDate: DAY, dominionId: DOM },
    })
    expect(briefDominionName(routinePrimary.title!)).toBe('AEON')
    expect(briefFirstLines(routinePrimary.bodyMd!)).toEqual(['The queue is live.', 'Nothing moved.'])
  })

  it('strips a single wrapping code fence', async () => {
    captureCreated()
    const outcome = await briefHandler.apply(jobRow(), `\`\`\`markdown\n${BRIEF_TEXT}\n\`\`\``, 'routine')
    expect(outcome.ok).toBe(true)
    expect(primaryOf().bodyMd).toBe(BRIEF_TEXT)
  })

  it('rejects stale, empty and non-brief answers without writing', async () => {
    const stale = jobRow({ input: { ...jobRow().input, context: { ...jobRow().input.context, date: '2026-09-30' } } })
    expect(await briefHandler.apply(stale, BRIEF_TEXT, 'routine')).toEqual({ ok: false, reason: 'stale_job: planned for 2026-09-30' })
    expect(await briefHandler.apply(jobRow(), '   ', 'routine')).toEqual({ ok: false, reason: 'parse_failed: empty brief' })
    expect(await briefHandler.apply(jobRow(), '```\n```', 'routine')).toEqual({ ok: false, reason: 'parse_failed: empty brief' })
    const garbage = await briefHandler.apply(jobRow(), '{"brief": "not markdown"}', 'routine')
    expect(garbage).toMatchObject({ ok: false })
    expect((garbage as { reason: string }).reason).toMatch(/^parse_failed: /)
    expect(await briefHandler.apply(jobRow({ input: { system: 's', prompt: 'p' } }), BRIEF_TEXT, 'routine'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^bad_job/) })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('rejects when today\'s brief already exists (no orphan trace)', async () => {
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'cron-brief', title: 't' } as never, created: false })
    expect(await briefHandler.apply(jobRow(), BRIEF_TEXT, 'routine'))
      .toEqual({ ok: false, reason: 'already_ran: a brief for this Dominion already exists today' })
    expect(captureMemory).toHaveBeenCalledTimes(1)
  })

  it('fallback defers to the briefer cron', async () => {
    expect(await briefHandler.fallback(jobRow())).toEqual({ ok: false, reason: 'deferred to the 06:15 UTC briefer cron' })
  })
})
