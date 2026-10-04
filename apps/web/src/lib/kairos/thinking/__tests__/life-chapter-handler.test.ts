import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn() }))
vi.mock('@/lib/data/belief-diff', () => ({ listBeliefDiffOps: vi.fn() }))
vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: vi.fn() }))
vi.mock('@/lib/kairos/speak', () => ({ deliverKairosSpeak: vi.fn() }))
vi.mock('@/lib/data/life-chapters', () => ({
  listWeeklyReviewsOverlapping: vi.fn(),
  listGoalsTouchedBetween: vi.fn(),
  listConstitutionVersionsBetween: vi.fn(),
  findAetherNarrativeBefore: vi.fn(),
  findLatestLifeChapterBefore: vi.fn(),
  findLifeChapter: vi.fn(),
  insertLifeChapter: vi.fn(),
}))

import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { listBeliefDiffOps } from '@/lib/data/belief-diff'
import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { deliverKairosSpeak } from '@/lib/kairos/speak'
import * as data from '@/lib/data/life-chapters'
import { lifeChapterHandler } from '../handlers/life-chapter'

const USER = 'user-1'
const DUE = new Date('2026-10-01T13:00:00.000Z')
const KEY = 'life_chapter:2026-09'
const PRED_ID = '11111111-1111-4111-8111-111111111111'

function job(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: 'job-lc', userId: USER, kind: 'life_chapter', dominionId: null, externalKey: KEY, status: 'claimed',
    input: {
      system: 's', prompt: 'p', validMemoryIds: ['rev-1', 'goal-1', PRED_ID],
      context: { month: '2026-09', windowStart: '2026-09-01T00:00:00.000Z', windowEnd: '2026-10-01T00:00:00.000Z', inputCounts: { reviews: 1 } },
    },
    output: null, claimedBy: 'routine:brain', claimToken: 't', claimedAt: DUE, deadlineAt: DUE,
    completedAt: null, attempts: 1, error: null, createdAt: DUE, updatedAt: DUE,
    ...overrides,
  }
}

const answer = (o: Record<string, unknown> = {}) => JSON.stringify({
  title: 'The month auth stalled',
  summary: 'Billing shipped; the auth goal failed and my prediction about it was wrong.',
  turningPoints: [
    { what: 'The auth goal failed.', before: 'I expected it done.', after: 'I stopped promising dates.', evidenceIds: ['goal-1', 'made-up'] },
    { what: 'Invented moment.', before: '', after: '', evidenceIds: ['nope'] },
  ],
  whatChanged: [{ text: 'I was wrong about auth timing.', evidenceIds: [PRED_ID] }],
  unresolved: ['Auth still open.'],
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_LIFE_CHAPTERS = 'observe'
  delete process.env.KAIROS_LIFE_CHAPTER_LINE
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listBeliefDiffOps).mockResolvedValue([])
  vi.mocked(readKairosPredictions).mockResolvedValue({
    v: 1, nextSeq: 2, open: [],
    closed: [
      { id: PRED_ID, seq: 1, claim: 'Auth ships by the 20th', probability: 0.7, status: 'wrong', settledAt: '2026-09-21T00:00:00.000Z' },
      { id: 'pred-old', seq: 0, claim: 'Old', probability: 0.6, status: 'right', settledAt: '2026-08-02T00:00:00.000Z' },
    ],
  } as never)
  vi.mocked(readKairosPromises).mockResolvedValue({ v: 1, nextSeq: 1, open: [], closed: [] } as never)
  vi.mocked(data.listWeeklyReviewsOverlapping).mockResolvedValue([{ id: 'rev-1', isoWeek: '2026-W38', summary: 'Billing shipped.', wins: ['billing'], drift: ['auth'] }])
  vi.mocked(data.listGoalsTouchedBetween).mockResolvedValue([{ id: 'goal-1', title: 'Fix auth', state: 'failed', at: '2026-09-20T00:00:00.000Z' }])
  vi.mocked(data.listConstitutionVersionsBetween).mockResolvedValue([])
  vi.mocked(data.findAetherNarrativeBefore).mockResolvedValue(null)
  vi.mocked(data.findLatestLifeChapterBefore).mockResolvedValue(null)
  vi.mocked(data.findLifeChapter).mockResolvedValue(null)
  vi.mocked(data.insertLifeChapter).mockResolvedValue({ memoryId: 'mem-lc', written: true })
  vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'x', delivered: { inbox: true, telegram: true } } })
})
afterEach(() => {
  delete process.env.KAIROS_LIFE_CHAPTERS
  delete process.env.KAIROS_LIFE_CHAPTER_LINE
})

describe('life_chapter plan', () => {
  it('flag off: plans nothing and calls no data function', async () => {
    delete process.env.KAIROS_LIFE_CHAPTERS
    expect(await lifeChapterHandler.plan(USER, DUE)).toEqual([])
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
    expect(data.listWeeklyReviewsOverlapping).not.toHaveBeenCalled()
    expect(readKairosPredictions).not.toHaveBeenCalled()
  })

  it.each([['day 1 before noon', '2026-10-01T11:59:00Z'], ['day 4', '2026-10-04T13:00:00Z'], ['mid-month', '2026-10-15T13:00:00Z']])(
    'not due (%s): nothing', async (_l, iso) => {
      expect(await lifeChapterHandler.plan(USER, new Date(iso))).toEqual([])
      expect(hasJobWithKeyLike).not.toHaveBeenCalled()
    })

  it('one attempt per month: an existing job of any status → nothing', async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValue(true)
    expect(await lifeChapterHandler.plan(USER, DUE)).toEqual([])
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'life_chapter', KEY)
    expect(data.listWeeklyReviewsOverlapping).not.toHaveBeenCalled()
  })

  it('thin month (<3 citable ids, Aether not counted): nothing', async () => {
    vi.mocked(data.listGoalsTouchedBetween).mockResolvedValue([])
    vi.mocked(data.findAetherNarrativeBefore)
      .mockResolvedValueOnce({ id: 'ae-1', narrative: 'start', at: DUE })
      .mockResolvedValueOnce({ id: 'ae-2', narrative: 'end', at: DUE })
    expect(await lifeChapterHandler.plan(USER, DUE)).toEqual([])
  })

  it('due with enough evidence: one 36-hour job for the previous month, only in-month items citable', async () => {
    const [spec] = await lifeChapterHandler.plan(USER, DUE)
    expect(spec).toMatchObject({ kind: 'life_chapter', externalKey: KEY, deadlineMinutes: 36 * 60, dominionId: null })
    expect(spec.input.validMemoryIds).toEqual(['rev-1', PRED_ID, 'goal-1'])
    expect(spec.input.prompt).toContain('Month: 2026-09')
    expect(spec.input.prompt).toContain(`[${PRED_ID}] R1 wrong`)
    expect(spec.input.prompt).not.toContain('pred-old')
    expect(spec.input.context).toMatchObject({ month: '2026-09', windowStart: '2026-09-01T00:00:00.000Z' })
    expect(data.listWeeklyReviewsOverlapping).toHaveBeenCalledWith(USER, new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'), 6)
  })

  it('a failing source is dropped, not the month', async () => {
    vi.mocked(listBeliefDiffOps).mockRejectedValue(new Error('boom'))
    const [spec] = await lifeChapterHandler.plan(USER, DUE)
    expect(spec.externalKey).toBe(KEY)
  })
})

describe('life_chapter apply', () => {
  it('writes one grounded chapter, dropping ungrounded items; no reason key; no notice in observe', async () => {
    const res = await lifeChapterHandler.apply(job(), answer(), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['mem-lc'], output: { turningPoints: 1, whatChanged: 1, dropped: 1 } })
    const [, values] = vi.mocked(data.insertLifeChapter).mock.calls[0]
    expect(values.month).toBe('2026-09')
    expect(values.chapter.turningPoints[0].evidenceIds).toEqual(['goal-1'])
    expect(values.chapter.citations).toEqual(['goal-1', PRED_ID])
    expect(values.chapter).not.toHaveProperty('reason')
    expect(values.chapter.unresolved).toEqual(['Auth still open.'])
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
  })

  it('already recorded: returns the row, writes nothing', async () => {
    vi.mocked(data.findLifeChapter).mockResolvedValue({ id: 'mem-old', externalKey: KEY, chapter: null, createdAt: DUE })
    const res = await lifeChapterHandler.apply(job(), answer(), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: ['mem-old'], output: { alreadyRecorded: true, answeredBy: 'routine' } })
    expect(data.insertLifeChapter).not.toHaveBeenCalled()
  })

  it('rejects only when nothing grounds or nothing parses', async () => {
    const none = await lifeChapterHandler.apply(job(), answer({ turningPoints: [{ what: 'x', evidenceIds: ['nope'] }], whatChanged: [] }), 'routine')
    expect(none).toMatchObject({ ok: false })
    expect((none as { reason: string }).reason).toMatch(/^ungrounded/)
    const bad = await lifeChapterHandler.apply(job(), 'not json at all', 'routine')
    expect((bad as { reason: string }).reason).toMatch(/^parse_failed/)
    const noUnresolved = await lifeChapterHandler.apply(job(), answer({ unresolved: undefined }), 'routine')
    expect(noUnresolved.ok).toBe(false)
    expect(data.insertLifeChapter).not.toHaveBeenCalled()
  })

  it('bad context and flag switched off before the answer write nothing', async () => {
    expect((await lifeChapterHandler.apply(job({ input: { system: 's', prompt: 'p' } }), answer(), 'routine')).ok).toBe(false)
    delete process.env.KAIROS_LIFE_CHAPTERS
    expect(await lifeChapterHandler.apply(job(), answer(), 'routine')).toMatchObject({ ok: true, memoryIds: [] })
    expect(data.insertLifeChapter).not.toHaveBeenCalled()
  })

  it('mode 1 without the line flag: no notice; with it: one force:false notice per new row', async () => {
    process.env.KAIROS_LIFE_CHAPTERS = '1'
    await lifeChapterHandler.apply(job(), answer(), 'routine')
    expect(deliverKairosSpeak).not.toHaveBeenCalled()

    process.env.KAIROS_LIFE_CHAPTER_LINE = '1'
    const res = await lifeChapterHandler.apply(job(), answer(), 'routine')
    expect(deliverKairosSpeak).toHaveBeenCalledTimes(1)
    const [uid, input] = vi.mocked(deliverKairosSpeak).mock.calls[0]
    expect(uid).toBe(USER)
    expect(input).toMatchObject({ title: 'Chapter · September 2026', kind: 'notify', urgency: 'low', force: false, opsAlert: false, externalId: 'kairos-chapter:2026-09' })
    expect(input.message).toContain('Ask me for the full chapter.')
    expect(res).toMatchObject({ ok: true, output: { notice: 'delivered' } })

    vi.mocked(data.insertLifeChapter).mockResolvedValue({ memoryId: 'mem-lc', written: false })
    await lifeChapterHandler.apply(job(), answer(), 'routine')
    expect(deliverKairosSpeak).toHaveBeenCalledTimes(1)
  })

  it('line flag alone (observe) never speaks; a blocked notice still keeps the chapter', async () => {
    process.env.KAIROS_LIFE_CHAPTER_LINE = '1'
    await lifeChapterHandler.apply(job(), answer(), 'routine')
    expect(deliverKairosSpeak).not.toHaveBeenCalled()

    process.env.KAIROS_LIFE_CHAPTERS = '1'
    vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 429, body: { error: 'awaiting reply' } })
    const res = await lifeChapterHandler.apply(job(), answer(), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['mem-lc'], output: { notice: 'blocked' } })
  })

  it('has no fallback (no paid call)', async () => {
    expect(await lifeChapterHandler.fallback(job())).toEqual({ ok: false, reason: 'no fallback — a missed month is fine' })
  })
})
