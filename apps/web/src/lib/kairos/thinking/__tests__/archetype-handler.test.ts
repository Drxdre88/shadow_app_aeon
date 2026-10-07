import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({
  hasLiveOpenJob: vi.fn(async () => false),
  isJobDone: vi.fn(async () => false),
  listJobs: vi.fn(async () => []),
}))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn(), inspectDominion: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn(), validAsOfNow: 'mock-valid-as-of-now' }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))
vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))
// Real gates/keys/fed-ids; only the DB-touching steps are stubbed.
vi.mock('@/lib/kairos/archetypes', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/kairos/archetypes')>()),
  alreadyRanToday: vi.fn(async () => false),
  gatherArchetypeContext: vi.fn(),
  persistArchetypes: vi.fn(),
}))

import { hasLiveOpenJob, listJobs } from '@/lib/data/thinking-jobs'
import { findDominionsByUser } from '@/lib/data/dominions'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import * as archetypes from '@/lib/kairos/archetypes'
import {
  ARCHETYPE_SYSTEM_PROMPT,
  buildArchetypeUserPrompt,
  type ArchetypeContext,
  type SubstrateRow,
} from '@/lib/kairos/archetypes-prompt'
import { archetypeHandler } from '../handlers/archetype'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM_A = '22222222-2222-4222-8222-222222222222'
const DOM_B = '33333333-3333-4333-8333-333333333333'
const DOM_C = '44444444-4444-4444-8444-444444444444'
const DOM_ARCHIVED = '55555555-5555-4555-8555-555555555555'
const REFL = '66666666-6666-4666-8666-666666666666'
const RECENT = '77777777-7777-4777-8777-777777777777'
const DAY = '2026-10-01'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)

function row(id: string, streamClass: string): SubstrateRow {
  return { id, title: `Row ${id.slice(0, 4)}`, type: streamClass, streamClass, summary: null, pinned: false, createdAt: new Date('2026-09-30T10:00:00Z') }
}

function ctx(dominionId: string, overrides: Partial<ArchetypeContext> = {}): ArchetypeContext {
  return {
    dominionId,
    name: 'AEON',
    vision: null,
    missionLong: null,
    objectives: [],
    boardTasks: [],
    recent: [row(RECENT, 'agentic')],
    pinned: [],
    reflections: [row(REFL, 'reflection')],
    existing: [],
    ...overrides,
  }
}

const emptyCtx = (dominionId: string) => ctx(dominionId, { recent: [], reflections: [] })

function jobRow(context: Record<string, unknown>, overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    userId: USER,
    kind: 'archetype',
    dominionId: DOM_A,
    externalKey: `archetype:${DOM_A}:${DAY}`,
    status: 'claimed',
    input: { system: 's', prompt: 'p', validMemoryIds: [RECENT, REFL], context },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('02:00'),
    deadlineAt: at('02:28'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('01:50'),
    updatedAt: at('01:50'),
    ...overrides,
  }
}

const archetypeRow = {
  title: 'Queue first',
  summary: 'The thinking queue is the spine of the night.',
  body: 'Every nightly synthesis now flows through the thinking queue, answered on Max with the paid crons as fallback. The next move is to retire the paid key for the remaining kinds.',
  themes: ['kairos'],
  citedMemoryIds: [REFL.slice(0, 8), '99999999-9999-4999-8999-999999999999'],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasLiveOpenJob).mockResolvedValue(false)
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(archetypes.alreadyRanToday).mockResolvedValue(false)
  vi.mocked(findDominionsByUser).mockResolvedValue([
    { id: DOM_A, archivedAt: null },
    { id: DOM_B, archivedAt: null },
    { id: DOM_C, archivedAt: null },
    { id: DOM_ARCHIVED, archivedAt: new Date() },
  ] as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('archetype plan', () => {
  it('plans nothing outside its window, without touching the DB', async () => {
    for (const t of ['01:35', '02:28', '03:00', '12:00']) {
      expect(await archetypeHandler.plan(USER, at(t))).toEqual([])
    }
    expect(hasLiveOpenJob).not.toHaveBeenCalled()
    expect(findDominionsByUser).not.toHaveBeenCalled()
  })

  it("waits while tonight's chat distill is still live", async () => {
    vi.mocked(hasLiveOpenJob).mockResolvedValue(true)

    expect(await archetypeHandler.plan(USER, at('01:45'))).toEqual([])
    expect(hasLiveOpenJob).toHaveBeenCalledWith(USER, 'chat_distill', at('01:45'))
    expect(findDominionsByUser).not.toHaveBeenCalled()
  })

  it("plans one job per eligible Dominion with the cron's exact prompt", async () => {
    // A: eligible · B: already ran today · C: empty substrate · archived: never read.
    vi.mocked(archetypes.alreadyRanToday).mockImplementation(async (_u, dom) => dom === DOM_B)
    vi.mocked(archetypes.gatherArchetypeContext).mockImplementation(async (_u, dom) => (dom === DOM_C ? emptyCtx(dom) : ctx(dom)))

    const specs = await archetypeHandler.plan(USER, at('02:00'))

    expect(specs).toHaveLength(1)
    expect(specs[0]).toEqual({
      kind: 'archetype',
      dominionId: DOM_A,
      externalKey: `archetype:${DOM_A}:${DAY}`,
      deadlineMinutes: 28,
      input: {
        system: ARCHETYPE_SYSTEM_PROMPT,
        prompt: buildArchetypeUserPrompt(ctx(DOM_A), DAY),
        validMemoryIds: [RECENT, REFL],
        maxOutputTokens: 8000,
        context: { dominionId: DOM_A, date: DAY },
      },
    })
    expect(archetypes.gatherArchetypeContext).not.toHaveBeenCalledWith(USER, DOM_ARCHIVED)
    expect(archetypes.gatherArchetypeContext).not.toHaveBeenCalledWith(USER, DOM_B)
  })

  it('skips Dominions already planned today', async () => {
    vi.mocked(listJobs).mockResolvedValue([{ externalKey: `archetype:${DOM_A}:${DAY}` }] as never)
    vi.mocked(archetypes.gatherArchetypeContext).mockImplementation(async (_u, dom) => ctx(dom))

    const specs = await archetypeHandler.plan(USER, at('02:00'))

    expect(specs.map((s) => s.dominionId)).toEqual([DOM_B, DOM_C])
  })
})

describe('archetype apply', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('02:05'))
  })

  it('persists grounded archetypes through the cron write path and writes its success trace', async () => {
    vi.mocked(archetypes.persistArchetypes).mockResolvedValue({ inserted: 1, archivedPrior: 3, archetypeMemoryIds: ['arch-1'] })
    const text = '```json\n' + JSON.stringify({ archetypes: [archetypeRow], shifts: ['queue took over'] }) + '\n```'

    const out = await archetypeHandler.apply(jobRow({ dominionId: DOM_A, date: DAY }), text, 'routine')

    expect(out).toEqual({ ok: true, memoryIds: ['arch-1'] })
    expect(archetypes.persistArchetypes).toHaveBeenCalledWith(
      USER,
      DOM_A,
      {
        archetypes: [{ ...archetypeRow, citedMemoryIds: [REFL] }],
        shifts: ['queue took over'],
      },
      `archetype:${DOM_A}:${DAY}`,
    )
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'archetype-synthesis', dominionId: DOM_A })
  })

  it('clips an over-long title and shift at a word boundary instead of failing the night', async () => {
    vi.mocked(archetypes.persistArchetypes).mockResolvedValue({ inserted: 1, archivedPrior: 0, archetypeMemoryIds: ['arch-1'] })
    const longTitle = 'Beta auth hardening across magic links and connector discovery '.repeat(3)
    const longShift = 'The overnight queue quietly took over most synthesis work from the old crons '.repeat(4)
    const text = '```json\n' + JSON.stringify({ archetypes: [{ ...archetypeRow, title: longTitle }], shifts: [longShift] }) + '\n```'

    const out = await archetypeHandler.apply(jobRow({ dominionId: DOM_A, date: DAY }), text, 'routine')

    expect(out).toEqual({ ok: true, memoryIds: ['arch-1'] })
    const saved = vi.mocked(archetypes.persistArchetypes).mock.calls[0][2]
    const [title, shift] = [saved.archetypes[0].title, saved.shifts[0]]
    expect(title.length).toBeLessThanOrEqual(80)
    expect(shift.length).toBeLessThanOrEqual(200)
    for (const [clip, full] of [[title, longTitle], [shift, longShift]]) {
      expect(clip.endsWith('…')).toBe(true)
      expect(full.startsWith(clip.slice(0, -1))).toBe(true)
      expect(full[clip.length - 1]).toBe(' ')
    }
  })

  it('rejects an unparseable or schema-invalid answer without writing', async () => {
    const garbage = await archetypeHandler.apply(jobRow({ dominionId: DOM_A, date: DAY }), 'no json here', 'routine')
    const tooShort = await archetypeHandler.apply(
      jobRow({ dominionId: DOM_A, date: DAY }),
      JSON.stringify({ archetypes: [{ ...archetypeRow, body: 'short' }] }),
      'routine',
    )

    expect((garbage as { reason: string }).reason).toMatch(/^parse_failed: /)
    expect((tooShort as { reason: string }).reason).toMatch(/^parse_failed: archetypes\.0\.body/)
    expect(archetypes.persistArchetypes).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('rejects a job planned for another day', async () => {
    const out = await archetypeHandler.apply(jobRow({ dominionId: DOM_A, date: '2026-09-30' }), '{}', 'routine')

    expect(out).toEqual({ ok: false, reason: 'stale_job: planned for 2026-09-30' })
  })

  it('rejects when the Dominion already has archetypes today', async () => {
    vi.mocked(archetypes.alreadyRanToday).mockResolvedValue(true)

    const out = await archetypeHandler.apply(jobRow({ dominionId: DOM_A, date: DAY }), '{}', 'routine')

    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^already_ran: /) })
    expect(archetypes.persistArchetypes).not.toHaveBeenCalled()
  })

  it('reports persist_failed when nothing was inserted', async () => {
    vi.mocked(archetypes.persistArchetypes).mockResolvedValue({ inserted: 0, archivedPrior: 0, archetypeMemoryIds: [] })

    const out = await archetypeHandler.apply(
      jobRow({ dominionId: DOM_A, date: DAY }),
      JSON.stringify({ archetypes: [archetypeRow] }),
      'routine',
    )

    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^persist_failed/) })
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('falls back to the cron', async () => {
    expect(await archetypeHandler.fallback(jobRow({}))).toEqual({
      ok: false,
      reason: 'deferred to the 02:30 UTC archetype-synthesis cron',
    })
  })
})
