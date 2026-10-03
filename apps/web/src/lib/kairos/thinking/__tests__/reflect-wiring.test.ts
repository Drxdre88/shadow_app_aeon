import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

// Reflect ↔ track record + Horae wiring (A2): with each lane's own switch on,
// the prompt carries its section and the answer's items go through that
// lane's server-side creator, grounded to the job's ids; a creator failure
// never costs the reflection.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(async () => false), listJobs: vi.fn(async () => []) }))
vi.mock('@/lib/data/memories', () => ({ listRecentMemories: vi.fn(), captureMemory: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: vi.fn(async () => []) }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: vi.fn(async () => ({ v: 1, nextSeq: 1, open: [], closed: [] })) }))
vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: vi.fn() }))
vi.mock('@/lib/data/kairos-agenda', () => ({ readKairosAgenda: vi.fn() }))
vi.mock('@/lib/kairos/predictions/create', () => ({ createKairosPredictions: vi.fn() }))
vi.mock('@/lib/kairos/agenda/create', () => ({ createAgendaItems: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({
  todayEnabled: vi.fn(() => true),
  loadTodayDigest: vi.fn(async () => null),
  appendTodayNotes: vi.fn(async () => undefined),
  countTodayEntriesSince: vi.fn(async () => 3),
}))

import { captureMemory, listRecentMemories } from '@/lib/data/memories'
import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { readKairosAgenda } from '@/lib/data/kairos-agenda'
import { createKairosPredictions } from '@/lib/kairos/predictions/create'
import { createAgendaItems } from '@/lib/kairos/agenda/create'
import { reflectHandler } from '../handlers/reflect'

const USER = 'user-1'
// 10:40Z on 1 Oct 2026 = 11:40 London (BST).
const NOW = new Date('2026-10-01T10:40:00.000Z')
const SLOT = 'reflect:2026-10-01:11'
const EVENT = { id: 'mem-ev-1', title: 'Captured session: pricing refactor', createdAt: NOW, streamClass: 'execution' }

function reflectJob(): ThinkingJobRow {
  return {
    id: 'job-r', userId: USER, kind: 'reflect', dominionId: null, externalKey: SLOT, status: 'claimed',
    input: {
      system: 's', prompt: 'p', validMemoryIds: ['mem-ev-1', 'goal-1'],
      context: { slot: SLOT, goals: [{ id: 'goal-1', title: 'Pricing stalls' }], eventIds: ['mem-ev-1'] },
    },
    output: null, claimedBy: 'routine:brain', claimToken: 't', claimedAt: NOW, deadlineAt: new Date(NOW.getTime() + 50 * 60_000),
    completedAt: null, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
  }
}

const PREDICTION = { claim: 'The pricing refactor ships to production by Friday', probability: 0.7, dueDate: '2026-10-09', topic: 'delivery', basisIds: ['mem-ev-1'] }
const FOLLOW_UP = { what: 'Check whether the pricing review landed', date: '2026-10-02', slot: 'morning', basisIds: ['mem-ev-1'], goalId: 'goal-1' }
const ANSWER = JSON.stringify({ thought: 'Review seems to be the bottleneck.', predictions: [PREDICTION], followUps: [FOLLOW_UP, { ...FOLLOW_UP, what: 'See if the fix held?', goalId: 'invented', extra: 1 }] })

const FLAGS = ['KAIROS_DAYTIME_THINKING', 'KAIROS_PREDICTIONS', 'KAIROS_INITIATIVE', 'KAIROS_AGENDA'] as const

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_DAYTIME_THINKING = '1'
  vi.mocked(listRecentMemories).mockResolvedValue([EVENT] as never)
  vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'mem-reflection' }, created: true } as never)
  vi.mocked(readKairosPredictions).mockResolvedValue({ v: 1, nextSeq: 4, open: [{ seq: 3, claim: 'The fill-rate fix holds all week', dueDate: '2026-10-05', probability: 0.8 }], closed: [] } as never)
  vi.mocked(readKairosAgenda).mockResolvedValue({ v: 1, nextSeq: 3, open: [{ seq: 2, what: 'Check the Thursday runs', dueAt: '2026-10-08T08:00:00.000Z' }], closed: [] } as never)
  vi.mocked(createKairosPredictions).mockResolvedValue({ created: [{ seq: 4 }], rejected: [], overflow: 0 } as never)
  vi.mocked(createAgendaItems).mockResolvedValue({ created: [{ seq: 3 }], rejected: [{ index: 1, reason: 'not_a_check' }] } as never)
})
afterEach(() => {
  for (const f of FLAGS) delete process.env[f]
})

function flagsOn() {
  process.env.KAIROS_PREDICTIONS = '1'
  process.env.KAIROS_INITIATIVE = '1'
  process.env.KAIROS_AGENDA = '1'
}

describe('reflect prompt sections', () => {
  it('flags off: no track record, prediction or follow-up section, and nothing read', async () => {
    const [spec] = await reflectHandler.plan(USER, NOW)
    expect(spec.input.prompt).not.toMatch(/TRACK RECORD|PREDICTION|FOLLOW-UPS|Horae/)
    expect(readKairosPredictions).not.toHaveBeenCalled()
    expect(readKairosAgenda).not.toHaveBeenCalled()
  })

  it('flags on: the track record, the open claims and check-ins, and both offers with their windows', async () => {
    flagsOn()
    const [spec] = await reflectHandler.plan(USER, NOW)
    const prompt = spec.input.prompt
    expect(prompt).toContain('TRACK RECORD')
    expect(prompt).toContain('## PREDICTION (optional, at most 1)')
    expect(prompt).toContain('R3 (80%) due 2026-10-05: The fill-rate fix holds all week')
    expect(prompt).toContain('between 2026-10-02 and 2026-10-29')
    expect(prompt).toContain('## FOLLOW-UPS (optional, at most 2)')
    expect(prompt).toMatch(/- A2 \w{3} 08\/10: Check the Thursday runs/)
    expect(prompt).toContain('between 2026-10-01 and 2026-10-14')
    expect(spec.input.system).toMatch(/"predictions" \(at most 1\) or "followUps" \(at most 2\)/)
  })

  it('a failed read drops only that section', async () => {
    flagsOn()
    vi.mocked(readKairosPredictions).mockRejectedValue(new Error('corrupt'))
    const [spec] = await reflectHandler.plan(USER, NOW)
    expect(spec.input.prompt).not.toContain('PREDICTION')
    expect(spec.input.prompt).toContain('FOLLOW-UPS')
  })
})

describe('reflect apply → creators', () => {
  it('flags on: hands predictions and cleaned follow-ups to the creators, grounded to the job ids', async () => {
    flagsOn()
    const res = await reflectHandler.apply(reflectJob(), ANSWER, 'routine')
    expect(res).toMatchObject({
      ok: true,
      memoryIds: ['mem-reflection'],
      output: { predictions: { created: ['R4'], rejected: [] }, followUps: { created: ['A3'], rejected: ['not_a_check'] } },
    })
    expect(createKairosPredictions).toHaveBeenCalledWith(USER, [PREDICTION], { kind: 'reflect', jobId: 'job-r' }, { validMemoryIds: ['mem-ev-1', 'goal-1'] })
    const [uid, items, source, opts] = vi.mocked(createAgendaItems).mock.calls[0]
    expect(uid).toBe(USER)
    expect(source).toEqual({ kind: 'reflect', jobId: 'job-r' })
    expect(items).toEqual([FOLLOW_UP, { what: 'See if the fix held?', date: '2026-10-02', slot: 'morning', basisIds: ['mem-ev-1'] }])
    expect([...(opts?.validBasisIds ?? [])]).toEqual(['mem-ev-1', 'goal-1'])
  })

  it('each lane obeys only its own switch', async () => {
    process.env.KAIROS_PREDICTIONS = '1'
    await reflectHandler.apply(reflectJob(), ANSWER, 'routine')
    expect(createKairosPredictions).toHaveBeenCalledTimes(1)
    expect(createAgendaItems).not.toHaveBeenCalled()
  })

  it('no thought: nothing is created', async () => {
    flagsOn()
    const res = await reflectHandler.apply(reflectJob(), JSON.stringify({ thought: null, predictions: [PREDICTION], followUps: [FOLLOW_UP] }), 'routine')
    expect(res).toMatchObject({ ok: true, output: { skipped: 'no_thought' } })
    expect(createKairosPredictions).not.toHaveBeenCalled()
    expect(createAgendaItems).not.toHaveBeenCalled()
  })

  it('a creator failure never costs the reflection', async () => {
    flagsOn()
    vi.mocked(createKairosPredictions).mockRejectedValue(new Error('lock timeout'))
    vi.mocked(createAgendaItems).mockRejectedValue(new Error('lock timeout'))
    const res = await reflectHandler.apply(reflectJob(), ANSWER, 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['mem-reflection'] })
    expect(res.ok && res.output).not.toHaveProperty('predictions')
  })
})
