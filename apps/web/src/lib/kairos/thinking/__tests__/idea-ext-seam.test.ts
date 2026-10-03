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
}))
// Lane extensions are mutable empty objects so each test can plug hooks in.
const lanes = vi.hoisted(() => ({
  stepping: {} as Record<string, unknown>,
  atlas: {} as Record<string, unknown>,
  collision: {} as Record<string, unknown>,
  sameness: {} as Record<string, unknown>,
}))

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
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: m.aetherRanToday }))
vi.mock('@/lib/kairos/embeddings', () => ({ embedOne: m.embedOne }))
vi.mock('@/lib/kairos/retrieve', () => ({ searchSubstrateForChat: m.searchSubstrateForChat }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: m.writeCronSuccessTrace, writeCronFailureTrace: m.writeCronFailureTrace }))
vi.mock('../paid-fallback', () => ({ askPaidAndParse: m.askPaidAndParse }))
vi.mock('../handlers/idea-ext/stepping', () => ({ steppingExtension: lanes.stepping }))
vi.mock('../handlers/idea-ext/atlas', () => ({ atlasExtension: lanes.atlas }))
vi.mock('../handlers/idea-ext/collision', () => ({ collisionExtension: lanes.collision }))
vi.mock('../handlers/idea-ext/sameness', () => ({ samenessExtension: lanes.sameness }))

import { gatherIdeaInputs, ideaGenerateHandler } from '../handlers/idea-generate'
import { assembleTournament, ideaJudgeHandler } from '../handlers/idea-judge'
import { spliceBeforeDataEnd, IDEA_GENERATE_SYSTEM_PROMPT, buildIdeaGeneratePrompt, ideaInputIds } from '@/lib/kairos/ideas/generate-prompt'
import { readJudgeContext, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { parseIdeaJudgeText } from '@/lib/kairos/ideas/judge-prompt'
import { computeElo } from '@/lib/kairos/ideas/elo'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'

const USER = 'user-1'
const DAY = '2026-10-01'
const LATE = new Date(`${DAY}T04:00:00Z`)
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'
const boom = () => { throw new Error('boom') }
const DOMINIONS = [{ id: 'dom-1', name: 'Aeon' }]

function jobFrom(spec: ThinkingJobSpec, id = 'job-gen'): ThinkingJobRow {
  const now = new Date()
  return {
    id, userId: USER, kind: spec.kind, dominionId: spec.dominionId, externalKey: spec.externalKey, status: 'claimed',
    input: spec.input, output: null, claimedBy: 'routine', claimToken: 't', claimedAt: now, deadlineAt: now,
    completedAt: null, attempts: 1, error: null, createdAt: now, updatedAt: now,
  }
}

const snippet = (id: string) => ({ id, title: `title ${id}`, text: `text ${id}`, dominionId: 'dom-1', origin: 'operator', kind: null, type: 'reflection' })
const cand = (title: string, evidenceIds: string[], direction = 'd1') =>
  ({ direction, title, claim: `${title} claim`, why: 'why', nextStep: 'step', evidenceIds })
const generateAnswer = json({
  directions: [{ id: 'd1', label: 'Stop', move: 'stop', dominion: 'Aeon' }, { id: 'd2', label: 'Test', move: 'test', dominion: null }],
  candidates: [cand('Alpha', ['refl-1']), cand('Beta', ['board-1'], 'd2'), cand('Gamma', ['belief-1']), cand('Delta', ['refl-1'], 'd2')],
})
const crit = (key: string, supports: string[]) =>
  ({ key, verdict: 'grounded', supports, contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: 'ok' })

const GENERATE_OUTPUT_KEYS = ['tournamentDate', 'answeredBy', 'directions', 'candidates', 'dropped', 'contenders', 'embedFailures', 'judgeContext', 'judgeJobId']
const JUDGE_CONTEXT_KEYS = ['date', 'generateJobId', 'candidates', 'evidence', 'nearest', 'pairs', 'matches']
const STORED_KEYS = ['key', 'direction', 'title', 'claim', 'why', 'nextStep', 'citedIds', 'novelty', 'evidenceIds', 'vector']
const META_KEYS = ['v', 'tournamentDate', 'generateJobId', 'judgeJobId', 'key', 'direction', 'claim', 'why', 'nextStep', 'status',
  'eliminatedReason', 'elo', 'rank', 'novelty', 'critique', 'refined', 'survivedBecause', 'outcome', 'outcomeAt']
const TOURNAMENT_KEYS = ['tournamentDate', 'answeredBy', 'written', 'candidates', 'contenders', 'matches', 'votes', 'survivors', 'eliminated']

function primeInputs() {
  m.listActiveDominions.mockResolvedValue(DOMINIONS)
  m.listOpenObjectives.mockResolvedValue([{ dominionId: 'dom-1', title: 'Ship P3', status: 'active', targetDate: null }])
  m.getLatestAether.mockResolvedValue({ id: 'aether-1', createdAt: LATE, payload: { coreNarrative: 'n', thoughts: [], tensions: [] } })
  m.listRecentBoardDays.mockResolvedValue([{ id: 'board-1', title: 'Board day', summary: 'finished 3', excerpt: null, dominionId: 'dom-1', createdAt: LATE }])
  m.listTopHeldBeliefs.mockResolvedValue([{ id: 'belief-1', mind: 'aligned', domain: 'work', claim: 'small ships', dominionId: null }])
  m.listRecentConcepts.mockResolvedValue([])
  m.listOperatorReflections.mockResolvedValue([{ id: 'refl-1', title: 'Tired', summary: 'too many tabs', excerpt: null, dominionId: null, createdAt: LATE }])
  m.listIdeaOutcomes.mockResolvedValue([{ id: 'old', title: 'Old', direction: 'x', claim: 'c', outcome: 'accepted' }])
  m.listDirectionStats.mockResolvedValue([])
}

async function generateJob(): Promise<ThinkingJobRow> {
  const [spec] = await ideaGenerateHandler.plan(USER, LATE)
  return jobFrom(spec)
}

async function judgeJob(): Promise<{ job: ThinkingJobRow; ctx: IdeaJudgeContext }> {
  const out = await ideaGenerateHandler.apply(await generateJob(), generateAnswer, 'routine')
  if (!out.ok) throw new Error(out.reason)
  const spec = m.upsertJob.mock.calls[0][1] as ThinkingJobSpec
  return { job: jobFrom(spec, 'job-judge'), ctx: readJudgeContext(spec.input.context) as IdeaJudgeContext }
}

const judgeAnswer = (ctx: IdeaJudgeContext) => json({
  critiques: [crit('c1', ['refl-1']), crit('c2', ['board-1']), crit('c3', ['belief-1']), crit('c4', ['refl-1'])],
  votes: ctx.matches.map((mm) => ({ match: mm.id, winner: mm.first === 'c1' || mm.second === 'c1' ? 'c1' : mm.first })),
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const lane of Object.values(lanes)) for (const k of Object.keys(lane)) delete lane[k]
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.aetherRanToday.mockResolvedValue(false)
  primeInputs()
  m.embedOne.mockImplementation(async (text: string) => [text.charCodeAt(0), 1, 0])
  m.findNearestIdeaNeighbours.mockResolvedValue([])
  m.searchSubstrateForChat.mockResolvedValue([])
  m.listEvidenceSnippets.mockImplementation(async (_u: string, ids: string[]) => ids.map(snippet))
  m.upsertJob.mockImplementation(async (_u: string, spec: ThinkingJobSpec) => ({ ...jobFrom(spec, 'job-judge'), status: 'queued' }))
  m.writeTournament.mockResolvedValue({ written: true, survivorIds: ['s1'], archivedIds: ['a1', 'a2'] })
})

afterEach(() => vi.restoreAllMocks())

describe('flag-off seam: empty extensions change nothing', () => {
  it('plan spec equals the pre-seam spec', async () => {
    const inputs = await gatherIdeaInputs(USER, LATE, DOMINIONS, [])
    const [spec] = await ideaGenerateHandler.plan(USER, LATE)
    expect(spec.input.system).toBe(IDEA_GENERATE_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildIdeaGeneratePrompt(inputs))
    expect(spec.input.validMemoryIds).toEqual(ideaInputIds(inputs))
    expect(spec.input.context).toEqual({ date: DAY, dominions: DOMINIONS, inputErrors: [] })
    expect(Object.keys(spec.input)).toEqual(['system', 'prompt', 'validMemoryIds', 'context', 'maxOutputTokens'])
  })

  it('generate apply output and judge context carry only the pre-seam keys', async () => {
    const out = await ideaGenerateHandler.apply(await generateJob(), generateAnswer, 'routine')
    if (!out.ok) throw new Error(out.reason)
    expect(Object.keys(out.output!)).toEqual(GENERATE_OUTPUT_KEYS)
    const judge = out.output!.judgeContext as IdeaJudgeContext
    expect(Object.keys(judge)).toEqual(JUDGE_CONTEXT_KEYS)
    for (const c of judge.candidates) expect(Object.keys(c)).toEqual(STORED_KEYS)
    expect(readJudgeContext(JSON.parse(JSON.stringify(judge)))).toEqual(JSON.parse(JSON.stringify(judge)))
  })

  it('judge apply writes pre-seam meta, bodies and summary', async () => {
    const { job, ctx } = await judgeJob()
    const out = await ideaJudgeHandler.apply(job, judgeAnswer(ctx), 'routine')
    if (!out.ok) throw new Error(out.reason)
    const input = m.writeTournament.mock.calls[0][1]
    for (const row of [...input.survivors, ...input.others]) expect(Object.keys(row.meta)).toEqual(META_KEYS)
    expect(Object.keys((out.output as { tournament: object }).tournament)).toEqual(TOURNAMENT_KEYS)

    // assembleTournament with an (empty) scope equals the scope-less call.
    const judged = parseIdeaJudgeText(judgeAnswer(ctx), { candidates: ctx.candidates, matches: ctx.matches })
    const elo = computeElo(ctx.candidates.map((c) => c.key), ctx.pairs, judged.votes)
    const scope = { job, ctx, answeredBy: 'routine' as const, scratch: {} }
    expect(assembleTournament(ctx, 'j', judged, elo, new Map(), scope)).toEqual(assembleTournament(ctx, 'j', judged, elo, new Map()))
  })

  it('the generate handler abandon is a no-op', async () => {
    expect(await ideaGenerateHandler.abandon!(await generateJob(), 'expired')).toEqual([])
  })
})

describe('a throwing extension never fails the job', () => {
  it('plan, generate apply and judge apply all complete', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.assign(lanes.atlas, {
      adjustGenerateInputs: boom, planGenerate: boom, parseOptions: boom, afterParse: boom, enrichStoredCandidate: boom,
      buildJudgeContextExtras: boom, beforePlanJudge: boom, summarizeGenerate: boom, prepareJudge: boom, postSelect: boom,
      metaExtras: boom, composeExtraLines: boom, afterTournamentWrite: boom, summarizeJudge: boom,
    })
    const inputs = await gatherIdeaInputs(USER, LATE, DOMINIONS, [])
    const [spec] = await ideaGenerateHandler.plan(USER, LATE)
    expect(spec.input.prompt).toBe(buildIdeaGeneratePrompt(inputs))
    expect((spec.input.context as { inputErrors: string[] }).inputErrors).toEqual(['ext:atlas.planGenerate: boom'])

    const { job, ctx } = await judgeJob()
    expect(ctx.candidates).toHaveLength(4)
    const out = await ideaJudgeHandler.apply(job, judgeAnswer(ctx), 'routine')
    expect(out.ok).toBe(true)
    expect(m.writeTournament).toHaveBeenCalledTimes(1)
  })
})

describe('hooks reach the stored artefacts', () => {
  it('plan sections, context keys, parse options, stored fields, meta and body lines flow end to end', async () => {
    Object.assign(lanes.stepping, {
      planGenerate: (d: { prompt: string; context: object; system: string; validMemoryIds: string[] }) =>
        ({ ...d, system: `${d.system}\nNOVELTY`, prompt: spliceBeforeDataEnd(d.prompt, '## Stones'), context: { ...d.context, round: 'novelty' } }),
      parseOptions: (jc: { round?: string }) => (jc.round === 'novelty'
        ? { extendCandidate: (_r: unknown, b: object, dir: { move: string }) => ({ ...b, move: dir.move }) } : {}),
      metaExtras: (c: { move?: string }) => (c.move ? { move: c.move, round: 'novelty' } : null),
      composeExtraLines: (meta: IdeaMeta) => (meta.round ? ['_Pure-novelty round._'] : []),
    })
    const job = await generateJob()
    expect(job.input.system).toBe(`${IDEA_GENERATE_SYSTEM_PROMPT}\nNOVELTY`)
    expect(job.input.prompt).toContain('## Stones')
    const out = await ideaGenerateHandler.apply(job, generateAnswer, 'routine')
    if (!out.ok) throw new Error(out.reason)
    const spec = m.upsertJob.mock.calls[0][1] as ThinkingJobSpec
    const ctx = readJudgeContext(spec.input.context) as IdeaJudgeContext
    expect(ctx.candidates.map((c) => c.move)).toEqual(['stop', 'test', 'stop', 'test'])

    await ideaJudgeHandler.apply(jobFrom(spec, 'job-judge'), judgeAnswer(ctx), 'routine')
    const [survivor] = m.writeTournament.mock.calls[0][1].survivors as Array<{ meta: IdeaMeta; bodyMd: string }>
    expect(survivor.meta).toMatchObject({ move: 'stop', round: 'novelty' })
    expect(survivor.bodyMd.endsWith('\n\n_Pure-novelty round._')).toBe(true)
  })

  it('beforePlanJudge defers the judge and merges its output', async () => {
    lanes.sameness.beforePlanJudge = () => ({ output: { deferred: true } })
    const out = await ideaGenerateHandler.apply(await generateJob(), generateAnswer, 'routine')
    expect(out).toMatchObject({ ok: true, memoryIds: [], output: { deferred: true } })
    expect(out.ok && out.output).not.toHaveProperty('judgeContext')
    expect(m.upsertJob).not.toHaveBeenCalled()
  })

  it('fallbackGenerate settles a lane job without a paid call; recovery can pick a lane context', async () => {
    lanes.sameness.fallbackGenerate = () => ({ ok: true, memoryIds: [], output: { settled: true } })
    expect(await ideaGenerateHandler.fallback(await generateJob())).toEqual({ ok: true, memoryIds: [], output: { settled: true } })
    expect(m.askPaidAndParse).not.toHaveBeenCalled()

    const { ctx } = await judgeJob()
    m.listJobs.mockResolvedValue([])
    lanes.sameness.pickRecoveryJudgeContext = () => ctx
    const [spec] = await ideaJudgeHandler.plan(USER, LATE)
    expect(spec.externalKey).toBe(`idea_judge:${DAY}`)
  })
})
