import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn() }))
vi.mock('@/lib/data/labels', () => ({ findLabels: vi.fn() }))
vi.mock('@/lib/data/card-triage', () => ({
  findCardTriageBoard: vi.fn(),
  findLabelIdsForTasks: vi.fn(),
  listTriageBoards: vi.fn(),
  listTriagePool: vi.fn(),
  listUntriagedCards: vi.fn(),
  writeCardTriages: vi.fn(),
}))

import { listJobs } from '@/lib/data/thinking-jobs'
import { findLabels } from '@/lib/data/labels'
import {
  findCardTriageBoard,
  findLabelIdsForTasks,
  listTriageBoards,
  listTriagePool,
  listUntriagedCards,
  writeCardTriages,
} from '@/lib/data/card-triage'
import { routineAllows } from '@/lib/kairos/routines/catalog'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { PLANNED_THINKING_KINDS, SWEEP_PLAN_SKIP_KINDS } from '../queue'
import {
  TRIAGE_BATCH,
  TRIAGE_MAX_ATTEMPTS,
  blockedTriageCards,
  cardTriageHandler,
  cardTriageKey,
} from '../handlers/card-triage'

const USER = 'user-1'
const NOW = new Date('2026-10-05T14:50:00Z')
const BOARD = { id: 'p-1', name: 'Aeon' }

const fresh = (id: string, name = `Card ${id}`) => ({ id, name, description: null, priority: 'medium', createdAt: NOW })

function job(over: Partial<ThinkingJobRow>, cardIds: string[] = []): ThinkingJobRow {
  return {
    id: 'job-1', userId: USER, kind: 'card_triage', dominionId: null, externalKey: 'k', status: 'queued',
    input: {
      system: 's', prompt: 'p',
      context: { v: 1, projectId: 'p-1', labels: [{ h: 'L1', id: 'lab-bug' }], cards: cardIds.map((id, i) => ({ h: `N${i + 1}`, id, priority: 'medium', labelIds: [], candidates: [{ h: 'E1', id: 'old-1', name: 'Old login bug' }] })) },
    },
    output: null, claimedBy: null, claimToken: null, claimedAt: null, deadlineAt: NOW, completedAt: null,
    attempts: 0, error: null, createdAt: NOW, updatedAt: NOW,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listTriageBoards).mockResolvedValue([BOARD])
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(listUntriagedCards).mockResolvedValue([fresh('c-1', 'Login bug on mobile'), fresh('c-2')])
  vi.mocked(findLabels).mockResolvedValue([{ id: 'lab-bug', projectId: 'p-1', name: 'Bug', color: 'red', createdAt: NOW }])
  vi.mocked(listTriagePool).mockResolvedValue([{ id: 'old-1', name: 'Mobile login bug', description: null, status: 'todo', completedAt: null }])
  vi.mocked(findLabelIdsForTasks).mockResolvedValue(new Map([['c-2', ['lab-bug']]]))
  vi.mocked(findCardTriageBoard).mockResolvedValue({ id: 'p-1', userId: USER, name: 'Aeon', settings: { kairosTriage: 'on' } })
  vi.mocked(writeCardTriages).mockImplementation(async (_p, _j, entries) => entries.length)
})

describe('card_triage wiring', () => {
  it('is a deep brain kind planned by claims and the hourly sweep', () => {
    expect(PLANNED_THINKING_KINDS).toContain('card_triage')
    expect(SWEEP_PLAN_SKIP_KINDS).not.toContain('card_triage')
    expect(routineAllows('brain', 'card_triage')).toBe(true)
    expect(routineAllows('pulse', 'card_triage')).toBe(false)
  })
})

describe('card_triage plan', () => {
  it('no switched-on boards → nothing, and no job scan', async () => {
    vi.mocked(listTriageBoards).mockResolvedValue([])
    expect(await cardTriageHandler.plan(USER, NOW)).toEqual([])
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('one batch job per board with handles, candidates and an hour-bucketed key', async () => {
    const [spec, ...rest] = await cardTriageHandler.plan(USER, NOW)
    expect(rest).toEqual([])
    expect(spec.kind).toBe('card_triage')
    expect(spec.externalKey).toBe(cardTriageKey('p-1', 'c-1', NOW))
    expect(spec.externalKey).toBe('card_triage:p-1:c-1:2026-10-05T14')
    expect(spec.input.validMemoryIds).toEqual([])
    const ctx = spec.input.context as { cards: Array<{ id: string; labelIds: string[]; candidates: Array<{ id: string }> }> }
    expect(ctx.cards.map((c) => c.id)).toEqual(['c-1', 'c-2'])
    expect(ctx.cards[0].candidates.map((c) => c.id)).toEqual(['old-1'])
    expect(ctx.cards[1].labelIds).toEqual(['lab-bug'])
    expect(spec.input.system).toContain('BEGIN CARD DATA')
    expect(listUntriagedCards).toHaveBeenCalledWith('p-1', new Date(NOW.getTime() - 48 * 3600_000), expect.any(Number))
  })

  it('skips cards already in an open or answered job, caps the batch, and plans nothing when all are taken', async () => {
    vi.mocked(listUntriagedCards).mockResolvedValue(Array.from({ length: TRIAGE_BATCH + 4 }, (_, i) => fresh(`c-${i}`)))
    vi.mocked(listJobs).mockResolvedValue([job({ status: 'claimed' }, ['c-0'])])
    const [spec] = await cardTriageHandler.plan(USER, NOW)
    const ids = (spec.input.context as { cards: Array<{ id: string }> }).cards.map((c) => c.id)
    expect(ids).toHaveLength(TRIAGE_BATCH)
    expect(ids[0]).toBe('c-1')

    vi.mocked(listUntriagedCards).mockResolvedValue([fresh('c-0')])
    expect(await cardTriageHandler.plan(USER, NOW)).toEqual([])
  })

  it('offers an expired batch again, but only up to the attempt cap', () => {
    const expired = (n: number) => Array.from({ length: n }, () => job({ status: 'expired' }, ['c-1']))
    expect(blockedTriageCards(expired(TRIAGE_MAX_ATTEMPTS - 1)).has('c-1')).toBe(false)
    expect(blockedTriageCards(expired(TRIAGE_MAX_ATTEMPTS)).has('c-1')).toBe(true)
    expect(blockedTriageCards([job({ status: 'done' }, ['c-1'])]).has('c-1')).toBe(true)
    expect(blockedTriageCards([job({ status: 'failed' }, ['c-1'])]).has('c-1')).toBe(true)
  })
})

describe('card_triage apply', () => {
  const answer = '```json\n' + JSON.stringify({
    cards: [{ card: 'N1', labels: [{ label: 'L1', reason: 'A defect' }], priority: { value: 'urgent', reason: 'Blocks sign-in' }, duplicates: [{ card: 'E1', reason: 'Same bug' }] }],
  }) + '\n```'

  it('writes grounded suggestions onto each card and reports counts', async () => {
    const out = await cardTriageHandler.apply(job({ id: 'job-9' }, ['c-1', 'c-2']), answer, 'routine')
    expect(out).toEqual({ ok: true, memoryIds: [], output: { cards: 2, suggestions: 3, answeredBy: 'routine' } })
    const [projectId, jobId, entries] = vi.mocked(writeCardTriages).mock.calls[0]
    expect(projectId).toBe('p-1')
    expect(jobId).toBe('job-9')
    expect(entries[0]).toMatchObject({
      taskId: 'c-1',
      triage: {
        jobId: 'job-9',
        labels: [{ id: 'lab-bug', status: 'pending' }],
        priority: { value: 'urgent', status: 'pending' },
        duplicates: [{ taskId: 'old-1', name: 'Old login bug', status: 'pending' }],
      },
    })
    expect(entries[1]).toMatchObject({ taskId: 'c-2', triage: { labels: [], priority: null, duplicates: [] } })
  })

  it('writes nothing when the owner switched sorting off or the board changed hands', async () => {
    vi.mocked(findCardTriageBoard).mockResolvedValue({ id: 'p-1', userId: USER, name: 'Aeon', settings: {} })
    expect(await cardTriageHandler.apply(job({}, ['c-1']), answer, 'routine')).toMatchObject({ ok: true, output: { skipped: 'switched_off' } })
    vi.mocked(findCardTriageBoard).mockResolvedValue({ id: 'p-1', userId: 'someone-else', name: 'Aeon', settings: { kairosTriage: 'on' } })
    expect(await cardTriageHandler.apply(job({}, ['c-1']), answer, 'routine')).toMatchObject({ ok: true, output: { skipped: 'switched_off' } })
    expect(writeCardTriages).not.toHaveBeenCalled()
  })

  it('rejects unparseable answers and malformed jobs without writing', async () => {
    expect(await cardTriageHandler.apply(job({}, ['c-1']), 'sorry, no', 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed/) })
    expect(await cardTriageHandler.apply(job({ input: { system: 's', prompt: 'p' } }), answer, 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^bad_job/) })
    expect(writeCardTriages).not.toHaveBeenCalled()
  })

  it('has no paid fallback', async () => {
    expect(await cardTriageHandler.fallback(job({}, ['c-1']))).toMatchObject({ ok: false })
  })
})
