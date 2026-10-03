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
  listSteppingStones: vi.fn(),
  readIdeaTasteProfile: vi.fn(),
  stampIdeaOutcomeBy: vi.fn(),
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
vi.mock('@/lib/data/idea-taste', () => ({
  listSteppingStones: m.listSteppingStones,
  readIdeaTasteProfile: m.readIdeaTasteProfile,
  stampIdeaOutcomeBy: m.stampIdeaOutcomeBy,
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: m.hasJobWithKeyLike, upsertJob: m.upsertJob, listJobs: m.listJobs }))
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: m.aetherRanToday }))
vi.mock('@/lib/kairos/embeddings', () => ({ embedOne: m.embedOne }))
vi.mock('@/lib/kairos/retrieve', () => ({ searchSubstrateForChat: m.searchSubstrateForChat }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: m.writeCronSuccessTrace, writeCronFailureTrace: m.writeCronFailureTrace }))
vi.mock('../paid-fallback', () => ({ askPaidAndParse: m.askPaidAndParse }))
vi.mock('../handlers/idea-ext/atlas', () => ({ atlasExtension: {} }))
vi.mock('../handlers/idea-ext/collision', () => ({ collisionExtension: {} }))
vi.mock('../handlers/idea-ext/sameness', () => ({ samenessExtension: {} }))

import { gatherIdeaInputs, ideaGenerateHandler } from '../handlers/idea-generate'
import { assembleTournament, ideaJudgeHandler } from '../handlers/idea-judge'
import { NOVELTY_ROUND_LINE, SURPRISE_LINE, steppingExtension } from '../handlers/idea-ext/stepping'
import { IDEA_GENERATE_SYSTEM_PROMPT, buildIdeaGeneratePrompt, ideaInputIds } from '@/lib/kairos/ideas/generate-prompt'
import { readJudgeContext, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { parseIdeaJudgeText } from '@/lib/kairos/ideas/judge-prompt'
import { computeElo } from '@/lib/kairos/ideas/elo'
import { NOVELTY_ROUND_ADDENDUM } from '@/lib/kairos/ideas/stepping/novelty-prompt'
import { computeIdeaTaste } from '@/lib/kairos/ideas/stepping/taste'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'

const USER = 'user-1'
const NOVELTY_DAY = '2026-10-04'
const PLAIN_DAY = '2026-10-01'
const at = (day: string) => new Date(`${day}T04:00:00Z`)
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'
const DOMINIONS = [{ id: 'dom-1', name: 'Aeon' }]
const META_KEYS = ['v', 'tournamentDate', 'generateJobId', 'judgeJobId', 'key', 'direction', 'claim', 'why', 'nextStep', 'status',
  'eliminatedReason', 'elo', 'rank', 'novelty', 'critique', 'refined', 'survivedBecause', 'outcome', 'outcomeAt']
const TOURNAMENT_KEYS = ['tournamentDate', 'answeredBy', 'written', 'candidates', 'contenders', 'matches', 'votes', 'survivors', 'eliminated']

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
const judgeAnswer = (ctx: IdeaJudgeContext, votes = true) => json({
  critiques: [crit('c1', ['refl-1']), crit('c2', ['board-1']), crit('c3', ['belief-1']), crit('c4', ['refl-1'])],
  votes: votes ? ctx.matches.map((mm) => ({ match: mm.id, winner: mm.first === 'c1' || mm.second === 'c1' ? 'c1' : mm.first })) : [],
})

function primeInputs() {
  m.listActiveDominions.mockResolvedValue(DOMINIONS)
  m.listOpenObjectives.mockResolvedValue([])
  m.getLatestAether.mockResolvedValue(null)
  m.listRecentBoardDays.mockResolvedValue([{ id: 'board-1', title: 'Board day', summary: 'finished 3', excerpt: null, dominionId: 'dom-1', createdAt: new Date() }])
  m.listTopHeldBeliefs.mockResolvedValue([{ id: 'belief-1', mind: 'aligned', domain: 'work', claim: 'small ships', dominionId: null }])
  m.listRecentConcepts.mockResolvedValue([])
  m.listOperatorReflections.mockResolvedValue([{ id: 'refl-1', title: 'Tired', summary: 'too many tabs', excerpt: null, dominionId: null, createdAt: new Date('2026-09-30T10:00:00Z') }])
  m.listIdeaOutcomes.mockResolvedValue([{ id: 'old', title: 'Old idea', direction: 'x', claim: 'c', outcome: 'accepted' }])
  m.listDirectionStats.mockResolvedValue([{ direction: 'x', survivors: 2, accepted: 1, dismissed: 1 }])
}

// Owner accepts "test" ideas and dismisses "stop" ideas in another area, with long claims.
function tasteProfile(now: Date) {
  const row = (move: string, outcome: string) => ({
    dominionId: 'dom-other', archivedAt: null, createdAt: new Date(now.getTime() - 86_400_000),
    sourceMetadata: { status: 'pending', idea: { status: 'survivor', move, outcome, claim: 'x'.repeat(300) } },
  })
  return computeIdeaTaste([...Array(4).fill(0).map(() => row('test', 'accepted')), ...Array(4).fill(0).map(() => row('stop', 'dismissed'))], now)
}

async function plan(day: string) {
  const [spec] = await ideaGenerateHandler.plan(USER, at(day))
  return spec
}

async function judgeRun(day: string, votes = true) {
  const out = await ideaGenerateHandler.apply(jobFrom(await plan(day)), generateAnswer, 'routine')
  if (!out.ok) throw new Error(out.reason)
  const spec = m.upsertJob.mock.calls[0][1] as ThinkingJobSpec
  const ctx = readJudgeContext(spec.input.context) as IdeaJudgeContext
  const job = jobFrom(spec, 'job-judge')
  const res = await ideaJudgeHandler.apply(job, judgeAnswer(ctx, votes), 'routine')
  if (!res.ok) throw new Error(res.reason)
  const input = m.writeTournament.mock.calls[0][1] as { survivors: Array<{ meta: IdeaMeta; bodyMd: string }>; others: Array<{ meta: IdeaMeta; bodyMd: string }> }
  return { ctx, job, votes, input, tournament: (res.output as { tournament: Record<string, unknown> }).tournament }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.aetherRanToday.mockResolvedValue(false)
  primeInputs()
  m.embedOne.mockImplementation(async (text: string) => [text.charCodeAt(0), 1, text.length % 3])
  m.findNearestIdeaNeighbours.mockResolvedValue([])
  m.searchSubstrateForChat.mockResolvedValue([])
  m.listEvidenceSnippets.mockImplementation(async (_u: string, ids: string[]) => ids.map(snippet))
  m.upsertJob.mockImplementation(async (_u: string, spec: ThinkingJobSpec) => ({ ...jobFrom(spec, 'job-judge'), status: 'queued' }))
  m.writeTournament.mockResolvedValue({ written: true, survivorIds: ['s1'], archivedIds: ['a1'] })
  m.listSteppingStones.mockResolvedValue([{ title: 'Kill standups', claim: 'Stop the daily standup.', reason: 'owner_dismissed' }])
  m.readIdeaTasteProfile.mockImplementation(async () => tasteProfile(new Date()))
})

afterEach(() => vi.unstubAllEnvs())

describe('flags off or observe: byte-identical plan, even on a novelty night', () => {
  it.each([
    ['off', '', ''],
    ['novelty observe', 'observe', ''],
    ['taste observe', '', 'observe'],
    ['taste on', '', '1'],
  ])('%s', async (_name, novelty, taste) => {
    vi.stubEnv('KAIROS_IDEA_NOVELTY', novelty)
    vi.stubEnv('KAIROS_IDEA_TASTE', taste)
    const inputs = await gatherIdeaInputs(USER, at(NOVELTY_DAY), DOMINIONS, [])
    const spec = await plan(NOVELTY_DAY)
    expect(spec.input.system).toBe(IDEA_GENERATE_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildIdeaGeneratePrompt(inputs))
    expect(spec.input.validMemoryIds).toEqual(ideaInputIds(inputs))
    const shadow = novelty === 'observe' ? { noveltyShadow: true } : {}
    expect(spec.input.context).toEqual({ date: NOVELTY_DAY, dominions: DOMINIONS, inputErrors: [], ...shadow })
    expect(m.listSteppingStones).not.toHaveBeenCalled()
  })

  it('novelty on leaves a plain night untouched', async () => {
    vi.stubEnv('KAIROS_IDEA_NOVELTY', '1')
    const inputs = await gatherIdeaInputs(USER, at(PLAIN_DAY), DOMINIONS, [])
    const spec = await plan(PLAIN_DAY)
    expect(spec.input.prompt).toBe(buildIdeaGeneratePrompt(inputs))
    expect(spec.input.context).toEqual({ date: PLAIN_DAY, dominions: DOMINIONS, inputErrors: [] })
  })

  it('judge meta, bodies and summary keys are unchanged with flags off on a novelty night', async () => {
    const { ctx, job, input, tournament } = await judgeRun(NOVELTY_DAY)
    for (const row of [...input.survivors, ...input.others]) {
      expect(Object.keys(row.meta)).toEqual(META_KEYS)
      expect(row.bodyMd).not.toContain(NOVELTY_ROUND_LINE)
    }
    expect(Object.keys(tournament)).toEqual(TOURNAMENT_KEYS)
    expect(ctx.candidates.every((c) => !('move' in c))).toBe(true)
    const judged = parseIdeaJudgeText(judgeAnswer(ctx), { candidates: ctx.candidates, matches: ctx.matches })
    const elo = computeElo(ctx.candidates.map((c) => c.key), ctx.pairs, judged.votes)
    const scope = { job, ctx, answeredBy: 'routine' as const, scratch: {} }
    expect(assembleTournament(ctx, 'j', judged, elo, new Map(), scope)).toEqual(assembleTournament(ctx, 'j', judged, elo, new Map()))
  })
})

describe('novelty round on', () => {
  beforeEach(() => vi.stubEnv('KAIROS_IDEA_NOVELTY', '1'))

  it('drops past outcomes, adds the addendum and the stones, marks the round', async () => {
    const spec = await plan(NOVELTY_DAY)
    expect(spec.input.system).toBe(`${IDEA_GENERATE_SYSTEM_PROMPT}\n${NOVELTY_ROUND_ADDENDUM}`)
    expect(spec.input.prompt).not.toContain('Past ideas and what the operator did')
    expect(spec.input.prompt).not.toContain('Directions so far')
    expect(spec.input.prompt).toContain('- (dismissed by the operator) Kill standups: Stop the daily standup.')
    expect(spec.input.validMemoryIds).toEqual(['board-1', 'belief-1', 'refl-1'])
    expect(spec.input.context).toMatchObject({ round: 'novelty' })
    expect(m.listSteppingStones).toHaveBeenCalledWith(USER, NOVELTY_DAY, at(NOVELTY_DAY))
  })

  it('a failed stone read still runs the round without stones', async () => {
    m.listSteppingStones.mockRejectedValue(new Error('db down'))
    const spec = await plan(NOVELTY_DAY)
    expect(spec.input.prompt).not.toContain('## Stepping stones')
    expect((spec.input.context as { inputErrors: string[] }).inputErrors).toEqual(['stepping_stones: db down'])
  })

  it('selects by distance, marks every row and the survivors\' bodies, and overrides taste', async () => {
    vi.stubEnv('KAIROS_IDEA_TASTE', '1')
    const { input, tournament } = await judgeRun(NOVELTY_DAY)
    expect(input.survivors).toHaveLength(3)
    for (const row of [...input.survivors, ...input.others]) expect(row.meta.round).toBe('novelty')
    for (const s of input.survivors) {
      expect(s.bodyMd.endsWith(`\n\n${NOVELTY_ROUND_LINE}`)).toBe(true)
      expect(s.meta.pick).toBeUndefined()
    }
    expect(m.readIdeaTasteProfile).not.toHaveBeenCalled()
    expect(tournament.stepping).toMatchObject({
      novelty: { mode: 'on', winners: input.survivors.map((s) => s.meta.key).sort() },
      taste: { mode: 'on', skipped: 'novelty_round' },
    })
  })
})

describe('taste', () => {
  it('on: two taste picks plus an off-taste surprise; move carried, surprise line shown', async () => {
    vi.stubEnv('KAIROS_IDEA_TASTE', '1')
    const { ctx, input, tournament } = await judgeRun(PLAIN_DAY, false)
    expect(ctx.candidates.map((c) => c.move)).toEqual(['stop', 'test', 'stop', 'test'])
    const picks = Object.fromEntries(input.survivors.map((s) => [s.meta.key, s.meta.pick]))
    expect(picks).toEqual({ c2: 'taste', c4: 'taste', c1: 'surprise' })
    const surprise = input.survivors.find((s) => s.meta.pick === 'surprise')!
    expect(surprise.bodyMd.endsWith(`\n\n${SURPRISE_LINE}`)).toBe(true)
    expect(input.others.every((o) => o.meta.pick === undefined && o.meta.move !== undefined)).toBe(true)
    expect(tournament.stepping).toMatchObject({ novelty: null, taste: { mode: 'on', picks, profile: { active: true } } })
  })

  it('observe: winners unchanged, shadow recorded, move stamped, no pick', async () => {
    vi.stubEnv('KAIROS_IDEA_TASTE', 'observe')
    const { input, tournament } = await judgeRun(PLAIN_DAY, false)
    expect(input.survivors.map((s) => s.meta.key)).toEqual(['c1', 'c2', 'c3'])
    for (const s of input.survivors) {
      expect(s.meta.pick).toBeUndefined()
      expect(s.meta.move).toBeDefined()
      expect(s.bodyMd).not.toContain(SURPRISE_LINE)
    }
    expect(tournament.stepping).toMatchObject({ taste: { mode: 'observe', shadow: { winners: ['c1', 'c2', 'c4'] } } })
  })

  it('an inactive profile keeps the base winners', async () => {
    vi.stubEnv('KAIROS_IDEA_TASTE', '1')
    m.readIdeaTasteProfile.mockResolvedValue(computeIdeaTaste([], new Date()))
    const { input, tournament } = await judgeRun(PLAIN_DAY, false)
    expect(input.survivors.map((s) => s.meta.key)).toEqual(['c1', 'c2', 'c3'])
    expect(tournament.stepping).toMatchObject({ taste: { skipped: 'inactive' } })
  })
})

describe('onIdeaOutcome stamps who decided', () => {
  const event = (outcome: 'accepted' | 'dismissed', kind?: 'agent' | 'operator') =>
    ({ userId: USER, memoryId: 'mem-1', meta: {}, outcome, origin: kind ? { kind, via: 'mcp' } : undefined })

  it('does nothing with taste off', async () => {
    await steppingExtension.onIdeaOutcome!(event('accepted', 'agent'))
    expect(m.stampIdeaOutcomeBy).not.toHaveBeenCalled()
  })

  it('agent accepts are agent; owner accepts and every dismiss are operator', async () => {
    vi.stubEnv('KAIROS_IDEA_TASTE', 'observe')
    await steppingExtension.onIdeaOutcome!(event('accepted', 'agent'))
    await steppingExtension.onIdeaOutcome!(event('accepted'))
    await steppingExtension.onIdeaOutcome!(event('dismissed', 'operator'))
    expect(m.stampIdeaOutcomeBy.mock.calls.map((c) => c[2])).toEqual(['agent', 'operator', 'operator'])
  })
})
