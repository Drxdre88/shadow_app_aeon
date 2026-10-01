import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import type { DailyMessageInputs } from '@/lib/kairos/daily-message-prompt'

const m = vi.hoisted(() => ({
  listJobs: vi.fn(),
  alreadyDelivered: vi.fn(),
  gatherDailyMessageInputs: vi.fn(),
  readTodayBriefs: vi.fn(),
  loadConscienceBlock: vi.fn(),
}))

vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: m.listJobs }))
vi.mock('@/lib/kairos/conscience-context', () => ({ loadConscienceBlock: m.loadConscienceBlock }))
vi.mock('@/lib/kairos/daily-message', () => ({
  DAILY_MESSAGE_KIND: 'daily_message',
  dailyMessageJobKey: (date: string) => `daily_message:${date}`,
  alreadyDelivered: m.alreadyDelivered,
}))
vi.mock('@/lib/kairos/daily-message-inputs', () => ({
  gatherDailyMessageInputs: m.gatherDailyMessageInputs,
  readTodayBriefs: m.readTodayBriefs,
}))

import { DAILY_MESSAGE_SYSTEM_PROMPT, buildDailyMessageUserPrompt } from '@/lib/kairos/daily-message-prompt'
import { dailyMessageDeadline, dailyMessageHandler } from '../handlers/daily-message'

const USER = 'user-1'

function inputs(over: Partial<DailyMessageInputs> = {}): DailyMessageInputs {
  return {
    date: '2026-10-01', isMonday: false,
    briefs: [{ dominion: 'AEON', lines: ['Ship it.'] }],
    aether: null, boardDay: null, promotions: null, newBeliefs: null, drift: null,
    pendingAsk: null, synthesis: null, mindCompare: null, failed: [],
    ...over,
  }
}

function claimedJob(date: string, over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  const t = new Date()
  return {
    id: 'job-1', userId: USER, kind: 'daily_message' as ThinkingJobRow['kind'], dominionId: null,
    externalKey: `daily_message:${date}`, status: 'claimed',
    input: { system: 's', prompt: 'p', context: { date } },
    output: null, claimedBy: 'routine', claimToken: 'tok', claimedAt: t, deadlineAt: t, completedAt: null,
    attempts: 1, error: null, createdAt: t, updatedAt: t,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  m.listJobs.mockResolvedValue([])
  m.alreadyDelivered.mockResolvedValue(false)
  m.readTodayBriefs.mockResolvedValue([{ dominion: 'AEON', lines: ['Ship it.'] }])
  m.gatherDailyMessageInputs.mockResolvedValue(inputs())
  m.loadConscienceBlock.mockResolvedValue('')
})

describe('daily_message handler — plan', () => {
  it('deadline is 07:55 London on both sides of the 2026-10-25 boundary', () => {
    expect(dailyMessageDeadline(new Date('2026-10-24T05:00:00Z')).toISOString()).toBe('2026-10-24T06:55:00.000Z')
    expect(dailyMessageDeadline(new Date('2026-10-25T05:00:00Z')).toISOString()).toBe('2026-10-25T07:55:00.000Z')
  })

  it('plans one job with exactly the compose prompt once today\'s briefs exist', async () => {
    const now = new Date('2026-10-01T06:20:00Z') // 07:20 London
    const specs = await dailyMessageHandler.plan(USER, now)
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({
      kind: 'daily_message',
      dominionId: null,
      externalKey: 'daily_message:2026-10-01',
      input: { system: DAILY_MESSAGE_SYSTEM_PROMPT, prompt: buildDailyMessageUserPrompt(inputs()), context: { date: '2026-10-01' } },
    })
    expect(specs[0].deadlineMinutes).toBeCloseTo(35, 5)
  })

  it('routine prompt carries the same conscience block as the paid compose', async () => {
    m.loadConscienceBlock.mockResolvedValue('## Conscience (reference data)\nP1')
    const specs = await dailyMessageHandler.plan(USER, new Date('2026-10-01T06:20:00Z'))
    expect(m.loadConscienceBlock).toHaveBeenCalledWith(USER)
    expect(specs[0].input.prompt).toBe(buildDailyMessageUserPrompt(inputs(), '## Conscience (reference data)\nP1'))
    expect(specs[0].input.prompt).toMatch(/Conscience \(reference data\)\nP1$/)
    expect(specs[0].input.system).toBe(DAILY_MESSAGE_SYSTEM_PROMPT)
  })

  it('plans nothing without today\'s briefs (missing or failed)', async () => {
    m.readTodayBriefs.mockResolvedValueOnce([])
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T06:20:00Z'))).toEqual([])
    expect(m.gatherDailyMessageInputs).not.toHaveBeenCalled() // cheap pre-check spares the full gather
    m.gatherDailyMessageInputs.mockResolvedValue(inputs({ briefs: [] }))
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T06:20:00Z'))).toEqual([])
    m.gatherDailyMessageInputs.mockResolvedValue(inputs({ briefs: null, failed: ['briefs'] }))
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T06:20:00Z'))).toEqual([])
  })

  it('plans nothing at/after 07:55 London (GMT: 07:55Z)', async () => {
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T06:55:00Z'))).toEqual([])
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-26T07:56:00Z'))).toEqual([])
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-26T07:30:00Z'))).toHaveLength(1)
    expect(m.gatherDailyMessageInputs).toHaveBeenCalledTimes(1)
  })

  it('waits until every brief job is answered, or until the 06:15 briefer has filled the gaps', async () => {
    const brief = (status: string) => ({ kind: 'brief', externalKey: `brief:d:${status}`, status })
    m.listJobs.mockImplementation(async (_u: string, f: { kind?: string }) => (
      f.kind === 'brief' ? [brief('done'), brief('queued')] : []
    ))
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T05:50:00Z'))).toEqual([])
    expect(m.gatherDailyMessageInputs).not.toHaveBeenCalled()
    // Past 06:25 UTC the briefer has run: plan on what exists.
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T06:26:00Z'))).toHaveLength(1)

    m.listJobs.mockImplementation(async (_u: string, f: { kind?: string }) => (
      f.kind === 'brief' ? [brief('done'), brief('done')] : []
    ))
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T05:50:00Z'))).toHaveLength(1)
  })

  it('plans nothing when the job exists or today was already delivered', async () => {
    const now = new Date('2026-10-01T06:20:00Z')
    m.listJobs.mockResolvedValue([{ externalKey: 'daily_message:2026-10-01' }])
    expect(await dailyMessageHandler.plan(USER, now)).toEqual([])
    m.listJobs.mockResolvedValue([])
    m.alreadyDelivered.mockResolvedValue(true)
    expect(await dailyMessageHandler.plan(USER, now)).toEqual([])
    expect(m.gatherDailyMessageInputs).not.toHaveBeenCalled()
  })
})

describe('daily_message handler — apply / fallback', () => {
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())

  it('guards the draft and returns it as output.draft (the queue merges it into the job output)', async () => {
    const job = claimedJob(today())
    expect(await dailyMessageHandler.apply(job, '{"message": "**Today** fine."}', 'routine'))
      .toEqual({ ok: true, memoryIds: [], output: { draft: '**Today** fine.' } })
  })

  it('rejects guard failures and stale jobs', async () => {
    expect(await dailyMessageHandler.apply(claimedJob(today()), '{"message": "# Heading"}', 'routine'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^guard_rejected/) })
    expect(await dailyMessageHandler.apply(claimedJob('2020-01-01'), '{"message": "ok"}', 'routine'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^stale_job/) })
  })

  it('fallback defers to the cron', async () => {
    expect(await dailyMessageHandler.fallback(claimedJob(today()))).toEqual({ ok: false, reason: 'deferred to the daily-message cron' })
  })
})
