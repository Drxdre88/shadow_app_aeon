import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn() }))
vi.mock('@/lib/data/dream-inputs', () => ({ listDreamCandidates: vi.fn() }))
vi.mock('@/lib/data/ask', () => ({ listOpenKairosAsks: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: vi.fn() }))
vi.mock('@/lib/data/idea-inputs', () => ({ listActiveDominions: vi.fn() }))
vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: vi.fn() }))
vi.mock('@/lib/data/kairos-stage', () => ({ readKairosStage: vi.fn() }))
vi.mock('@/lib/kairos/embeddings', () => ({ embedOne: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ createMemory: vi.fn(), captureMemory: vi.fn() }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: vi.fn(), writeCronFailureTrace: vi.fn() }))

import { listOpenKairosAsks } from '@/lib/data/ask'
import { listDreamCandidates } from '@/lib/data/dream-inputs'
import { listOpenGoals } from '@/lib/data/goals'
import { listActiveDominions } from '@/lib/data/idea-inputs'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import * as memoriesData from '@/lib/data/memories'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import * as cronTrace from '@/lib/kairos/cron-trace'
import { embedOne } from '@/lib/kairos/embeddings'
import { dreamHandler } from '../handlers/dream'

const USER = '11111111-1111-4111-8111-111111111111'
const DAY = '2026-10-03'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)
const daysAgo = (d: number) => new Date(at('02:00').getTime() - d * 86_400_000)

const candidates = [
  { id: 'mem-a', dominionId: 'dom-a', streamClass: 'reflection', title: 'Desk stall', summary: 'The desk stalled again', createdAt: daysAgo(1), embedding: [1, 0, 0] },
  { id: 'mem-b', dominionId: 'dom-b', streamClass: 'idea', title: 'Garden', summary: null, createdAt: daysAgo(20), embedding: [0.6, 0.8, 0] },
  { id: 'mem-c', dominionId: null, streamClass: 'idea', title: 'Old trip', summary: '```fence```', createdAt: daysAgo(200), embedding: [0.4, 0, 0.9] },
]

const ask = { id: 'ask-1', title: 'What blocks the go-live?', kairosAsk: { askedAt: daysAgo(3).toISOString() } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('KAIROS_DREAMS', 'observe')
  vi.useFakeTimers()
  vi.setSystemTime(at('02:00'))
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listOpenKairosAsks).mockResolvedValue([ask] as never)
  vi.mocked(readKairosPromises).mockResolvedValue({ v: 1, nextSeq: 1, open: [], closed: [] })
  vi.mocked(listOpenGoals).mockResolvedValue([])
  vi.mocked(listDreamCandidates).mockResolvedValue(candidates)
  vi.mocked(listActiveDominions).mockResolvedValue([{ id: 'dom-a', name: 'Trading' }, { id: 'dom-b', name: 'Home' }])
  vi.mocked(embedOne).mockResolvedValue([1, 0, 0])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dream plan', () => {
  it('plans nothing when dreams are off', async () => {
    vi.stubEnv('KAIROS_DREAMS', '')
    expect(await dreamHandler.plan(USER, at('02:00'))).toEqual([])
    expect(listDreamCandidates).not.toHaveBeenCalled()
  })

  it('plans only inside the dream window', async () => {
    expect(await dreamHandler.plan(USER, at('01:30'))).toEqual([])
    expect(await dreamHandler.plan(USER, at('03:29'))).toEqual([])
    expect(await dreamHandler.plan(USER, at('01:40'))).toHaveLength(1)
  })

  it('plans once a night under dream:<date>', async () => {
    const [spec] = await dreamHandler.plan(USER, at('02:00'))
    expect(spec).toMatchObject({ kind: 'dream', dominionId: null, externalKey: `dream:${DAY}` })
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'dream', `dream:${DAY}`)
    vi.mocked(hasJobWithKeyLike).mockResolvedValue(true)
    expect(await dreamHandler.plan(USER, at('02:00'))).toEqual([])
  })

  it('plans nothing without seeds or with fewer than three candidates', async () => {
    vi.mocked(listOpenKairosAsks).mockResolvedValue([])
    expect(await dreamHandler.plan(USER, at('02:00'))).toEqual([])
    vi.mocked(listOpenKairosAsks).mockResolvedValue([ask] as never)
    vi.mocked(listDreamCandidates).mockResolvedValue(candidates.slice(0, 2))
    expect(await dreamHandler.plan(USER, at('02:00'))).toEqual([])
  })

  it('cites no ids, shows aliases only, and stores the picks in context', async () => {
    const [spec] = await dreamHandler.plan(USER, at('02:00'))
    expect(spec.input.validMemoryIds).toEqual([])
    expect(embedOne).toHaveBeenCalledTimes(1)
    expect(embedOne).toHaveBeenCalledWith(ask.title, 'query')
    const ctx = spec.input.context as { memories: Array<{ alias: string; id: string }>; seeds: unknown[] }
    expect(ctx.memories[0]).toMatchObject({ alias: 'm1', id: 'mem-a' })
    expect(ctx.seeds).toEqual([{ alias: 's1', kind: 'ask', ref: 'ask-1' }])
    for (const id of ['mem-a', 'mem-b', 'mem-c', 'ask-1']) expect(spec.input.prompt).not.toContain(id)
    expect(spec.input.prompt).not.toContain('```')
    expect(spec.input.prompt).toContain('Trading')
  })

  it('anchors on the seed embedding, else the newest reflection when the embed fails', async () => {
    vi.mocked(embedOne).mockResolvedValue([0.4, 0, 0.9])
    const [byVector] = await dreamHandler.plan(USER, at('02:00'))
    expect((byVector.input.context as { memories: Array<{ id: string }> }).memories[0].id).toBe('mem-c')
    vi.mocked(embedOne).mockRejectedValue(new Error('voyage down'))
    const [spec] = await dreamHandler.plan(USER, at('02:00'))
    expect((spec.input.context as { memories: Array<{ id: string }> }).memories[0].id).toBe('mem-a')
  })
})

describe('dream apply', () => {
  async function plannedJob(): Promise<ThinkingJobRow> {
    const [spec] = await dreamHandler.plan(USER, at('02:00'))
    return {
      id: 'job-1', userId: USER, kind: 'dream', dominionId: null, externalKey: spec.externalKey, status: 'claimed',
      input: spec.input, output: null, claimedBy: 'routine', claimToken: 't', claimedAt: at('02:05'), deadlineAt: at('03:28'),
      completedAt: null, attempts: 1, error: null, createdAt: at('02:00'), updatedAt: at('02:00'),
    }
  }

  function answerFor(job: ThinkingJobRow): string {
    const ctx = job.input.context as { memories: Array<{ alias: string; distortion: string }> }
    return JSON.stringify({
      title: 'A floating desk',
      scenes: ctx.memories.map((m) => ({ ref: m.alias, distortion: m.distortion, text: `A bent scene for ${m.alias} under violet light.` })),
      dream: 'I am on a trading floor that is also a garden, and the go-live is a boat that never leaves the dock at all tonight.',
      seedEcho: 'It circles the go-live question.',
    })
  }

  it('stores the dream only in job output: dreamt, v1, memoryIds [], no writes', async () => {
    const job = await plannedJob()
    const outcome = await dreamHandler.apply(job, answerFor(job), 'routine')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.memoryIds).toEqual([])
    expect(outcome.thoughts).toBeUndefined()
    expect(outcome.output).toMatchObject({ dreamt: true, v: 1, date: DAY, title: 'A floating desk' })
    expect((outcome.output as { scenes: Array<{ memoryId: string }> }).scenes.map((s) => s.memoryId)).toContain('mem-a')
    expect(Array.isArray((outcome.output as { fingerprints: string[] }).fingerprints)).toBe(true)
    expect(vi.mocked(memoriesData.createMemory)).not.toHaveBeenCalled()
    expect(vi.mocked(cronTrace.writeCronSuccessTrace)).not.toHaveBeenCalled()
  })

  it('fails a malformed answer without writing anything', async () => {
    const job = await plannedJob()
    const outcome = await dreamHandler.apply(job, JSON.stringify({ title: 'x' }), 'routine')
    expect(outcome).toMatchObject({ ok: false })
    expect(vi.mocked(cronTrace.writeCronSuccessTrace)).not.toHaveBeenCalled()
  })

  it('rejects a stale job and has no fallback', async () => {
    const job = await plannedJob()
    vi.setSystemTime(new Date('2026-10-04T02:00:00.000Z'))
    expect(await dreamHandler.apply(job, answerFor(job), 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^stale_job/) })
    expect(await dreamHandler.fallback(job)).toMatchObject({ ok: false })
  })
})
