import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'

const m = vi.hoisted(() => ({
  findNearestIdeaNeighbours: vi.fn(),
  writeTournament: vi.fn(),
  listIdeaOutcomes: vi.fn(),
  listDirectionStats: vi.fn(),
  getLatestAether: vi.fn(),
  listActiveDominions: vi.fn(),
  listEvidenceSnippets: vi.fn(),
  listOpenObjectives: vi.fn(),
  listOperatorReflections: vi.fn(),
  listRecentBoardDays: vi.fn(),
  listRecentConcepts: vi.fn(),
  listTopHeldBeliefs: vi.fn(),
  hasJobWithKeyLike: vi.fn(),
  upsertJob: vi.fn(),
  listJobs: vi.fn(),
  aetherRanToday: vi.fn(),
  embedOne: vi.fn(),
  searchSubstrateForChat: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
  writeCronFailureTrace: vi.fn(),
  askPaidAndParse: vi.fn(),
  listArchetypeLenses: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/ideas', () => ({
  IDEA_JUDGE_FAILED_REASON: 'judge_failed',
  findNearestIdeaNeighbours: m.findNearestIdeaNeighbours,
  writeTournament: m.writeTournament,
  listIdeaOutcomes: m.listIdeaOutcomes,
  listDirectionStats: m.listDirectionStats,
}))
vi.mock('@/lib/data/idea-inputs', () => ({
  getLatestAether: m.getLatestAether,
  listActiveDominions: m.listActiveDominions,
  listEvidenceSnippets: m.listEvidenceSnippets,
  listOpenObjectives: m.listOpenObjectives,
  listOperatorReflections: m.listOperatorReflections,
  listRecentBoardDays: m.listRecentBoardDays,
  listRecentConcepts: m.listRecentConcepts,
  listTopHeldBeliefs: m.listTopHeldBeliefs,
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: m.hasJobWithKeyLike, upsertJob: m.upsertJob, listJobs: m.listJobs }))
vi.mock('@/lib/data/idea-lenses', () => ({ listArchetypeLenses: m.listArchetypeLenses }))
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: m.aetherRanToday }))
vi.mock('@/lib/kairos/embeddings', () => ({ embedOne: m.embedOne }))
vi.mock('@/lib/kairos/retrieve', () => ({ searchSubstrateForChat: m.searchSubstrateForChat }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: m.writeCronSuccessTrace, writeCronFailureTrace: m.writeCronFailureTrace }))
vi.mock('../paid-fallback', () => ({ askPaidAndParse: m.askPaidAndParse }))
// Other lanes are isolated: only lane C's real extension runs here.
vi.mock('../handlers/idea-ext/stepping', () => ({ steppingExtension: {} }))
vi.mock('../handlers/idea-ext/atlas', () => ({ atlasExtension: {} }))
vi.mock('../handlers/idea-ext/collision', () => ({ collisionExtension: {} }))

import { ideaGenerateHandler } from '../handlers/idea-generate'
import { ideaJudgeHandler } from '../handlers/idea-judge'
import { IDEA_GENERATE_SYSTEM_PROMPT, buildIdeaGeneratePrompt } from '@/lib/kairos/ideas/generate-prompt'
import { buildJudgeSpec, readJudgeContext, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'

const USER = 'user-1'
const DAY = '2026-10-01'
const LATE = new Date(`${DAY}T04:00:00Z`)
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'
const DOMINIONS = [{ id: 'dom-1', name: 'Aeon' }]
const RESAMPLE_KEY = `idea_generate:${DAY}:resample`

function jobFrom(spec: ThinkingJobSpec, id = 'job-gen', over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  const now = new Date()
  return {
    id, userId: USER, kind: spec.kind, dominionId: spec.dominionId, externalKey: spec.externalKey, status: 'claimed',
    input: spec.input, output: null, claimedBy: 'routine', claimToken: 't', claimedAt: now, deadlineAt: now,
    completedAt: null, attempts: 1, error: null, createdAt: now, updatedAt: now, ...over,
  }
}

const snippet = (id: string) => ({ id, title: `title ${id}`, text: `text ${id}`, dominionId: 'dom-1', origin: 'operator', kind: null, type: 'reflection' })
const cand = (title: string, evidenceIds: string[], direction = 'd1') =>
  ({ direction, title, claim: `${title} claim`, why: 'why', nextStep: 'step', evidenceIds })
const answer = json({
  directions: [{ id: 'd1', label: 'Stop', move: 'stop', dominion: 'Aeon' }, { id: 'd2', label: 'Test', move: 'test', dominion: null }],
  candidates: [cand('Alpha', ['refl-1']), cand('Beta', ['board-1'], 'd2'), cand('Gamma', ['belief-1']), cand('Delta', ['refl-1'], 'd2')],
})
// Distinct directions per title: a spread batch that is NOT too similar.
const SPREAD: Record<string, number[]> = { A: [1, 0, 0], B: [0, 1, 0], G: [0, 0, 1], D: [-1, 0, 0] }

function primeInputs() {
  m.listActiveDominions.mockResolvedValue(DOMINIONS)
  m.listOpenObjectives.mockResolvedValue([])
  m.getLatestAether.mockResolvedValue(null)
  m.listRecentBoardDays.mockResolvedValue([{ id: 'board-1', title: 'Board day', summary: 'finished 3', excerpt: null, dominionId: 'dom-1', createdAt: LATE }])
  m.listTopHeldBeliefs.mockResolvedValue([{ id: 'belief-1', mind: 'aligned', domain: 'work', claim: 'small ships', dominionId: null }])
  m.listRecentConcepts.mockResolvedValue([])
  m.listOperatorReflections.mockResolvedValue([{ id: 'refl-1', title: 'Tired', summary: 'too many tabs', excerpt: null, dominionId: null, createdAt: LATE }])
  m.listIdeaOutcomes.mockResolvedValue([])
  m.listDirectionStats.mockResolvedValue([])
}

async function baseJob(): Promise<ThinkingJobRow> {
  const [spec] = await ideaGenerateHandler.plan(USER, LATE)
  return jobFrom(spec)
}

const upserted = (i = 0) => m.upsertJob.mock.calls[i]?.[1] as ThinkingJobSpec

beforeEach(() => {
  vi.clearAllMocks()
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.aetherRanToday.mockResolvedValue(false)
  primeInputs()
  // Near-identical vectors by default: a batch that IS too similar.
  m.embedOne.mockImplementation(async (text: string) => [text.charCodeAt(0), 1, 0])
  m.findNearestIdeaNeighbours.mockResolvedValue([])
  m.searchSubstrateForChat.mockResolvedValue([])
  m.listEvidenceSnippets.mockImplementation(async (_u: string, ids: string[]) => ids.map(snippet))
  m.upsertJob.mockImplementation(async (_u: string, spec: ThinkingJobSpec) => ({ ...jobFrom(spec, `job:${spec.externalKey}`), status: 'queued' }))
  m.listArchetypeLenses.mockResolvedValue([
    { id: 'arc-1', dominionId: 'dom-1', title: 'Craft', summary: 'making things well' },
    { id: 'arc-2', dominionId: 'dom-1', title: 'Leverage', summary: 'small inputs, big outputs' },
  ])
})

afterEach(() => {
  delete process.env.KAIROS_IDEA_VS
  delete process.env.KAIROS_IDEA_RESAMPLE
})

describe('flag off: generate and judge exactly as before', () => {
  it('plan: system and prompt are the base ones; no lens read; no vs key', async () => {
    const job = await baseJob()
    expect(job.input.system).toBe(IDEA_GENERATE_SYSTEM_PROMPT)
    const inputs = { date: DAY, dominions: DOMINIONS, objectives: [], aether: null, board: [{ id: 'board-1', title: 'Board day', summary: 'finished 3', excerpt: null, dominionId: 'dom-1', createdAt: LATE }],
      beliefs: [{ id: 'belief-1', mind: 'aligned', domain: 'work', claim: 'small ships', dominionId: null }], concepts: [],
      reflections: [{ id: 'refl-1', title: 'Tired', summary: 'too many tabs', excerpt: null, dominionId: null, createdAt: LATE }], lessons: [], directionStats: [] }
    expect(job.input.prompt).toBe(buildIdeaGeneratePrompt(inputs))
    expect(Object.keys(job.input.context ?? {}).sort()).toEqual(['date', 'dominions', 'inputErrors'])
    expect(m.listArchetypeLenses).not.toHaveBeenCalled()
  })

  it('apply on a too-similar batch: the judge is planned with exactly buildJudgeSpec; no sameness key', async () => {
    const out = await ideaGenerateHandler.apply(await baseJob(), answer, 'routine')
    expect(out.ok).toBe(true)
    const output = (out.ok && out.output) as Record<string, unknown>
    expect(output).not.toHaveProperty('sameness')
    expect(output).not.toHaveProperty('deferredJudgeContext')
    expect(m.upsertJob).toHaveBeenCalledTimes(1)
    expect(upserted()).toEqual(buildJudgeSpec(readJudgeContext(output.judgeContext) as IdeaJudgeContext))
  })
})

describe('KAIROS_IDEA_VS=1', () => {
  it('adds VS lines and lenses inside ONE call, stamps vs + lens names', async () => {
    process.env.KAIROS_IDEA_VS = '1'
    const job = await baseJob()
    expect(job.input.system.startsWith(`${IDEA_GENERATE_SYSTEM_PROMPT}\n`)).toBe(true)
    expect(job.input.system).toContain('"p"')
    expect(job.input.prompt).toContain('## Lenses')
    expect(job.input.context).toMatchObject({ vs: true, lenses: ['Craft', 'Leverage'] })
    expect(m.listArchetypeLenses).toHaveBeenCalledWith(USER, ['dom-1'])
  })

  it('a lens read failure keeps VS without lenses and is recorded', async () => {
    process.env.KAIROS_IDEA_VS = '1'
    m.listArchetypeLenses.mockRejectedValue(new Error('db down'))
    const job = await baseJob()
    expect(job.input.prompt).not.toContain('## Lenses')
    expect(job.input.context).toMatchObject({ vs: true, inputErrors: ['lenses: db down'] })
  })
})

describe('KAIROS_IDEA_RESAMPLE', () => {
  it('1 + routine + too similar: holds the judge back and plans one resample of the same kind', async () => {
    process.env.KAIROS_IDEA_RESAMPLE = '1'
    const job = await baseJob()
    const out = await ideaGenerateHandler.apply(job, answer, 'routine')
    expect(out.ok).toBe(true)
    const output = (out.ok && out.output) as Record<string, unknown>
    expect(m.upsertJob).toHaveBeenCalledTimes(1)
    const spec = upserted()
    expect(spec).toMatchObject({ kind: 'idea_generate', externalKey: RESAMPLE_KEY, deadlineMinutes: 55 })
    expect(spec.input.system).toBe(job.input.system)
    expect(spec.input.prompt.startsWith(job.input.prompt.split('<<<END IDEA INPUT DATA>>>')[0])).toBe(true)
    expect(spec.input.prompt).toContain('## Your usual pattern tonight')
    expect(spec.input.context).toMatchObject({ resampleOf: 'job-gen', date: DAY })
    expect(output).not.toHaveProperty('judgeContext')
    expect(output).toMatchObject({ judgeJobId: null, resampleJobId: `job:${RESAMPLE_KEY}`, sameness: { tooSimilar: true } })
    expect(readJudgeContext(output.deferredJudgeContext)).not.toBeNull()
  })

  it.each([
    ['answered by the paid API', '1', 'api'],
    ['observe mode', 'observe', 'routine'],
  ] as const)('%s: the judge is planned as before', async (_l, mode, by) => {
    process.env.KAIROS_IDEA_RESAMPLE = mode
    const out = await ideaGenerateHandler.apply(await baseJob(), answer, by)
    const output = (out.ok && out.output) as Record<string, unknown>
    expect(upserted().externalKey).toBe(`idea_judge:${DAY}`)
    expect(upserted()).toEqual(buildJudgeSpec(readJudgeContext(output.judgeContext) as IdeaJudgeContext))
    expect(output.sameness).toMatchObject({ tooSimilar: true, measured: 4, threshold: 0.15 })
  })

  it('a spread batch is not resampled', async () => {
    process.env.KAIROS_IDEA_RESAMPLE = '1'
    m.embedOne.mockImplementation(async (text: string) => SPREAD[text[0]])
    const out = await ideaGenerateHandler.apply(await baseJob(), answer, 'routine')
    expect(upserted().externalKey).toBe(`idea_judge:${DAY}`)
    expect(out.ok && out.output?.sameness).toMatchObject({ tooSimilar: false })
  })

  it('the resample job never resamples itself', async () => {
    process.env.KAIROS_IDEA_RESAMPLE = '1'
    const base = await baseJob()
    await ideaGenerateHandler.apply(base, answer, 'routine')
    const resample = jobFrom(upserted(), `job:${RESAMPLE_KEY}`)
    m.upsertJob.mockClear()
    const out = await ideaGenerateHandler.apply(resample, answer, 'routine')
    expect(upserted().externalKey).toBe(`idea_judge:${DAY}`)
    expect(out.ok && out.output?.sameness).toMatchObject({ resampleOf: 'job-gen' })
  })
})

describe('a failed resample settles on the first batch without a paid call', () => {
  async function deferredNight() {
    process.env.KAIROS_IDEA_RESAMPLE = '1'
    const base = await baseJob()
    const out = await ideaGenerateHandler.apply(base, answer, 'routine')
    const baseDone = { ...base, status: 'done' as const, output: out.ok ? out.output ?? null : null }
    const resample = jobFrom(upserted(), `job:${RESAMPLE_KEY}`, { status: 'expired' })
    m.upsertJob.mockClear()
    return { baseDone, resample, deferred: readJudgeContext(baseDone.output?.deferredJudgeContext) as IdeaJudgeContext }
  }

  it('fallback plans the judge from deferredJudgeContext', async () => {
    const { baseDone, resample, deferred } = await deferredNight()
    m.listJobs.mockResolvedValue([resample, baseDone])
    const out = await ideaGenerateHandler.fallback(resample)
    expect(out).toMatchObject({ ok: true, output: { settled: 'first_batch', resampleOf: 'job-gen' } })
    expect(upserted()).toEqual(buildJudgeSpec(deferred))
    expect(m.askPaidAndParse).not.toHaveBeenCalled()
  })

  it('abandon settles the same way', async () => {
    const { baseDone, resample, deferred } = await deferredNight()
    m.listJobs.mockResolvedValue([resample, baseDone])
    expect(await ideaGenerateHandler.abandon!(resample, 'paid backup off')).toEqual([])
    expect(upserted()).toEqual(buildJudgeSpec(deferred))
  })

  it('a missing first batch fails the fallback; still no paid call', async () => {
    const { resample } = await deferredNight()
    m.listJobs.mockResolvedValue([])
    expect(await ideaGenerateHandler.fallback(resample)).toMatchObject({ ok: false })
    expect(m.askPaidAndParse).not.toHaveBeenCalled()
    expect(m.upsertJob).not.toHaveBeenCalled()
  })

  it('an all-repeat first batch is archived under the base job, with no judge', async () => {
    const { baseDone, resample, deferred } = await deferredNight()
    const repeats = { ...deferred, candidates: deferred.candidates.map((c) => ({ ...c, novelty: { ...c.novelty, class: 'repeat' as const } })) }
    const base = { ...baseDone, output: { ...baseDone.output, deferredJudgeContext: repeats } }
    m.listJobs.mockResolvedValue([resample, base])
    m.writeTournament.mockResolvedValue({ survivorIds: [], archivedIds: ['a1', 'a2'], written: true })
    const out = await ideaGenerateHandler.fallback(resample)
    expect(out).toMatchObject({ ok: true, memoryIds: ['a1', 'a2'], output: { settled: 'no_contenders', judgeJobId: null } })
    expect(m.writeTournament.mock.calls.at(-1)?.[1]).toMatchObject({ generateJobId: 'job-gen', judgeJobId: null, survivors: [] })
    expect(m.upsertJob).not.toHaveBeenCalled()
    expect(m.askPaidAndParse).not.toHaveBeenCalled()
  })

  it('judge recovery: a done resample wins; an open one waits; a failed one falls back to the first batch', async () => {
    const { baseDone, resample, deferred } = await deferredNight()
    const done = { ...resample, status: 'done' as const, output: { judgeContext: { ...deferred, generateJobId: resample.id } } }
    m.listJobs.mockResolvedValue([done, baseDone])
    expect((await ideaJudgeHandler.plan(USER, LATE))[0]).toEqual(buildJudgeSpec({ ...deferred, generateJobId: resample.id }))
    m.listJobs.mockResolvedValue([{ ...resample, status: 'claimed' as const }, baseDone])
    expect(await ideaJudgeHandler.plan(USER, LATE)).toEqual([])
    m.listJobs.mockResolvedValue([{ ...resample, status: 'failed' as const }, baseDone])
    expect((await ideaJudgeHandler.plan(USER, LATE))[0]).toEqual(buildJudgeSpec(deferred))
  })

  it('judge recovery without any resample is unchanged (base judgeContext)', async () => {
    const out = await ideaGenerateHandler.apply(await baseJob(), answer, 'routine')
    const base = { ...(await baseJob()), status: 'done' as const, output: out.ok ? out.output ?? null : null }
    m.listJobs.mockResolvedValue([base])
    const ctx = readJudgeContext(base.output?.judgeContext) as IdeaJudgeContext
    expect(await ideaJudgeHandler.plan(USER, LATE)).toEqual([buildJudgeSpec(ctx)])
  })
})
