import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(), listJobs: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ listRecentMemories: vi.fn(), captureMemory: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({
  todayEnabled: vi.fn(() => true),
  loadTodayDigest: vi.fn(async () => null),
  appendTodayNotes: vi.fn(async () => undefined),
  countTodayEntriesSince: vi.fn(async () => 0),
}))

import { hasJobWithKeyLike, listJobs } from '@/lib/data/thinking-jobs'
import { captureMemory, listRecentMemories } from '@/lib/data/memories'
import { appendTodayNotes, countTodayEntriesSince, loadTodayDigest, todayEnabled } from '@/lib/kairos/today'
import { pulseHandler } from '../handlers/pulse'

const USER = 'user-1'
// 10:10Z on 1 Oct 2026 = 11:10 London (BST).
const NOW = new Date('2026-10-01T10:10:00.000Z')
const INBOX = [
  { id: 'mem-in-1', title: 'Vendor contract renewal', createdAt: NOW, streamClass: 'idea' },
  { id: 'mem-in-2', title: 'Voice note: pricing', createdAt: NOW, streamClass: 'idea' },
]

function pulseJob(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: 'job-1', userId: USER, kind: 'pulse', dominionId: null, externalKey: 'pulse:2026-10-01:11', status: 'claimed',
    input: { system: 's', prompt: 'p', validMemoryIds: ['mem-in-1', 'mem-in-2'], context: { slot: 'pulse:2026-10-01:11', inbox: INBOX.map(({ id, title }) => ({ id, title })) } },
    output: null, claimedBy: 'routine:pulse', claimToken: 't', claimedAt: NOW, deadlineAt: new Date(NOW.getTime() + 45 * 60_000),
    completedAt: null, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_DAYTIME_THINKING = '1'
  vi.mocked(todayEnabled).mockReturnValue(true)
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(countTodayEntriesSince).mockResolvedValue(2)
  vi.mocked(listRecentMemories).mockResolvedValue(INBOX)
})
afterEach(() => { delete process.env.KAIROS_DAYTIME_THINKING })

describe('pulse plan — gates', () => {
  it('flag off: plans nothing and reads nothing', async () => {
    delete process.env.KAIROS_DAYTIME_THINKING
    expect(await pulseHandler.plan(USER, NOW)).toEqual([])
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
  })

  it('today module off: plans nothing', async () => {
    vi.mocked(todayEnabled).mockReturnValue(false)
    expect(await pulseHandler.plan(USER, NOW)).toEqual([])
  })

  it.each([
    ['04:10 London', '2026-10-01T03:10:00.000Z'],
    ['06:59 London', '2026-10-01T05:59:00.000Z'],
    ['23:10 London', '2026-10-01T22:10:00.000Z'],
  ])('closed window (%s): plans nothing', async (_label, iso) => {
    expect(await pulseHandler.plan(USER, new Date(iso))).toEqual([])
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
  })

  it('duplicate slot: plans nothing', async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValue(true)
    expect(await pulseHandler.plan(USER, NOW)).toEqual([])
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'pulse', 'pulse:2026-10-01:11')
  })

  it('no new activity since the last pulse: plans nothing', async () => {
    const last = new Date('2026-10-01T09:10:00.000Z')
    vi.mocked(listJobs).mockResolvedValue([pulseJob({ externalKey: 'pulse:2026-10-01:10', status: 'done', createdAt: last })])
    vi.mocked(countTodayEntriesSince).mockResolvedValue(0)
    vi.mocked(listRecentMemories).mockResolvedValue([])
    expect(await pulseHandler.plan(USER, NOW)).toEqual([])
    expect(countTodayEntriesSince).toHaveBeenCalledWith(USER, last, { speakers: ['owner', 'agent'] })
  })

  it('new activity: one 45-minute job for this London hour, grounded to the inbox ids', async () => {
    const [spec] = await pulseHandler.plan(USER, NOW)
    expect(spec).toMatchObject({ kind: 'pulse', externalKey: 'pulse:2026-10-01:11', deadlineMinutes: 45, dominionId: null })
    expect(spec.input.validMemoryIds).toEqual(['mem-in-1', 'mem-in-2'])
    expect(spec.input.prompt).toContain('London time: 11:10')
    expect(loadTodayDigest).toHaveBeenCalled()
  })
})

describe('pulse apply — writes only to today', () => {
  const answer = JSON.stringify({
    notes: ['Owner moved three pricing cards to Done.', '  '],
    attention: [{ memoryId: 'mem-in-1', why: 'renewal is due this week' }, { memoryId: 'invented', why: 'x' }],
  })

  it('appends the notes and grounded inbox lines to today, nothing else', async () => {
    const res = await pulseHandler.apply(pulseJob(), answer, 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: [] })
    expect(appendTodayNotes).toHaveBeenCalledWith(
      USER,
      ['Owner moved three pricing cards to Done.', 'Inbox needs a look: Vendor contract renewal — renewal is due this week'],
      'pulse',
      'job-1',
    )
    expect(captureMemory).not.toHaveBeenCalled()
    expect(res.ok && res.output).toMatchObject({ notes: 1, attention: ['mem-in-1'], dropped: 2 })
  })

  it('the today module is off: writes nothing at all', async () => {
    vi.mocked(todayEnabled).mockReturnValue(false)
    const res = await pulseHandler.apply(pulseJob(), answer, 'routine')
    expect(res).toMatchObject({ ok: true, output: { skipped: 'today_off' } })
    expect(appendTodayNotes).not.toHaveBeenCalled()
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('an empty glance writes nothing', async () => {
    const res = await pulseHandler.apply(pulseJob(), '{"notes": [], "attention": []}', 'routine')
    expect(res.ok).toBe(true)
    expect(appendTodayNotes).not.toHaveBeenCalled()
  })

  it('unparseable text is rejected', async () => {
    const res = await pulseHandler.apply(pulseJob(), 'no json here', 'routine')
    expect(res).toMatchObject({ ok: false })
    expect(!res.ok && res.reason).toMatch(/^parse_failed/)
  })

  it('has no fallback', async () => {
    expect(await pulseHandler.fallback(pulseJob())).toEqual({ ok: false, reason: 'no fallback — a missed hour is fine' })
  })
})
