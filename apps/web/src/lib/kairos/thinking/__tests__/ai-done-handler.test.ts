import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/ai-done', () => ({ writeAiDoneCards: vi.fn() }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/ai-done/gather', () => ({ gatherAiDone: vi.fn() }))

import { writeAiDoneCards } from '@/lib/data/ai-done'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { gatherAiDone } from '@/lib/kairos/ai-done/gather'
import type { AiDoneJobInput } from '@/lib/kairos/ai-done/prompt'
import { routineAllows } from '@/lib/kairos/routines/catalog'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { PLANNED_THINKING_KINDS, SWEEP_FALLBACK_KINDS, SWEEP_PLAN_SKIP_KINDS } from '../queue'
import { aiDoneHandler, aiDoneJobKey, aiDoneMinutesLeft } from '../handlers/ai-done'

const USER = 'user-1'
// 16:30 London (BST).
const NOW = new Date('2026-10-08T15:30:00Z')
const AT = new Date('2026-10-08T13:00:00Z')

const INPUT: AiDoneJobInput = {
  day: '2026-10-08',
  sessions: [{ h: 'S1', id: 'm-1', repo: 'shadow_app_triad', dominion: 'Shadow Apps', title: 'triad', summary: 'tiles', body: '', client: 'claude', createdAt: AT }],
  digests: [],
  boards: [{ h: 'B1', projectId: 'p-1', name: 'Board', labels: [{ id: 'l-1', name: 'repo:triad' }], titles: [], cards: [], sessions: ['S1'] }],
}

function job(over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: 'job-1', userId: USER, kind: 'ai_done', dominionId: null, externalKey: 'ai_done:2026-10-08', status: 'claimed',
    input: {
      system: 's', prompt: 'p',
      context: {
        v: 1, day: '2026-10-08',
        sessions: [{ h: 'S1', id: 'm-1', repo: 'shadow_app_triad', dominion: 'Shadow Apps' }],
        boards: [{ h: 'B1', projectId: 'p-1', name: 'Board', titles: [], labels: [{ id: 'l-1', name: 'repo:triad' }], sessions: ['S1'] }],
      },
    },
    output: null, claimedBy: null, claimToken: null, claimedAt: null, deadlineAt: NOW, completedAt: null,
    attempts: 0, error: null, createdAt: NOW, updatedAt: NOW,
    ...over,
  }
}

const answer = '```json\n' + JSON.stringify({
  boards: [{ boardHandle: 'B1', cards: [{ title: 'Triad Polish', description: '', repo: 'triad', groups: [{ name: 'Checklist', items: ['Session tiles'] }], sessions: ['S1'] }] }],
}) + '\n```'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KAIROS_AI_DONE', '1')
  vi.mocked(gatherAiDone).mockResolvedValue(INPUT)
  vi.mocked(writeAiDoneCards).mockResolvedValue({ status: 'written', created: [{ id: 't-1', name: 'Triad Polish' }] })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ai_done wiring', () => {
  it('is a deep brain kind planned by claims and the sweep, with no paid fallback', () => {
    expect(PLANNED_THINKING_KINDS).toContain('ai_done')
    expect(SWEEP_PLAN_SKIP_KINDS).not.toContain('ai_done')
    expect(SWEEP_FALLBACK_KINDS).not.toContain('ai_done')
    expect(routineAllows('brain', 'ai_done')).toBe(true)
    expect(routineAllows('pulse', 'ai_done')).toBe(false)
  })
})

describe('ai_done plan', () => {
  it('one job per London day, due 18:30 London', async () => {
    const [spec, ...rest] = await aiDoneHandler.plan(USER, NOW)
    expect(rest).toEqual([])
    expect(spec).toMatchObject({ kind: 'ai_done', dominionId: null, externalKey: 'ai_done:2026-10-08', deadlineMinutes: 120 })
    expect(spec!.externalKey).toBe(aiDoneJobKey('2026-10-08'))
    expect(spec!.input.validMemoryIds).toEqual([])
    expect(spec!.input.prompt).toContain('BEGIN BOARD DATA')
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'ai_done', 'ai_done:2026-10-08')
    expect(gatherAiDone).toHaveBeenCalledWith(USER, NOW)
  })

  it('only from 16:00 to 17:59 London (clock-change safe)', () => {
    expect(aiDoneMinutesLeft(new Date('2026-10-08T14:59:00Z'))).toBe(0)
    expect(aiDoneMinutesLeft(new Date('2026-10-08T15:00:00Z'))).toBe(150)
    expect(aiDoneMinutesLeft(new Date('2026-10-08T16:59:00Z'))).toBe(31)
    expect(aiDoneMinutesLeft(new Date('2026-10-08T17:00:00Z'))).toBe(0)
    expect(aiDoneMinutesLeft(new Date('2026-12-08T16:10:00Z'))).toBe(140)
  })

  it('plans nothing outside the window, when switched off, already planned today, or with nothing new', async () => {
    expect(await aiDoneHandler.plan(USER, new Date('2026-10-08T09:00:00Z'))).toEqual([])
    vi.stubEnv('KAIROS_AI_DONE', '0')
    expect(await aiDoneHandler.plan(USER, NOW)).toEqual([])
    expect(gatherAiDone).not.toHaveBeenCalled()
    vi.stubEnv('KAIROS_AI_DONE', '1')
    vi.mocked(hasJobWithKeyLike).mockResolvedValueOnce(true)
    expect(await aiDoneHandler.plan(USER, NOW)).toEqual([])
    expect(gatherAiDone).not.toHaveBeenCalled()
    vi.mocked(gatherAiDone).mockResolvedValueOnce(null)
    expect(await aiDoneHandler.plan(USER, NOW)).toEqual([])
  })
})

describe('ai_done apply', () => {
  it('grounds the answer and files the cards on the board', async () => {
    const out = await aiDoneHandler.apply(job(), answer, 'routine')
    expect(out).toEqual({ ok: true, memoryIds: [], output: { cards: 1, boards: { 'p-1': 1 }, dropped: { cards: 0, alreadyOn: 0, sessions: 0 }, answeredBy: 'routine' } })
    expect(writeAiDoneCards).toHaveBeenCalledWith({
      projectId: 'p-1',
      userId: USER,
      jobId: 'job-1',
      day: '2026-10-08',
      cards: [{ title: 'Triad Polish', description: '', repo: 'shadow_app_triad', labelIds: ['l-1'], groups: [{ name: 'Checklist', items: ['Session tiles'] }], sessionIds: ['m-1'] }],
    })
  })

  it('reports a refused board write without failing the job', async () => {
    vi.mocked(writeAiDoneCards).mockResolvedValue({ status: 'switched_off' })
    expect(await aiDoneHandler.apply(job(), answer, 'routine')).toMatchObject({ ok: true, output: { cards: 0, boards: { 'p-1': 'switched_off' } } })
  })

  it('writes nothing when the mind switch went off, on a bad answer, or a malformed job', async () => {
    vi.stubEnv('KAIROS_AI_DONE', '0')
    expect(await aiDoneHandler.apply(job(), answer, 'routine')).toMatchObject({ ok: true, output: { skipped: 'switched_off' } })
    vi.stubEnv('KAIROS_AI_DONE', '1')
    expect(await aiDoneHandler.apply(job(), 'sorry, no', 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed/) })
    expect(await aiDoneHandler.apply(job({ input: { system: 's', prompt: 'p' } }), answer, 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^bad_job/) })
    expect(writeAiDoneCards).not.toHaveBeenCalled()
  })

  it('has no paid fallback', async () => {
    expect(await aiDoneHandler.fallback(job())).toEqual({ ok: false, reason: 'no fallback — the day is skipped' })
  })
})
