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
  listCollisionCandidates: vi.fn(),
  readLatestAetherEmbedding: vi.fn(),
  listRecentCollisionPairKeys: vi.fn(),
  memoriesLive: vi.fn(),
  recordBridgeLinked: vi.fn(),
  addLink: vi.fn(),
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
vi.mock('@/lib/data/idea-bridges', () => ({
  listCollisionCandidates: m.listCollisionCandidates,
  readLatestAetherEmbedding: m.readLatestAetherEmbedding,
  listRecentCollisionPairKeys: m.listRecentCollisionPairKeys,
  memoriesLive: m.memoriesLive,
  recordBridgeLinked: m.recordBridgeLinked,
}))
vi.mock('@/lib/data/memories', () => ({ addLink: m.addLink }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: m.hasJobWithKeyLike, upsertJob: m.upsertJob, listJobs: m.listJobs }))
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: m.aetherRanToday }))
vi.mock('@/lib/kairos/embeddings', () => ({ embedOne: m.embedOne }))
vi.mock('@/lib/kairos/retrieve', () => ({ searchSubstrateForChat: m.searchSubstrateForChat }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: m.writeCronSuccessTrace, writeCronFailureTrace: m.writeCronFailureTrace }))
vi.mock('../paid-fallback', () => ({ askPaidAndParse: m.askPaidAndParse }))
// Other lanes stay empty so this suite sees lane B alone.
vi.mock('../handlers/idea-ext/stepping', () => ({ steppingExtension: {} }))
vi.mock('../handlers/idea-ext/atlas', () => ({ atlasExtension: {} }))
vi.mock('../handlers/idea-ext/sameness', () => ({ samenessExtension: {} }))

import { gatherIdeaInputs, ideaGenerateHandler } from '../handlers/idea-generate'
import { ideaJudgeHandler } from '../handlers/idea-judge'
import { IDEA_GENERATE_SYSTEM_PROMPT, buildIdeaGeneratePrompt, ideaInputIds } from '@/lib/kairos/ideas/generate-prompt'
import { readJudgeContext, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { IDEA_DATA_BEGIN, IDEA_DATA_END } from '@/lib/kairos/ideas/prompt-data'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'
import { COLLISION_SYSTEM_ADDENDUM } from '@/lib/kairos/collision/prompt'

const USER = 'user-1'
const DAY = '2026-10-01'
const LATE = new Date(`${DAY}T04:00:00Z`)
const DAY_MS = 86_400_000
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'
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
const cand = (title: string, evidenceIds: string[], direction = 'd1', extra: object = {}) =>
  ({ direction, title, claim: `${title} claim`, why: 'why', nextStep: 'step', evidenceIds, ...extra })
const DIRECTIONS = [{ id: 'd1', label: 'Stop', move: 'stop', dominion: 'Aeon' }, { id: 'd2', label: 'Test', move: 'test', dominion: null }]
const BASE_CANDIDATES = [cand('Alpha', ['refl-1']), cand('Beta', ['board-1'], 'd2'), cand('Gamma', ['belief-1']), cand('Delta', ['refl-1'], 'd2')]
const BLEND = {
  pair: 'p1',
  holds: true,
  a: [{ rel: 'blocks', x: 'standup', y: 'deep work' }, { rel: 'fragments', x: 'meetings', y: 'deep work' }],
  b: [{ rel: 'crowds', x: 'weeds', y: 'seedlings' }, { rel: 'starves', x: 'shade', y: 'seedlings' }],
  map: [{ a: 'standup', b: 'weeds' }, { a: 'deep work', b: 'seedlings' }, { a: 'meetings', b: 'shade' }],
  insight: 'Clear what crowds focus before adding more.',
}
const plainAnswer = json({ directions: DIRECTIONS, candidates: BASE_CANDIDATES })
const blendAnswer = json({
  directions: DIRECTIONS,
  candidates: [
    ...BASE_CANDIDATES,
    cand('Focus garden', ['mem-a', 'mem-b'], 'd1', { blend: 'p1' }),
    cand('Second garden', ['mem-a', 'mem-b'], 'd2', { blend: 'p1' }),
  ],
  blends: [BLEND],
})

const GENERATE_OUTPUT_KEYS = ['tournamentDate', 'answeredBy', 'directions', 'candidates', 'dropped', 'contenders', 'embedFailures', 'judgeContext', 'judgeJobId']
const STORED_KEYS = ['key', 'direction', 'title', 'claim', 'why', 'nextStep', 'citedIds', 'novelty', 'evidenceIds', 'vector']

function prime() {
  m.listActiveDominions.mockResolvedValue(DOMINIONS)
  m.listOpenObjectives.mockResolvedValue([])
  m.getLatestAether.mockResolvedValue({ id: 'aether-1', createdAt: LATE, payload: { coreNarrative: 'n', thoughts: [], tensions: [] } })
  m.listRecentBoardDays.mockResolvedValue([{ id: 'board-1', title: 'Board day', summary: 'finished 3', excerpt: null, dominionId: 'dom-1', createdAt: LATE }])
  m.listTopHeldBeliefs.mockResolvedValue([{ id: 'belief-1', mind: 'aligned', domain: 'work', claim: 'small ships', dominionId: null }])
  m.listRecentConcepts.mockResolvedValue([])
  m.listOperatorReflections.mockResolvedValue([{ id: 'refl-1', title: 'Tired', summary: 'too many tabs', excerpt: null, dominionId: null, createdAt: LATE }])
  m.listIdeaOutcomes.mockResolvedValue([])
  m.listDirectionStats.mockResolvedValue([])
  m.listCollisionCandidates.mockResolvedValue([
    { id: 'mem-a', dominionId: 'dom-1', title: 'Standup ritual', summary: 'Morning standup blocks deep work and meetings fragment deep work',
      createdAt: new Date(LATE.getTime() - 100 * DAY_MS), embedding: [1, 1, 0], linkedIds: [] },
    { id: 'mem-b', dominionId: 'dom-2', title: 'Garden notes', summary: 'Weeds crowd seedlings and shade starves seedlings',
      createdAt: new Date(LATE.getTime() - DAY_MS), embedding: [1, -0.6, 0], linkedIds: [] },
  ])
  m.readLatestAetherEmbedding.mockResolvedValue([1, 0, 0])
  m.listRecentCollisionPairKeys.mockResolvedValue(new Set())
}

beforeEach(() => {
  vi.clearAllMocks()
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.aetherRanToday.mockResolvedValue(false)
  prime()
  m.embedOne.mockImplementation(async (text: string) => [text.charCodeAt(0), 1, 0])
  m.findNearestIdeaNeighbours.mockResolvedValue([])
  m.searchSubstrateForChat.mockResolvedValue([])
  m.listEvidenceSnippets.mockImplementation(async (_u: string, ids: string[]) => ids.map(snippet))
  m.upsertJob.mockImplementation(async (_u: string, spec: ThinkingJobSpec) => ({ ...jobFrom(spec, 'job-judge'), status: 'queued' }))
  m.writeTournament.mockResolvedValue({ written: true, survivorIds: ['s1'], archivedIds: ['a1'] })
})
afterEach(() => vi.unstubAllEnvs())

async function planSpec(): Promise<ThinkingJobSpec> {
  const [spec] = await ideaGenerateHandler.plan(USER, LATE)
  return spec
}

describe('KAIROS_COLLISIONS unset: byte-identical', () => {
  it('plan spec equals the baseline and the loader is never called', async () => {
    const inputs = await gatherIdeaInputs(USER, LATE, DOMINIONS, [])
    const spec = await planSpec()
    expect(spec.input.system).toBe(IDEA_GENERATE_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildIdeaGeneratePrompt(inputs))
    expect(spec.input.validMemoryIds).toEqual(ideaInputIds(inputs))
    expect(spec.input.context).toEqual({ date: DAY, dominions: DOMINIONS, inputErrors: [] })
    expect(spec.input.context).not.toHaveProperty('collision')
    expect(m.listCollisionCandidates).not.toHaveBeenCalled()
    expect(m.readLatestAetherEmbedding).not.toHaveBeenCalled()
  })

  it('apply output and stored candidates carry no collision keys, even for a blend answer', async () => {
    const out = await ideaGenerateHandler.apply(jobFrom(await planSpec()), blendAnswer, 'routine')
    if (!out.ok) throw new Error(out.reason)
    expect(Object.keys(out.output!)).toEqual(GENERATE_OUTPUT_KEYS)
    const judge = out.output!.judgeContext as IdeaJudgeContext
    for (const c of judge.candidates) expect(Object.keys(c)).toEqual(STORED_KEYS)
  })
})

describe('observe', () => {
  it('stores pairs in the context only; prompt, system and ids are identical', async () => {
    vi.stubEnv('KAIROS_COLLISIONS', 'observe')
    const inputs = await gatherIdeaInputs(USER, LATE, DOMINIONS, [])
    const spec = await planSpec()
    expect(spec.input.system).toBe(IDEA_GENERATE_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildIdeaGeneratePrompt(inputs))
    expect(spec.input.validMemoryIds).toEqual(ideaInputIds(inputs))
    const ctx = spec.input.context as { collision: { mode: string; anchor: string; pairs: Array<{ pairKey: string; aArea: string | null }> } }
    expect(ctx.collision).toMatchObject({ mode: 'observe', anchor: 'aether' })
    expect(ctx.collision.pairs.map((p) => [p.pairKey, p.aArea])).toEqual([['mem-a:mem-b', 'Aeon']])

    const out = await ideaGenerateHandler.apply(jobFrom(spec), plainAnswer, 'routine')
    if (!out.ok) throw new Error(out.reason)
    expect(Object.keys(out.output!)).toEqual(GENERATE_OUTPUT_KEYS)
  })
})

describe('on', () => {
  beforeEach(() => vi.stubEnv('KAIROS_COLLISIONS', '1'))

  it('offers the pairs inside the data block, makes them citable and adds the addendum', async () => {
    const spec = await planSpec()
    const prompt = spec.input.prompt
    const at = prompt.indexOf('## Far-apart pairs to collide')
    expect(at).toBeGreaterThan(prompt.indexOf(IDEA_DATA_BEGIN))
    expect(at).toBeLessThan(prompt.indexOf(IDEA_DATA_END))
    expect(prompt).toContain('- p1 A: [mem-a] (Aeon · 2026-06-23) Standup ritual — Morning standup')
    expect(prompt).toContain('B: [mem-b] (cross-cutting · 2026-09-30) Garden notes')
    expect(spec.input.system).toBe(`${IDEA_GENERATE_SYSTEM_PROMPT}\n${COLLISION_SYSTEM_ADDENDUM}`)
    expect(spec.input.validMemoryIds).toEqual(expect.arrayContaining(['mem-a', 'mem-b']))
  })

  it('no pairs: context only, prompt unchanged', async () => {
    m.listCollisionCandidates.mockResolvedValue([])
    const inputs = await gatherIdeaInputs(USER, LATE, DOMINIONS, [])
    const spec = await planSpec()
    expect(spec.input.prompt).toBe(buildIdeaGeneratePrompt(inputs))
    expect(spec.input.system).toBe(IDEA_GENERATE_SYSTEM_PROMPT)
    expect(spec.input.context).toMatchObject({ collision: { mode: 'on', pairs: [] } })
  })

  it('a failed candidate read is a soft input error', async () => {
    m.listCollisionCandidates.mockRejectedValue(new Error('db down'))
    const spec = await planSpec()
    expect(spec.input.context).not.toHaveProperty('collision')
    expect((spec.input.context as { inputErrors: string[] }).inputErrors).toEqual(['collision.candidates: db down'])
  })

  it('gates blends end to end and carries the bridge to the idea', async () => {
    const out = await ideaGenerateHandler.apply(jobFrom(await planSpec()), blendAnswer, 'routine')
    if (!out.ok) throw new Error(out.reason)
    expect(out.output!.collision).toEqual({ offered: 1, blends: 2, declined: 0, kept: 1, dropped: { duplicate_pair: 1 } })
    const spec = m.upsertJob.mock.calls[0][1] as ThinkingJobSpec
    const ctx = readJudgeContext(spec.input.context) as IdeaJudgeContext
    expect(ctx.candidates.map((c) => c.title)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Focus garden'])
    const bridged = ctx.candidates[4]
    expect(bridged.blend).toBe('p1')
    expect(bridged.bridge).toMatchObject({ pairKey: 'mem-a:mem-b', aArea: 'Aeon', bArea: null, mappingHolds: null })
    expect(ctx.candidates.slice(0, 4).every((c) => c.bridge === undefined && c.blend === undefined)).toBe(true)

    const crit = (key: string) => ({ key, verdict: 'grounded', supports: [ctx.candidates.find((c) => c.key === key)!.citedIds[0]], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: 'ok' })
    const judgeAnswer = json({
      critiques: ctx.candidates.map((c) => crit(c.key)),
      votes: ctx.matches.map((mm) => ({ match: mm.id, winner: mm.first === 'c5' || mm.second === 'c5' ? 'c5' : mm.first })),
    })
    const judged = await ideaJudgeHandler.apply(jobFrom(spec, 'job-judge'), judgeAnswer, 'routine')
    if (!judged.ok) throw new Error(judged.reason)
    const input = m.writeTournament.mock.calls[0][1] as { survivors: Array<{ title: string; meta: IdeaMeta; bodyMd: string }>; others: Array<{ meta: IdeaMeta }> }
    const row = input.survivors.find((s) => s.title === 'Focus garden')!
    expect(row.meta.bridge).toEqual({ ...bridged.bridge, mappingHolds: null })
    expect(row.bodyMd).toContain('**Collision.** Aeon ↔ cross-cutting — Clear what crowds focus before adding more.')
    for (const r of [...input.survivors, ...input.others].filter((r) => r.meta.key !== 'c5')) expect(r.meta).not.toHaveProperty('bridge')
  })
})
