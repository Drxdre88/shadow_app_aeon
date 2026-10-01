import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import type { WeeklyReviewInputs } from '@/lib/kairos/weekly-review/inputs'

const m = vi.hoisted(() => ({
  hasJobWithKeyLike: vi.fn(),
  captureMemory: vi.fn(),
  getProviderForUser: vi.fn(),
  deliverKairosSpeak: vi.fn(),
  writeCronFailureTrace: vi.fn(),
  gatherWeeklyReviewInputs: vi.fn(),
}))

vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: m.hasJobWithKeyLike }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: m.captureMemory }))
vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: m.getProviderForUser }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))
vi.mock('@/lib/kairos/speak', () => ({ deliverKairosSpeak: m.deliverKairosSpeak }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronFailureTrace: m.writeCronFailureTrace }))
// The real inputs module is kept for its pure helpers; its DB readers are stubbed.
vi.mock('@/lib/data/ask', () => ({}))
vi.mock('@/lib/data/beliefs', () => ({}))
vi.mock('@/lib/data/dominions', () => ({}))
vi.mock('@/lib/data/memory-candidates', () => ({}))
vi.mock('@/lib/data/memory-ops', () => ({}))
vi.mock('@/lib/data/recipes', () => ({}))
vi.mock('@/lib/kairos/weekly-review/inputs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kairos/weekly-review/inputs')>()),
  gatherWeeklyReviewInputs: m.gatherWeeklyReviewInputs,
}))

import { AiCredentialMissingError } from '@/lib/ai/router'
import { reviewWindow } from '@/lib/kairos/weekly-review/inputs'
import {
  applyWeeklyReview,
  fallbackWeeklyReview,
  isWeeklyReviewDue,
  weeklyReviewHandler,
} from '../handlers/weekly-review'

const USER = 'user-1'
const MONDAY = new Date('2026-10-05T05:00:00Z')
const DOM = '11111111-1111-4111-8111-111111111111'
const EV = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003']

function inputs(over: Partial<WeeklyReviewInputs> = {}): WeeklyReviewInputs {
  return {
    window: reviewWindow(MONDAY),
    dominions: [{ id: DOM, name: 'Swarm' }],
    boardPages: [
      { id: EV[0], kind: 'board_day', title: 'day', label: '2026-10-01', finished: 2, created: null, stale: null, topTitles: ['Card A'] },
    ],
    objectives: [{ dominionId: DOM, dominionName: 'Swarm', title: 'Ship P2', status: 'active', lastTouched: '2026-09-01', targetDate: null }],
    beliefChanges: [{ id: EV[1], title: 'New claim', change: 'created', mind: 'own', domain: 'Swarm' }],
    memoryOps: null,
    mindCompare: { id: EV[2], title: 'Mind compare', summary: 'agree 3', createdAt: '2026-10-04T00:00:00Z' },
    asks: [],
    asksAnswered: 0,
    health: [],
    errors: [],
    ...over,
  }
}

const SUMMARY = 'A steady week. The board moved on Swarm but the P2 objective barely moved, and my own mind drifted a little.'

function action(i: number, evidenceIds: string[] = [EV[i % 3]], dominion: string | null = 'swarm') {
  return { title: `Action ${i}`, why: `Because ${i}`, evidenceIds, dominion }
}

function modelText(over: Record<string, unknown> = {}) {
  const body = { summary: SUMMARY, wins: ['Cards shipped'], drift: ['P2 stalled'], actions: [action(0), action(1)], ...over }
  return '```json\n' + JSON.stringify(body) + '\n```'
}

async function planOne(): Promise<ThinkingJobSpec> {
  const specs = await weeklyReviewHandler.plan(USER, MONDAY)
  expect(specs).toHaveLength(1)
  return specs[0]
}

function jobFrom(spec: ThinkingJobSpec): ThinkingJobRow {
  const now = new Date()
  return {
    id: 'job-1', userId: USER, kind: spec.kind, dominionId: null, externalKey: spec.externalKey, status: 'claimed',
    input: spec.input, output: null, claimedBy: 'routine', claimToken: 't', claimedAt: now, deadlineAt: now,
    completedAt: null, attempts: 1, error: null, createdAt: now, updatedAt: now,
  }
}

// captureMemory with the real (source, externalId) dedup semantics.
let store: Map<string, string>
let delivered: Set<string>

beforeEach(() => {
  vi.clearAllMocks()
  store = new Map()
  delivered = new Set()
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.gatherWeeklyReviewInputs.mockResolvedValue(inputs())
  m.captureMemory.mockImplementation(async (_u: string, input: { source: string; sourceMetadata: { externalId: string } }) => {
    const key = `${input.source}:${input.sourceMetadata.externalId}`
    const existing = store.get(key)
    if (existing) return { memory: { id: existing }, created: false }
    const id = `mem-${store.size + 1}`
    store.set(key, id)
    return { memory: { id }, created: true }
  })
  m.deliverKairosSpeak.mockImplementation(async (_u: string, input: { externalId: string }) => {
    if (delivered.has(input.externalId)) {
      return { status: 200, body: { id: 'speak', delivered: { inbox: false, telegram: false }, alreadyDelivered: true } }
    }
    delivered.add(input.externalId)
    return { status: 200, body: { id: 'speak', delivered: { inbox: true, telegram: true } } }
  })
})

describe('weekly review plan gating', () => {
  it('is due on Mondays from 05:00Z only', () => {
    expect(isWeeklyReviewDue(new Date('2026-10-05T04:59:59Z'))).toBe(false)
    expect(isWeeklyReviewDue(MONDAY)).toBe(true)
    expect(isWeeklyReviewDue(new Date('2026-10-05T23:30:00Z'))).toBe(true)
    expect(isWeeklyReviewDue(new Date('2026-10-04T12:00:00Z'))).toBe(false)
    expect(isWeeklyReviewDue(new Date('2026-10-06T06:00:00Z'))).toBe(false)
  })

  it('plans nothing outside the Monday window and never gathers inputs there', async () => {
    expect(await weeklyReviewHandler.plan(USER, new Date('2026-10-05T04:00:00Z'))).toEqual([])
    expect(await weeklyReviewHandler.plan(USER, new Date('2026-10-06T06:00:00Z'))).toEqual([])
    expect(m.hasJobWithKeyLike).not.toHaveBeenCalled()
    expect(m.gatherWeeklyReviewInputs).not.toHaveBeenCalled()
  })

  it('plans one user-wide job keyed on the reviewed ISO week, 6h deadline', async () => {
    const spec = await planOne()
    expect(spec).toMatchObject({ kind: 'weekly_review', dominionId: null, externalKey: 'weekly_review:2026-W40', deadlineMinutes: 360 })
    expect(spec.input.validMemoryIds?.sort()).toEqual([...EV].sort())
    expect(spec.input.prompt).toContain(`[${EV[0]}]`)
    expect(spec.input.prompt).toContain('Ship P2')
    expect(spec.input.context).toMatchObject({ isoWeek: '2026-W40', dominions: [{ id: DOM, name: 'Swarm' }] })
    expect(m.hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'weekly_review', 'weekly_review:2026-W40')
  })

  it('plans once per week: an existing job short-circuits before the input gather', async () => {
    m.hasJobWithKeyLike.mockResolvedValue(true)
    expect(await weeklyReviewHandler.plan(USER, MONDAY)).toEqual([])
    expect(m.gatherWeeklyReviewInputs).not.toHaveBeenCalled()
  })

  it('skips a week with no signal at all', async () => {
    m.gatherWeeklyReviewInputs.mockResolvedValue(inputs({ boardPages: [], objectives: [], beliefChanges: [], mindCompare: null }))
    expect(await weeklyReviewHandler.plan(USER, MONDAY)).toEqual([])
  })
})

describe('weekly review apply', () => {
  it('writes grounded proposals, one observation, and delivers the summary once', async () => {
    const job = jobFrom(await planOne())
    const out = await applyWeeklyReview(job, modelText(), 'routine')
    expect(out).toEqual({ ok: true, memoryIds: ['mem-3', 'mem-1', 'mem-2'] })

    const [proposal] = m.captureMemory.mock.calls[0].slice(1)
    expect(proposal).toMatchObject({
      title: 'Action 0',
      type: 'inbound',
      streamClass: 'agentic',
      dominionId: DOM,
      tags: ['proposal', 'review_action'],
      links: [{ type: 'refers_to', target: EV[0], target_kind: 'memory' }],
      sourceMetadata: { introspection: true, kind: 'review_action', status: 'pending', citations: [EV[0]], answeredBy: 'routine' },
    })
    const observation = m.captureMemory.mock.calls[2][1]
    expect(observation).toMatchObject({
      title: 'Weekly review · 2026-W40',
      type: 'observation',
      sourceMetadata: { kind: 'weekly_review', isoWeek: '2026-W40', summary: SUMMARY, proposalIds: ['mem-1', 'mem-2'] },
    })
    expect(observation.links.map((l: { target: string }) => l.target)).toEqual(['mem-1', 'mem-2', EV[0], EV[1]])

    expect(m.deliverKairosSpeak).toHaveBeenCalledTimes(1)
    const [, speak] = m.deliverKairosSpeak.mock.calls[0]
    expect(speak).toMatchObject({
      title: 'Weekly review · 2026-W40',
      kind: 'notify',
      digest: true,
      externalId: 'kairos-weekly:2026-W40',
    })
    expect(speak.message.startsWith(SUMMARY)).toBe(true)
    expect(speak.message).toContain('2 proposed actions')
  })

  it('drops actions with no grounded evidence and unknown dominions map to null', async () => {
    const job = jobFrom(await planOne())
    const text = modelText({
      actions: [
        action(0, ['not-an-id', EV[1], EV[1]], 'Nowhere'),
        action(1, ['made-up']),
        action(2, []),
      ],
    })
    const out = await applyWeeklyReview(job, text, 'routine')
    expect(out.ok).toBe(true)
    const proposals = m.captureMemory.mock.calls.filter(([, i]) => i.type === 'inbound')
    expect(proposals).toHaveLength(1)
    expect(proposals[0][1].sourceMetadata.citations).toEqual([EV[1]])
    expect(proposals[0][1].dominionId).toBeNull()
    const observation = m.captureMemory.mock.calls.find(([, i]) => i.type === 'observation')![1]
    expect(observation.sourceMetadata.droppedActions).toBe(2)
  })

  it('caps proposals at five', async () => {
    const job = jobFrom(await planOne())
    const out = await applyWeeklyReview(job, modelText({ actions: Array.from({ length: 8 }, (_, i) => action(i)) }), 'routine')
    expect(out.ok && out.memoryIds).toHaveLength(6)
    expect(m.captureMemory.mock.calls.filter(([, i]) => i.type === 'inbound')).toHaveLength(5)
  })

  it('still writes the review when no action is grounded', async () => {
    const job = jobFrom(await planOne())
    const out = await applyWeeklyReview(job, modelText({ actions: [] }), 'routine')
    expect(out).toEqual({ ok: true, memoryIds: ['mem-1'] })
    expect(m.deliverKairosSpeak.mock.calls[0][1].message).toBe(SUMMARY)
  })

  it('is idempotent: a re-apply reuses the rows and the speak fans out once', async () => {
    const job = jobFrom(await planOne())
    const first = await applyWeeklyReview(job, modelText(), 'routine')
    const second = await applyWeeklyReview(job, modelText(), 'api')
    expect(second).toEqual(first)
    expect(store.size).toBe(3)
    expect(m.deliverKairosSpeak).toHaveBeenCalledTimes(2)
    expect(new Set(m.deliverKairosSpeak.mock.calls.map(([, i]) => i.externalId))).toEqual(new Set(['kairos-weekly:2026-W40']))
    expect(delivered.size).toBe(1)
    expect(m.writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('traces a blocked delivery without failing the job', async () => {
    m.deliverKairosSpeak.mockResolvedValue({ status: 429, body: { error: 'throttled' } })
    const job = jobFrom(await planOne())
    expect((await applyWeeklyReview(job, modelText(), 'routine')).ok).toBe(true)
    expect(m.writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'weekly-review', reason: 'delivery_blocked' }))
  })

  it.each([
    ['a markdown heading', '# Week\nSomething happened this week on the board.'],
    ['a URL', 'Read more at https://example.com about this week of work.'],
    ['an over-long summary', 'x'.repeat(901)],
  ])('rejects a summary with %s and writes nothing', async (_label, summary) => {
    const job = jobFrom(await planOne())
    const out = await applyWeeklyReview(job, modelText({ summary }), 'routine')
    expect(out.ok).toBe(false)
    expect(m.captureMemory).not.toHaveBeenCalled()
    expect(m.deliverKairosSpeak).not.toHaveBeenCalled()
  })

  it('does not repair on the routine path and rejects a bad context', async () => {
    const job = jobFrom(await planOne())
    expect((await applyWeeklyReview(job, 'not json', 'routine')).ok).toBe(false)
    expect(m.getProviderForUser).not.toHaveBeenCalled()
    const bad = { ...job, input: { ...job.input, context: {} } }
    expect(await applyWeeklyReview(bad, modelText(), 'routine')).toEqual({ ok: false, reason: 'bad_job: invalid weekly_review job context' })
  })
})

describe('weekly review fallback', () => {
  it('asks the heavy tier, repairs once, then applies as api', async () => {
    const ask = vi.fn().mockResolvedValueOnce({ text: 'garbage' }).mockResolvedValueOnce({ text: modelText() })
    m.getProviderForUser.mockResolvedValue({ ask })
    const job = jobFrom(await planOne())
    const out = await fallbackWeeklyReview(job)
    expect(out.ok).toBe(true)
    expect(m.getProviderForUser).toHaveBeenCalledWith(USER, 'heavy')
    expect(ask.mock.calls[0][0]).toMatchObject({ system: job.input.system, prompt: job.input.prompt })
    expect(ask.mock.calls[1][0].prompt).toContain(EV[0])
    expect(m.captureMemory.mock.calls[0][1].sourceMetadata.answeredBy).toBe('api')
    expect(m.deliverKairosSpeak).toHaveBeenCalledTimes(1)
  })

  it('reports a missing BYOK credential instead of throwing', async () => {
    m.getProviderForUser.mockRejectedValue(new AiCredentialMissingError('anthropic'))
    const job = jobFrom(await planOne())
    expect(await fallbackWeeklyReview(job)).toEqual({ ok: false, reason: 'no BYOK credential' })
  })

  it('rejects when the repair also fails, writing nothing', async () => {
    m.getProviderForUser.mockResolvedValue({ ask: vi.fn().mockResolvedValue({ text: 'still bad' }) })
    const job = jobFrom(await planOne())
    expect((await fallbackWeeklyReview(job)).ok).toBe(false)
    expect(m.captureMemory).not.toHaveBeenCalled()
  })
})
