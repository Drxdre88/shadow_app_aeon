import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import type { DailyMessageInputs } from '@/lib/kairos/daily-message-prompt'

const m = vi.hoisted(() => ({
  listJobs: vi.fn(),
  alreadyDelivered: vi.fn(),
  gatherDailyMessageInputs: vi.fn(),
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
}))

import { DAILY_MESSAGE_SYSTEM_PROMPT, buildDailyMessageUserPrompt } from '@/lib/kairos/daily-message-prompt'
import { dailyMessageDeadline, dailyMessageHandler } from '../handlers/daily-message'

const USER = 'user-1'

function inputs(over: Partial<DailyMessageInputs> = {}): DailyMessageInputs {
  return {
    date: '2026-10-01', isMonday: false,
    areas: [{ dominion: 'AEON', headline: 'Ship it.' }],
    aether: null, boardDay: null, promotions: null, newBeliefs: null, drift: null,
    openAsks: null, synthesis: null, mindCompare: null, failed: [],
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
  m.gatherDailyMessageInputs.mockResolvedValue(inputs())
  m.loadConscienceBlock.mockResolvedValue('')
})

describe('daily_message handler — plan', () => {
  it('deadline is 05:55 London on both sides of the 2026-10-25 boundary', () => {
    expect(dailyMessageDeadline(new Date('2026-10-24T03:00:00Z')).toISOString()).toBe('2026-10-24T04:55:00.000Z')
    expect(dailyMessageDeadline(new Date('2026-10-25T03:00:00Z')).toISOString()).toBe('2026-10-25T05:55:00.000Z')
  })

  it('plans one job with exactly the compose prompt (the 04:40Z brain-routine run, BST)', async () => {
    const now = new Date('2026-10-01T04:40:00Z') // 05:40 London
    const specs = await dailyMessageHandler.plan(USER, now)
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({
      kind: 'daily_message',
      dominionId: null,
      externalKey: 'daily_message:2026-10-01',
      input: { system: DAILY_MESSAGE_SYSTEM_PROMPT, prompt: buildDailyMessageUserPrompt(inputs()), context: { date: '2026-10-01' } },
    })
    expect(specs[0].deadlineMinutes).toBeCloseTo(15, 5)
  })

  it('routine prompt carries the same conscience block as the paid compose', async () => {
    m.loadConscienceBlock.mockResolvedValue('## Conscience (reference data)\nP1')
    const specs = await dailyMessageHandler.plan(USER, new Date('2026-10-01T04:40:00Z'))
    expect(m.loadConscienceBlock).toHaveBeenCalledWith(USER)
    expect(specs[0].input.prompt).toBe(buildDailyMessageUserPrompt(inputs(), '## Conscience (reference data)\nP1'))
    expect(specs[0].input.prompt).toMatch(/Conscience \(reference data\)\nP1$/)
    expect(specs[0].input.system).toBe(DAILY_MESSAGE_SYSTEM_PROMPT)
  })

  it('plans nothing with neither area summaries nor a self-model (missing or failed)', async () => {
    const now = new Date('2026-10-01T04:40:00Z')
    m.gatherDailyMessageInputs.mockResolvedValue(inputs({ areas: [] }))
    expect(await dailyMessageHandler.plan(USER, now)).toEqual([])
    m.gatherDailyMessageInputs.mockResolvedValue(inputs({ areas: null, aether: null, failed: ['aether', 'areas'] }))
    expect(await dailyMessageHandler.plan(USER, now)).toEqual([])
    // The self-model alone is enough.
    m.gatherDailyMessageInputs.mockResolvedValue(inputs({ areas: [], aether: [{ title: 'T', insight: 'I', dominionName: null }] }))
    expect(await dailyMessageHandler.plan(USER, now)).toHaveLength(1)
  })

  it('plans nothing at/after 05:55 London (BST: 04:55Z, GMT: 05:55Z); the GMT 05:40Z run plans', async () => {
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T04:55:00Z'))).toEqual([])
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-26T05:56:00Z'))).toEqual([])
    const gmt = await dailyMessageHandler.plan(USER, new Date('2026-10-26T05:40:00Z'))
    expect(gmt).toHaveLength(1)
    expect(gmt[0].deadlineMinutes).toBeCloseTo(15, 5)
    expect(m.gatherDailyMessageInputs).toHaveBeenCalledTimes(1)
  })

  it('never plans tomorrow’s message before midnight UTC in summer time', async () => {
    // 23:50Z on 02/10 is already 03/10 in London (BST); yesterday's thinking must not be frozen in.
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-02T23:50:00Z'))).toEqual([])
    expect(m.gatherDailyMessageInputs).not.toHaveBeenCalled()
  })

  it('opens at 04:00 UTC and waits for live aether / idea / ask jobs until 04:35 UTC', async () => {
    expect(await dailyMessageHandler.plan(USER, new Date('2026-10-01T03:59:00Z'))).toEqual([])
    expect(m.listJobs).not.toHaveBeenCalled()

    const at = (iso: string) => new Date(iso)
    const tonight = (kind: string, status: string, deadline: string) => ({ kind, externalKey: `${kind}:x`, status, deadlineAt: at(deadline) })
    m.listJobs.mockImplementation(async (_u: string, f: { kind?: string }) => (
      f.kind ? [] : [tonight('idea_judge', 'claimed', '2026-10-01T04:50:00Z'), tonight('cortex', 'queued', '2026-10-01T04:50:00Z')]
    ))
    expect(await dailyMessageHandler.plan(USER, at('2026-10-01T04:20:00Z'))).toEqual([])
    expect(m.gatherDailyMessageInputs).not.toHaveBeenCalled()
    // Past 04:35 UTC: plan on what exists.
    expect(await dailyMessageHandler.plan(USER, at('2026-10-01T04:36:00Z'))).toHaveLength(1)

    // A feeding job past its deadline is settled (its cron covers it); other kinds never block.
    m.listJobs.mockImplementation(async (_u: string, f: { kind?: string }) => (
      f.kind ? [] : [tonight('aether', 'claimed', '2026-10-01T03:13:00Z'), tonight('cortex', 'queued', '2026-10-01T04:50:00Z')]
    ))
    expect(await dailyMessageHandler.plan(USER, at('2026-10-01T04:20:00Z'))).toHaveLength(1)
  })

  it('plans nothing when the job exists or today was already delivered', async () => {
    const now = new Date('2026-10-01T04:40:00Z')
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
