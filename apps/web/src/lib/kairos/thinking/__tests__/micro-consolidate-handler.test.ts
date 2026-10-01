import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn(), isJobDone: vi.fn() }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn() }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: vi.fn(), writeCronFailureTrace: vi.fn() }))
vi.mock('@/lib/kairos/micro-consolidate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kairos/micro-consolidate')>()),
  gatherMicroConsolidateContext: vi.fn(),
  persistMicroConsolidateDelta: vi.fn(),
}))

import { findDominionsByUser } from '@/lib/data/dominions'
import { listJobs } from '@/lib/data/thinking-jobs'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { gatherMicroConsolidateContext, persistMicroConsolidateDelta } from '@/lib/kairos/micro-consolidate'
import {
  MICRO_CONSOLIDATE_SYSTEM_PROMPT,
  buildMicroConsolidateUserPrompt,
  type MicroConsolidateContext,
} from '@/lib/kairos/micro-consolidate-prompt'
import { microConsolidateHandler } from '../handlers/micro-consolidate'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM = '22222222-2222-4222-8222-222222222222'
const DOM_QUIET = '33333333-3333-4333-8333-333333333333'
const at = (iso: string) => new Date(`2026-10-01T${iso}:00.000Z`)
const KEY = `micro_consolidate:${DOM}:2026-10-01T09`

function ctx(now: Date): MicroConsolidateContext {
  return {
    dominionId: DOM,
    dominionName: 'AEON',
    since: at('06:15'),
    now,
    newMemories: [
      { title: 'a', type: 'note', streamClass: 'idea' },
      { title: 'b', type: 'note', streamClass: 'idea' },
      { title: 'c', type: 'note', streamClass: 'idea' },
    ],
    tasksCompleted: 2,
    tasksCreated: 1,
  }
}

function jobRow(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    userId: USER,
    kind: 'micro_consolidate',
    dominionId: DOM,
    externalKey: KEY,
    status: 'claimed',
    input: { system: 's', prompt: 'p' },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('08:40'),
    deadlineAt: at('09:13'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('08:30'),
    updatedAt: at('08:30'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(findDominionsByUser).mockResolvedValue([
    { id: DOM, name: 'AEON', archivedAt: null },
    { id: DOM_QUIET, name: 'Quiet', archivedAt: null },
    { id: 'archived', name: 'Old', archivedAt: new Date('2026-01-01') },
  ] as never)
  vi.mocked(gatherMicroConsolidateContext).mockImplementation(async (_u, dominionId, now) =>
    dominionId === DOM
      ? { ok: true, ctx: ctx(now!), newMemoryTotal: 3 }
      : { ok: false, result: { dominionId, dominionName: 'Quiet', status: 'skipped', reason: 'below threshold' } },
  )
  vi.mocked(persistMicroConsolidateDelta).mockResolvedValue({ memoryId: 'delta-1', created: true })
})

describe('micro_consolidate handler — plan', () => {
  it('outside a slot window plans nothing without touching the DB', async () => {
    for (const t of ['07:00', '08:14', '09:13', '10:00']) {
      expect(await microConsolidateHandler.plan(USER, at(t))).toEqual([])
    }
    expect(findDominionsByUser).not.toHaveBeenCalled()
    expect(listJobs).not.toHaveBeenCalled()
    expect(gatherMicroConsolidateContext).not.toHaveBeenCalled()
  })

  it('plans one job per Dominion above threshold, with the cron prompt and the slot hour key', async () => {
    const now = at('08:30')
    const specs = await microConsolidateHandler.plan(USER, now)
    expect(specs).toHaveLength(1)
    const [spec] = specs
    expect(spec).toMatchObject({ kind: 'micro_consolidate', dominionId: DOM, externalKey: KEY })
    expect(spec.input.system).toBe(MICRO_CONSOLIDATE_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildMicroConsolidateUserPrompt(ctx(now)))
    expect(spec.input.maxOutputTokens).toBe(1500)
    expect(spec.input.context).toEqual({
      dominionId: DOM,
      dominionName: 'AEON',
      bucket: '2026-10-01T09',
      since: at('06:15').toISOString(),
      until: now.toISOString(),
      newMemoryCount: 3,
      newMemoryTotal: 3,
      tasksCompleted: 2,
      tasksCreated: 1,
    })
    expect(new Date(now.getTime() + spec.deadlineMinutes * 60_000).toISOString()).toBe('2026-10-01T09:13:00.000Z')
    expect(gatherMicroConsolidateContext).toHaveBeenCalledWith(USER, DOM, now)
    expect(gatherMicroConsolidateContext).not.toHaveBeenCalledWith(USER, 'archived', expect.anything())
  })

  it('skips a key already planned for this slot', async () => {
    vi.mocked(listJobs).mockResolvedValue([jobRow()])
    expect(await microConsolidateHandler.plan(USER, at('08:30'))).toEqual([])
    expect(gatherMicroConsolidateContext).not.toHaveBeenCalledWith(USER, DOM, expect.anything())
  })
})

describe('micro_consolidate handler — apply', () => {
  const planned = async () => {
    const [spec] = await microConsolidateHandler.plan(USER, at('08:30'))
    return jobRow({ input: spec.input })
  }

  it('persists the plain-text delta through the shared path under the slot bucket, then traces liveness', async () => {
    const job = await planned()
    const out = await microConsolidateHandler.apply(job, '```markdown\nTwo ideas landed; one task closed.\n```\n', 'routine')
    expect(out).toEqual({ ok: true, memoryIds: ['delta-1'] })
    expect(persistMicroConsolidateDelta).toHaveBeenCalledWith(USER, {
      dominionId: DOM,
      dominionName: 'AEON',
      bucket: '2026-10-01T09',
      since: at('06:15'),
      until: at('08:30'),
      bodyMd: 'Two ideas landed; one task closed.',
      newMemoryCount: 3,
      newMemoryTotal: 3,
      tasksCompleted: 2,
      tasksCreated: 1,
      provenance: { answeredBy: 'routine', thinkingJobId: job.id },
    })
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'micro-consolidate', dominionId: DOM })
  })

  it('rejects an empty answer without persisting', async () => {
    const job = await planned()
    for (const text of ['', '   \n', '```\n\n```']) {
      expect(await microConsolidateHandler.apply(job, text, 'routine')).toEqual({ ok: false, reason: 'parse_failed: empty delta' })
    }
    expect(persistMicroConsolidateDelta).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('rejects a job without window context', async () => {
    const out = await microConsolidateHandler.apply(jobRow(), 'A delta.', 'routine')
    expect(out).toMatchObject({ ok: false })
    expect(persistMicroConsolidateDelta).not.toHaveBeenCalled()
  })

  it('fallback defers to the cron', async () => {
    expect(await microConsolidateHandler.fallback(jobRow())).toEqual({
      ok: false,
      reason: 'deferred to the next micro-consolidate cron slot',
    })
  })
})
