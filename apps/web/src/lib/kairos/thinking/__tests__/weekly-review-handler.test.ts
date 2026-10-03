import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import type { WeeklyReviewInputs } from '@/lib/kairos/weekly-review/inputs'

const m = vi.hoisted(() => ({
  hasJobWithKeyLike: vi.fn(),
  captureMemory: vi.fn(),
  getProviderForUser: vi.fn(),
  deliverKairosSpeak: vi.fn(),
  writeCronFailureTrace: vi.fn(),
  gatherWeeklyReviewInputs: vi.fn(),
  loadConscienceBlock: vi.fn(),
  readKairosPromises: vi.fn(),
  createKairosPromises: vi.fn(),
  readKairosPredictions: vi.fn(),
  createKairosPredictions: vi.fn(),
  findCharacterRun: vi.fn(),
}))

vi.mock('@/lib/data/character', () => ({ findCharacterRun: m.findCharacterRun }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: m.readKairosPromises }))
vi.mock('@/lib/kairos/promises/create', () => ({ createKairosPromises: m.createKairosPromises }))
vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: m.readKairosPredictions }))
vi.mock('@/lib/kairos/predictions/create', () => ({ createKairosPredictions: m.createKairosPredictions }))

vi.mock('@/lib/kairos/conscience-context', () => ({ loadConscienceBlock: m.loadConscienceBlock }))
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
vi.mock('@/lib/data/belief-diff', () => ({}))
vi.mock('@/lib/data/ideas', () => ({}))
vi.mock('@/lib/data/goals', () => ({}))
vi.mock('@/lib/kairos/ideas/diversity', () => ({}))
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
  delete process.env.KAIROS_INITIATIVE
  delete process.env.KAIROS_PREDICTIONS
  m.readKairosPredictions.mockResolvedValue({ v: 1, nextSeq: 1, open: [], closed: [] })
  m.createKairosPredictions.mockResolvedValue({ created: [], rejected: [], overflow: 0 })
  m.readKairosPromises.mockResolvedValue({ v: 1, nextSeq: 4, open: [{ seq: 3, outcome: 'Login fix shipped to beta', dueDate: '2026-10-09' }], closed: [] })
  m.createKairosPromises.mockResolvedValue({ created: [], rejected: [], overflow: 0 })
  store = new Map()
  delivered = new Set()
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.gatherWeeklyReviewInputs.mockResolvedValue(inputs())
  m.loadConscienceBlock.mockResolvedValue('')
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

  it('carries the conscience block in the job prompt (so the paid fallback gets it too)', async () => {
    m.loadConscienceBlock.mockResolvedValue('## Conscience (reference data)\n1. Ship small')
    const spec = await planOne()
    expect(m.loadConscienceBlock).toHaveBeenCalledWith(USER)
    const prompt = spec.input.prompt
    expect(prompt).toContain('## Conscience (reference data)\n1. Ship small')
    // Reference data sits before the closing instruction, never after it.
    expect(prompt.indexOf('Conscience')).toBeLessThan(prompt.indexOf('Write the weekly review JSON now.'))
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

describe('weekly review promises (initiative switch)', () => {
  const PROMISES = [{ outcome: 'Swarm P2 objective closed out', dueDate: '2026-10-20', taskId: null }]

  it('off: the prompt never mentions promises and returned promises are ignored', async () => {
    const spec = await planOne()
    expect(spec.input.prompt).not.toContain('PROMISES')
    expect(m.readKairosPromises).not.toHaveBeenCalled()
    const out = await applyWeeklyReview(jobFrom(spec), modelText({ promises: PROMISES }), 'routine')
    expect(out.ok).toBe(true)
    expect(m.createKairosPromises).not.toHaveBeenCalled()
    const observation = m.captureMemory.mock.calls.at(-1)![1]
    expect(observation.sourceMetadata).not.toHaveProperty('promises')
  })

  it('on: the prompt offers up to 3 dated promises with the London window and the open ones', async () => {
    process.env.KAIROS_INITIATIVE = '1'
    const prompt = (await planOne()).input.prompt
    expect(prompt).toContain('up to 3 dated promises')
    expect(prompt).toContain('between 2026-10-06 and 2026-11-02')
    expect(prompt).toContain('P3 due 2026-10-09: Login fix shipped to beta')
    expect(prompt.indexOf('PROMISES')).toBeLessThan(prompt.indexOf('Write the weekly review JSON now.'))
  })

  it('on: persists through createKairosPromises with the weekly_review source and records the result', async () => {
    process.env.KAIROS_INITIATIVE = '1'
    m.createKairosPromises.mockResolvedValue({
      created: [{ id: 'p-1', seq: 4, dueDate: '2026-10-20' }], rejected: [{ index: 1, reason: 'vague_outcome' }], overflow: 0,
    })
    const job = jobFrom(await planOne())
    const out = await applyWeeklyReview(job, modelText({ promises: [...PROMISES, { outcome: 'Explore new ideas for P3', dueDate: '2026-10-20' }] }), 'routine')
    expect(out.ok).toBe(true)
    expect(m.createKairosPromises).toHaveBeenCalledWith(USER, [
      { outcome: 'Swarm P2 objective closed out', dueDate: '2026-10-20', taskId: null },
      { outcome: 'Explore new ideas for P3', dueDate: '2026-10-20' },
    ], { kind: 'weekly_review', jobId: 'job-1', isoWeek: '2026-W40' })
    const observation = m.captureMemory.mock.calls.at(-1)![1]
    expect(observation.sourceMetadata.promises).toEqual({
      created: [{ id: 'p-1', seq: 4, dueDate: '2026-10-20' }], rejected: [{ index: 1, reason: 'vague_outcome' }], overflow: 0,
    })
  })

  it('on: a promise write failure never costs the review', async () => {
    process.env.KAIROS_INITIATIVE = '1'
    m.createKairosPromises.mockRejectedValue(new Error('db down'))
    const out = await applyWeeklyReview(jobFrom(await planOne()), modelText({ promises: PROMISES }), 'routine')
    expect(out.ok).toBe(true)
    expect(m.writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'weekly-review', reason: 'promises_failed' }))
    expect(m.deliverKairosSpeak).toHaveBeenCalledTimes(1)
  })
})

describe('weekly review predictions (KAIROS_PREDICTIONS)', () => {
  const PREDICTIONS = [{ claim: 'The Swarm P2 objective closes before the end of the month', probability: 0.7, dueDate: '2026-10-20', topic: 'delivery' }]
  const settled = (n: number) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`, seq: n, claim: `Claim number ${n} about the board work`, probability: 0.8,
    dueDate: '2026-09-20', topic: 'delivery', dominionId: null, basisIds: [], check: { kind: 'owner_verdict' },
    source: { kind: 'weekly_review', jobId: `j${n}` }, createdAt: '2026-09-10T00:00:00.000Z', status: n === 5 ? 'wrong' : 'right',
    settledAt: '2026-09-25T00:00:00.000Z', settledBy: { kind: 'owner', via: 'session' },
  })

  it('off: no prompt block, no read, no create, no track-record line', async () => {
    const spec = await planOne()
    expect(spec.input.prompt).not.toContain('PREDICTIONS')
    expect(m.readKairosPredictions).not.toHaveBeenCalled()
    await applyWeeklyReview(jobFrom(spec), modelText({ predictions: PREDICTIONS }), 'routine')
    expect(m.createKairosPredictions).not.toHaveBeenCalled()
    const observation = m.captureMemory.mock.calls.at(-1)![1]
    expect(observation.sourceMetadata).not.toHaveProperty('predictions')
    expect(observation.bodyMd).not.toContain('Track record')
  })

  it('on: asks for predictions, persists through the creator and renders the code-built line', async () => {
    process.env.KAIROS_PREDICTIONS = '1'
    m.readKairosPredictions.mockResolvedValue({ v: 1, nextSeq: 6, open: [], closed: [1, 2, 3, 4, 5].map(settled) })
    m.createKairosPredictions.mockResolvedValue({ created: [{ id: 'r-6', seq: 6, dueDate: '2026-10-20', probability: 0.7 }], rejected: [], overflow: 0 })
    const spec = await planOne()
    expect(spec.input.prompt).toContain('PREDICTIONS — you may add up to 3')
    expect(spec.input.prompt).toContain('4 of 5 right')
    const out = await applyWeeklyReview(jobFrom(spec), modelText({ predictions: [...PREDICTIONS, { claim: 7 }] }), 'routine')
    expect(out.ok).toBe(true)
    expect(m.createKairosPredictions).toHaveBeenCalledWith(USER, PREDICTIONS, { kind: 'weekly_review', jobId: 'job-1', isoWeek: '2026-W40' },
      expect.objectContaining({ dominions: [{ id: DOM, name: 'Swarm' }] }))
    const observation = m.captureMemory.mock.calls.at(-1)![1]
    expect(observation.sourceMetadata.predictions.created).toEqual([{ id: 'r-6', seq: 6, dueDate: '2026-10-20', probability: 0.7 }])
    expect(observation.bodyMd).toContain('Track record (90 days): 4 of 5 predictions right (80%)')
    expect(m.deliverKairosSpeak.mock.calls[0]![1].message).toContain('Track record (90 days)')
  })

  it('on: a prediction write failure or a corrupt store never costs the review', async () => {
    process.env.KAIROS_PREDICTIONS = '1'
    m.readKairosPredictions.mockRejectedValue(new Error('corrupt'))
    const spec = await planOne()
    expect(spec.input.prompt).not.toContain('PREDICTIONS')
    m.createKairosPredictions.mockRejectedValue(new Error('db down'))
    const out = await applyWeeklyReview(jobFrom(spec), modelText({ predictions: PREDICTIONS }), 'routine')
    expect(out.ok).toBe(true)
    expect(m.writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ reason: 'predictions_failed' }))
    expect(m.deliverKairosSpeak).toHaveBeenCalledTimes(1)
  })
})

describe('weekly review character line (KAIROS_CHARACTER_CHECK)', () => {
  const run = {
    v: 1, status: 'ok', isoWeek: '2026-W40', window: { start: 'a', end: 'b' },
    counts: { reflection: 4, chat: 3, daily: 1, aether: 1, review: 1, exemplar: 3 },
    perTrait: null, perSource: null, principleConflicts: 0, toneFlags: { flagged: 0, total: 4 },
    breach: { tripped: false, reasons: [], traits: [], toneRate: false }, raterNoisy: false, jobId: 'job-c', answeredBy: 'routine',
  }
  const LINE = 'Character check wk40: steady · 3 voice samples.'
  afterEach(() => { delete process.env.KAIROS_CHARACTER_CHECK })

  it('off: no read, output unchanged', async () => {
    m.findCharacterRun.mockResolvedValue({ id: 'mem-run', sourceMetadata: { character: run }, createdAt: MONDAY })
    await applyWeeklyReview(jobFrom(await planOne()), modelText(), 'routine')
    expect(m.findCharacterRun).not.toHaveBeenCalled()
    expect(m.captureMemory.mock.calls.at(-1)![1].bodyMd).not.toContain('Character check')
  })

  it('on with a run for the week: the code-built line is appended to the review and the message (read at apply)', async () => {
    process.env.KAIROS_CHARACTER_CHECK = '1'
    m.findCharacterRun.mockResolvedValue({ id: 'mem-run', sourceMetadata: { character: run }, createdAt: MONDAY })
    await applyWeeklyReview(jobFrom(await planOne()), modelText(), 'routine')
    expect(m.findCharacterRun).toHaveBeenCalledWith(USER, '2026-W40')
    expect(m.captureMemory.mock.calls.at(-1)![1].bodyMd.endsWith(`\n\n${LINE}`)).toBe(true)
    expect(m.deliverKairosSpeak.mock.calls[0]![1].message.endsWith(`\n\n${LINE}`)).toBe(true)
  })

  it('on without a run (or a failed read): output unchanged', async () => {
    process.env.KAIROS_CHARACTER_CHECK = '1'
    m.findCharacterRun.mockResolvedValue(null)
    const job = jobFrom(await planOne())
    await applyWeeklyReview(job, modelText(), 'routine')
    const without = m.captureMemory.mock.calls.at(-1)![1].bodyMd
    expect(without).not.toContain('Character check')
    m.findCharacterRun.mockRejectedValue(new Error('db blip'))
    store.clear()
    const out = await applyWeeklyReview(job, modelText(), 'routine')
    expect(out.ok).toBe(true)
    expect(m.captureMemory.mock.calls.at(-1)![1].bodyMd).toBe(without)
  })
})
