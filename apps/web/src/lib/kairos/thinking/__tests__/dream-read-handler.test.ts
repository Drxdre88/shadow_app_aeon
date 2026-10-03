import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(), listJobs: vi.fn() }))
vi.mock('@/lib/data/conscience', () => ({ getConsciencePrinciples: vi.fn(), listConscienceBeliefs: vi.fn() }))
vi.mock('@/lib/data/dialogue', () => ({ fetchMemoriesByIds: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({ listKairosPromises: vi.fn() }))

import { getConsciencePrinciples, listConscienceBeliefs } from '@/lib/data/conscience'
import { fetchMemoriesByIds } from '@/lib/data/dialogue'
import { listOpenGoals } from '@/lib/data/goals'
import { listKairosPromises } from '@/lib/data/kairos-promises'
import { hasJobWithKeyLike, listJobs } from '@/lib/data/thinking-jobs'
import { DREAM_READ_FENCE_BEGIN, DREAM_READ_FENCE_END } from '@/lib/kairos/dreams/read-prompt'
import { dreamReadHandler } from '../handlers/dream-read'

const USER = 'user-1'
const DAY = '2026-10-03'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)

const dreamJob = {
  id: 'dream-job-1',
  output: {
    dreamt: true, v: 1, date: DAY, title: 'The tide office',
    dream: 'I was at the harbour and Anna ran the standup.',
    scenes: [
      { memoryId: 'mem-1', distortion: 'swap_who', text: 'Anna ran the standup.' },
      { memoryId: 'mem-2', distortion: 'flip_outcome', text: 'The launch went perfectly.' },
    ],
    seeds: [], fingerprints: [],
  },
}

function seed() {
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listJobs).mockResolvedValue([dreamJob] as never)
  vi.mocked(fetchMemoriesByIds).mockResolvedValue([
    { id: 'mem-1', title: 'Standup', body: 'Bob ran the standup.', streamClass: 'reflection', dominionId: null },
    { id: 'mem-2', title: 'Launch', body: 'The launch slipped a week.', streamClass: 'idea', dominionId: null },
  ])
  vi.mocked(getConsciencePrinciples).mockResolvedValue({ version: 2, principles: [{ text: 'Tell the truth.', reason: 'trust' }] } as never)
  vi.mocked(listConscienceBeliefs).mockResolvedValue([{ mind: 'aligned', domain: 'work', dominionId: null, claim: 'Small ships win.', confidence: 0.8 }])
  vi.mocked(listOpenGoals).mockResolvedValue([
    { id: 'goal-1', title: 'Desk', meta: { state: 'active', question: 'Why does it stall?' } },
    { id: 'goal-2', title: 'Pending', meta: { state: 'proposed', question: 'Not yet?' } },
  ] as never)
  vi.mocked(listKairosPromises).mockResolvedValue([{ id: 'prom-1', seq: 4, outcome: 'Send the memo', dueDate: '2026-10-05' }] as never)
}

function jobRow(context: Record<string, unknown>): ThinkingJobRow {
  return {
    id: 'read-job', userId: USER, kind: 'dream_read', dominionId: null, externalKey: `dream_read:${DAY}`,
    status: 'claimed', input: { system: 's', prompt: 'p', validMemoryIds: [], context }, output: null,
    claimedBy: 'routine', claimToken: 't', claimedAt: at('02:40'), deadlineAt: at('04:28'), completedAt: null,
    attempts: 1, error: null, createdAt: at('02:30'), updatedAt: at('02:30'),
  }
}

const answer = JSON.stringify({
  holds: [{ pattern: 'Launches slip when standups get crowded', refs: ['m1', 'm2'], strength: 0.7 }],
  fragile: [{ ref: 'b1', situation: 'A launch that went perfectly', why: 'Big shipping worked in the dream.' }],
  rehearsal: { ref: 'g1', worstCase: 'The desk never ships.', earlySign: 'No demo by Friday.', guard: 'Book the demo.' },
  morningLine: 'A night at the harbour.',
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('KAIROS_DREAMS', '1')
  vi.stubEnv('KAIROS_STAGE', '1')
  seed()
})
afterEach(() => vi.unstubAllEnvs())

describe('dream_read plan', () => {
  it('plans nothing while dreams are off', async () => {
    vi.stubEnv('KAIROS_DREAMS', '0')
    expect(await dreamReadHandler.plan(USER, at('03:00'))).toEqual([])
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('plans nothing outside the window', async () => {
    expect(await dreamReadHandler.plan(USER, at('01:20'))).toEqual([])
    expect(await dreamReadHandler.plan(USER, at('04:30'))).toEqual([])
  })

  it('plans nothing when tonight already has a read', async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValue(true)
    expect(await dreamReadHandler.plan(USER, at('03:00'))).toEqual([])
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'dream_read', `dream_read:${DAY}`)
  })

  it('waits for tonight\'s dream to be done', async () => {
    vi.mocked(listJobs).mockResolvedValue([{ ...dreamJob, output: { ...dreamJob.output, date: '2026-10-02' } }] as never)
    expect(await dreamReadHandler.plan(USER, at('03:00'))).toEqual([])
    expect(listJobs).toHaveBeenCalledWith(USER, { kind: 'dream', status: 'done', limit: 5 })
  })

  it('chains one read after tonight\'s dream, the dream fenced as fiction', async () => {
    const [spec] = await dreamReadHandler.plan(USER, at('03:00'))
    expect(spec.kind).toBe('dream_read')
    expect(spec.externalKey).toBe(`dream_read:${DAY}`)
    expect(spec.input.validMemoryIds).toEqual([])
    const p = spec.input.prompt
    const begin = p.indexOf(DREAM_READ_FENCE_BEGIN)
    const end = p.indexOf(DREAM_READ_FENCE_END)
    expect(begin).toBeGreaterThan(-1)
    expect(p.slice(begin, end)).toContain('Anna ran the standup.')
    const facts = p.slice(end)
    expect(facts).toContain('m1 [bent in the dream by: swap_who] Standup — Bob ran the standup.')
    expect(facts).toContain('p1: Tell the truth.')
    expect(facts).toContain('b1 [work]: Small ships win.')
    expect(facts).toContain('g1: Desk')
    expect(facts).not.toContain('Pending')
    expect(facts).toContain('P1 (P4, due 2026-10-05)')
    expect(spec.input.context).toMatchObject({
      date: DAY,
      dreamJobId: 'dream-job-1',
      memories: [{ alias: 'm1', id: 'mem-1', distortion: 'swap_who' }, { alias: 'm2', id: 'mem-2', distortion: 'flip_outcome' }],
      goals: [{ alias: 'g1', id: 'goal-1', title: 'Desk' }],
    })
  })
})

describe('dream_read apply', () => {
  async function plannedContext() {
    const [spec] = await dreamReadHandler.plan(USER, at('03:00'))
    return spec.input.context as Record<string, unknown>
  }

  it('stores the read as job output only and offers speculative thoughts when on', async () => {
    const out = await dreamReadHandler.apply(jobRow(await plannedContext()), answer, 'routine')
    if (!out.ok) throw new Error(out.reason)
    expect(out.memoryIds).toEqual([])
    expect(out.output).toEqual({
      dreamt: true, v: 1, date: DAY, dreamJobId: 'dream-job-1',
      holds: [{ pattern: 'Launches slip when standups get crowded', memoryIds: ['mem-1', 'mem-2'] }],
      fragile: [{ beliefId: null, claim: 'Small ships win.', situation: 'A launch that went perfectly', why: 'Big shipping worked in the dream.' }],
      rehearsal: { goalId: 'goal-1', subject: 'Desk', worstCase: 'The desk never ships.', earlySign: 'No demo by Friday.', guard: 'Book the demo.' },
      morningLine: 'A night at the harbour.',
    })
    expect(out.thoughts).toHaveLength(2)
    for (const t of out.thoughts ?? []) {
      expect(t.text.startsWith('Dream hunch: ')).toBe(true)
      expect(t.surprise).toBe(0)
      expect(t.cites).toEqual([])
    }
  })

  it('posts nothing to the stage in observe mode', async () => {
    const ctx = await plannedContext()
    vi.stubEnv('KAIROS_DREAMS', 'observe')
    const out = await dreamReadHandler.apply(jobRow(ctx), answer, 'routine')
    expect(out.ok && out.thoughts).toBeFalsy()
    expect(out.ok && out.output?.dreamt).toBe(true)
  })

  it('fails a malformed answer and a job without context', async () => {
    const bad = await dreamReadHandler.apply(jobRow(await plannedContext()), '{"holds":"nope"}', 'routine')
    expect(bad).toMatchObject({ ok: false })
    expect(!bad.ok && bad.reason.startsWith('parse_failed:')).toBe(true)
    expect(await dreamReadHandler.apply(jobRow({}), answer, 'routine')).toMatchObject({ ok: false })
  })

  it('has no fallback', async () => {
    expect(await dreamReadHandler.fallback(jobRow({}))).toMatchObject({ ok: false })
  })
})

describe('dream_read firewall', () => {
  const forbidden = [
    /captureMemory|createMemory|captureReflection|writeFloatingReflection/,
    /@\/lib\/kairos\/today/, /cron-trace/, /reactions/, /memory-ops/,
    /predictions\/create/, /promises\/create/, /goals\/transitions/, /agenda\//, /speak/,
    /mutateKairosPromises|casGoalUpdate|insertGoalProposal/,
  ]
  const files = [
    '../handlers/dream-read.ts',
    '../../dreams/read.ts',
    '../../dreams/read-parse.ts',
    '../../dreams/read-prompt.ts',
  ]
  it.each(files)('%s imports no writer', (rel) => {
    const src = readFileSync(join(__dirname, rel), 'utf8')
    const imports = (src.match(/^import[\s\S]*?from\s+'[^']+'/gm) ?? []).join('\n')
    expect(imports).toContain('import')
    for (const re of forbidden) expect(imports).not.toMatch(re)
  })
})
