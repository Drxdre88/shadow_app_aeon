import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'

const m = vi.hoisted(() => ({
  writeTournament: vi.fn(),
  listEvidenceSnippets: vi.fn(),
  empty: vi.fn(async () => []),
  upsertJob: vi.fn(),
  embedOne: vi.fn(),
  readAtlas: vi.fn(),
  mutateAtlas: vi.fn(),
  saved: null as unknown,
}))

vi.mock('@/lib/data/ideas', () => ({
  IDEA_JUDGE_FAILED_REASON: 'judge_failed',
  findNearestIdeaNeighbours: vi.fn(async () => []),
  writeTournament: m.writeTournament,
  listIdeaOutcomes: m.empty,
  listDirectionStats: m.empty,
}))
vi.mock('@/lib/data/idea-inputs', () => ({
  getLatestAether: vi.fn(async () => null),
  listActiveDominions: vi.fn(async () => [{ id: 'dom-1', name: 'Aeon' }, { id: 'dom-2', name: 'Health' }]),
  listEvidenceSnippets: m.listEvidenceSnippets,
  listOpenObjectives: m.empty,
  listOperatorReflections: vi.fn(async () => [{ id: 'refl-1', title: 'Tired', summary: 'tabs', excerpt: null, dominionId: null, createdAt: new Date('2026-10-01T00:00:00Z') }]),
  listRecentBoardDays: vi.fn(async () => [{ id: 'board-1', title: 'Gym', summary: null, excerpt: null, dominionId: 'dom-2', createdAt: new Date('2026-10-01T00:00:00Z') }]),
  listRecentConcepts: m.empty,
  listTopHeldBeliefs: m.empty,
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(async () => false), upsertJob: m.upsertJob, listJobs: m.empty }))
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: vi.fn(async () => true) }))
vi.mock('@/lib/kairos/embeddings', () => ({ embedOne: m.embedOne }))
vi.mock('@/lib/kairos/retrieve', () => ({ searchSubstrateForChat: vi.fn(async () => []) }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: vi.fn(), writeCronFailureTrace: vi.fn() }))
vi.mock('../paid-fallback', () => ({ askPaidAndParse: vi.fn() }))
vi.mock('@/lib/data/kairos-idea-atlas', () => ({ readKairosIdeaAtlas: m.readAtlas, mutateKairosIdeaAtlas: m.mutateAtlas }))

import { ideaGenerateHandler } from '../handlers/idea-generate'
import { assembleTournament, ideaJudgeHandler } from '../handlers/idea-judge'
import { atlasExtension } from '../handlers/idea-ext/atlas'
import { IDEA_GENERATE_SYSTEM_PROMPT } from '@/lib/kairos/ideas/generate-prompt'
import { IDEA_JUDGE_SYSTEM_PROMPT, buildIdeaJudgePrompt } from '@/lib/kairos/ideas/judge-prompt'
import { contenders, readJudgeContext, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { scheduleMatches } from '@/lib/kairos/ideas/pairing'
import { IDEA_DATA_END } from '@/lib/kairos/ideas/prompt-data'
import { withAtlasSystem } from '@/lib/kairos/ideas/atlas/prompt'
import { emptyIdeaAtlasState, type KairosIdeaAtlasState } from '@/lib/data/validators/kairos-idea-atlas'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'

const USER = 'user-1'
const DAY = '2026-10-01'
const NOW = new Date(`${DAY}T03:45:00Z`)
const HELD = 'dom-1|experiment|near'
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'

function jobFrom(spec: ThinkingJobSpec, id: string): ThinkingJobRow {
  return {
    id, userId: USER, kind: spec.kind, dominionId: spec.dominionId, externalKey: spec.externalKey, status: 'claimed',
    input: spec.input, output: null, claimedBy: 'routine', claimToken: 't', claimedAt: NOW, deadlineAt: NOW,
    completedAt: null, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
  }
}

function heldState(): KairosIdeaAtlasState {
  const s = emptyIdeaAtlasState()
  s.cells[HELD] = {
    area: 'dom-1', kind: 'experiment', leap: 'near', tries: 1, targetedOn: null, lastChallengeOn: null,
    holder: { memoryId: 'held-mem', title: 'Held idea', claim: 'held claim', since: '2026-09-20', elo: 1015, defended: 0 },
  }
  return s
}

const item = (title: string, evidenceIds: string[], tags: Record<string, unknown>) =>
  ({ direction: 'd1', title, claim: `${title} claim`, why: 'w', nextStep: 's', evidenceIds, ...tags })
const generateAnswer = json({
  directions: [{ id: 'd1', label: 'Stop', move: 'stop', dominion: null }, { id: 'd2', label: 'Test', move: 'test', dominion: 'Health' }],
  candidates: [
    item('Alpha', ['refl-1'], { kind: 'experiment', leap: 'near' }),
    item('Beta', ['refl-1', 'board-1'], { kind: 'ritual', leap: 'far' }),
    item('Gamma', ['board-1'], {}),
    item('Delta', ['board-1'], { kind: 'make', leap: 'near' }),
  ],
})
const crit = (key: string) => ({ key, verdict: 'grounded', supports: ['refl-1', 'board-1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '' })
const judgeAnswer = (ctx: IdeaJudgeContext) => json({
  critiques: contenders(ctx).map((c) => crit(c.key)),
  votes: ctx.matches.map((mm) => ({ match: mm.id, winner: mm.first === 'c1' || mm.second === 'c1' ? 'c1' : mm.first })),
})

async function night(): Promise<{ gen: ThinkingJobSpec; judge: ThinkingJobRow; ctx: IdeaJudgeContext; out: Awaited<ReturnType<typeof ideaJudgeHandler.apply>> }> {
  const [gen] = await ideaGenerateHandler.plan(USER, NOW)
  const g = await ideaGenerateHandler.apply(jobFrom(gen, 'job-gen'), generateAnswer, 'routine')
  if (!g.ok) throw new Error(g.reason)
  const judge = jobFrom(m.upsertJob.mock.calls[0][1] as ThinkingJobSpec, 'job-judge')
  const ctx = readJudgeContext(judge.input.context) as IdeaJudgeContext
  const out = await ideaJudgeHandler.apply(judge, judgeAnswer(ctx), 'routine')
  return { gen, judge, ctx, out }
}

const metas = (): IdeaMeta[] => {
  const input = m.writeTournament.mock.calls[0][1]
  return [...input.survivors, ...input.others].map((r: { meta: IdeaMeta }) => r.meta)
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KAIROS_IDEA_ATLAS
  delete process.env.KAIROS_IDEA_SWISS
  m.saved = null
  m.embedOne.mockImplementation(async (text: string) => [text.charCodeAt(0), 1, 0])
  const dom: Record<string, string> = { 'refl-1': 'dom-1', 'board-1': 'dom-2' }
  m.listEvidenceSnippets.mockImplementation(async (_u: string, ids: string[]) =>
    ids.map((id) => ({ id, title: `t ${id}`, text: 'x', dominionId: dom[id] ?? null, origin: 'operator', kind: null, type: 'reflection' })))
  m.upsertJob.mockImplementation(async (_u: string, spec: ThinkingJobSpec) => ({ ...jobFrom(spec, 'job-judge'), status: 'queued' }))
  m.writeTournament.mockImplementation(async (_u: string, input: { survivors: unknown[]; others: unknown[] }) =>
    ({ written: true, survivorIds: input.survivors.map((_, i) => `s${i + 1}`), archivedIds: input.others.map((_, i) => `a${i + 1}`) }))
  m.readAtlas.mockResolvedValue(heldState())
  m.mutateAtlas.mockImplementation(async (_u: string, fn: (s: KairosIdeaAtlasState) => { state: unknown; result: unknown }) => {
    const r = fn(heldState())
    m.saved = r.state
    return r.result
  })
})

describe('flags off: byte-identical', () => {
  it('prompts, contexts, rows and outputs carry nothing from lane A; the atlas is never read', async () => {
    const { gen, judge, ctx, out } = await night()
    expect(gen.input.system).toBe(IDEA_GENERATE_SYSTEM_PROMPT)
    expect(gen.input.context).not.toHaveProperty('atlas')
    expect(ctx).not.toHaveProperty('atlas')
    expect(ctx).not.toHaveProperty('swiss')
    for (const c of ctx.candidates) for (const k of ['kind', 'leap', 'atlas']) expect(c).not.toHaveProperty(k)
    const base = scheduleMatches(contenders(ctx).map((c) => c.key))
    expect(ctx.pairs).toEqual(base.pairs)
    expect(ctx.matches).toEqual(base.matches)
    expect(judge.input.system).toBe(IDEA_JUDGE_SYSTEM_PROMPT)
    expect(judge.input.prompt).toBe(buildIdeaJudgePrompt({ date: ctx.date, candidates: contenders(ctx), evidence: ctx.evidence, nearest: ctx.nearest, matches: ctx.matches }))
    expect(out.ok).toBe(true)
    for (const meta of metas()) expect(meta).not.toHaveProperty('atlas')
    expect(out.ok && out.output?.tournament).not.toHaveProperty('atlas')
    expect(out.ok && out.output?.tournament).not.toHaveProperty('swiss')
    expect(m.readAtlas).not.toHaveBeenCalled()
    expect(m.mutateAtlas).not.toHaveBeenCalled()
  })
})

describe('observe', () => {
  it('tags and fills empty cells only: no targets, no challenges, prompt data unchanged', async () => {
    const { gen: off } = await (async () => ({ gen: (await ideaGenerateHandler.plan(USER, NOW))[0] }))()
    process.env.KAIROS_IDEA_ATLAS = 'observe'
    const { gen, judge, ctx, out } = await night()
    expect(gen.input.system).toBe(withAtlasSystem(IDEA_GENERATE_SYSTEM_PROMPT))
    expect(gen.input.prompt).toBe(off.input.prompt)
    expect(gen.input.context).toMatchObject({ atlas: { v: 1, mode: 'observe', targets: [] } })
    expect(ctx.candidates.map((c) => c.atlas?.cell ?? null)).toEqual([HELD, 'dom-1|ritual|far', null, 'dom-2|make|near'])
    expect(ctx.atlas).toMatchObject({ mode: 'observe', holders: [], challenges: [], areas: ['dom-1', 'dom-2'] })
    expect(judge.input.system).toBe(IDEA_JUDGE_SYSTEM_PROMPT)
    expect(out.ok).toBe(true)
    const byKey = new Map(metas().map((x) => [x.key, x]))
    expect(byKey.get('c1')?.atlas).toEqual({ cell: HELD, area: 'dom-1', kind: 'experiment', leap: 'near', leapClaimed: 'near', took: null })
    expect(byKey.get('c2')?.atlas).toMatchObject({ cell: 'dom-1|ritual|far', leapClaimed: 'far', took: 'filled' })
    expect(byKey.get('c3')).not.toHaveProperty('atlas')
    const saved = m.saved as KairosIdeaAtlasState
    expect(saved.cells[HELD].holder?.memoryId).toBe('held-mem')
    expect(saved.cells['dom-1|ritual|far'].holder?.title).toBe('Beta')
    expect(out.ok && out.output?.tournament).toMatchObject({ atlas: { mode: 'observe', filled: 2, replaced: 0, applied: true } })
  })
})

describe('B2 selection (lane B bridge)', () => {
  const novelty = { class: 'novel' as const, maxCosine: 0.2, nearestId: null, nearestKind: null }
  const bridge = { v: 1, pairKey: 'p', aId: 'a', bId: 'b', aArea: null, bArea: null, cos: 0.3, relations: [], map: [], insight: 'i', mappingHolds: null }
  const cand = (key: string, extra: Record<string, unknown> = {}) =>
    ({ key, direction: 'Stop', title: key, claim: 'c', why: 'w', nextStep: 's', citedIds: ['e1'], novelty, evidenceIds: ['e1'], vector: null, ...extra })
  const crit = (mappingHolds?: boolean | null) => ({
    verdict: 'grounded' as const, supports: ['e1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '',
    ...(mappingHolds === undefined ? {} : { mappingHolds }),
  })

  it('mappingHolds false on a bridged candidate → mapping_failed; null or unbridged → kept', () => {
    const ctx = readJudgeContext({
      date: DAY, generateJobId: 'g', evidence: {}, nearest: {}, pairs: [], matches: [],
      candidates: [cand('c1', { bridge }), cand('c2', { bridge }), cand('c3')],
    }) as IdeaJudgeContext
    const judged = { critiques: new Map([['c1', crit(false)], ['c2', crit(null)], ['c3', crit()]]), votes: new Map(), refinements: new Map() }
    const rows = assembleTournament(ctx, 'j', judged, new Map(), new Map())
    expect(rows.selection.map((s) => [s.key, s.status, s.eliminatedReason])).toEqual([
      ['c1', 'eliminated', 'mapping_failed'], ['c2', 'survivor', null], ['c3', 'survivor', null],
    ])
  })
})

describe('on', () => {
  it('targets empty cells, challenges the holder anonymously and replaces it on a both-orders win', async () => {
    process.env.KAIROS_IDEA_ATLAS = '1'
    const { gen, judge, ctx, out } = await night()
    const targets = (gen.input.context as { atlas: { targets: string[] } }).atlas.targets
    expect(targets).toHaveLength(4)
    expect(targets).not.toContain(HELD)
    const p = gen.input.prompt
    expect(p.indexOf('## Atlas gaps')).toBeGreaterThan(0)
    expect(p.indexOf('## Atlas gaps')).toBeLessThan(p.indexOf(IDEA_DATA_END))
    expect(ctx.atlas).toMatchObject({ mode: 'on', holders: [{ id: 'h1', cell: HELD }], challenges: [{ a: 'c1', b: 'h1', cell: HELD }] })
    expect(ctx.pairs.some((pp) => pp.b === 'h1' || pp.a === 'h1')).toBe(false)
    expect(judge.input.prompt).toContain('### h1 · an earlier idea')
    expect(judge.input.prompt).not.toContain('held-mem')
    expect(out.ok).toBe(true)
    const byKey = new Map(metas().map((x) => [x.key, x]))
    expect(byKey.get('c1')?.atlas?.took).toBe('replaced')
    expect(byKey.get('c2')?.atlas?.took).toBe('filled')
    const saved = m.saved as KairosIdeaAtlasState
    expect(saved.cells[HELD].holder).toMatchObject({ memoryId: 's1', title: 'Alpha', since: DAY })
    expect(saved.history[0]).toMatchObject({ date: DAY, filled: 2, replaced: 1, targets })
    expect(out.ok && out.output?.tournament).toMatchObject({ atlas: { mode: 'on', challenges: 1, replaced: 1, filled: 2 } })
  })

  it('a novelty night keeps the tags but drops the targets', async () => {
    process.env.KAIROS_IDEA_ATLAS = 'on'
    const draft = { system: 'S', prompt: `x\n${IDEA_DATA_END}\n`, validMemoryIds: [], context: { date: DAY, dominions: [], inputErrors: [], round: 'novelty' } }
    const out = await atlasExtension.planGenerate!(draft, { userId: USER, now: NOW, day: DAY, dominions: [], errors: [], inputs: {} as never })
    expect(out.prompt).toBe(draft.prompt)
    expect(out.context).toMatchObject({ atlas: { mode: 'on', targets: [] } })
    expect(m.readAtlas).not.toHaveBeenCalled()
  })

  it('a live novelty night: no holder challenge planned or applied; empty cells still fill', async () => {
    process.env.KAIROS_IDEA_ATLAS = 'on'
    const { judge, ctx } = await night()
    const crits = new Map(contenders(ctx).map((c) => [c.key, { verdict: 'grounded' as const, supports: ['refl-1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '' }]))
    const votes = new Map(ctx.matches.map((mm) => [mm.id, mm.first === 'c1' || mm.second === 'c1' ? 'c1' : mm.first]))
    const scope = { job: judge, ctx, answeredBy: 'routine' as const, scratch: { stepping: { novelty: 'on' } } as Record<string, unknown> }
    await atlasExtension.prepareJudge!({ critiques: crits, votes, refinements: new Map() }, scope)
    const scratch = scope.scratch.atlas as { outcomes: unknown[]; decision: { took: Map<string, string> } }
    expect(scratch.outcomes).toEqual([])
    expect([...scratch.decision.took]).toEqual([['c2', 'filled'], ['c4', 'filled']])

    m.readAtlas.mockClear()
    const { atlas: _drop, ...plain } = ctx
    const base = scheduleMatches(contenders(ctx).map((c) => c.key))
    const jobContext = { atlas: { v: 1, mode: 'on', targets: [] }, dominions: [{ id: 'dom-1', name: 'Aeon' }], round: 'novelty' }
    const grounded = { directions: [], candidates: [], dropped: { ungrounded: 0, unknownDirection: 0, overCap: 0 } }
    const extras = await atlasExtension.buildJudgeContextExtras!({ ...plain, pairs: base.pairs, matches: base.matches }, { job: judge, jobContext, answeredBy: 'routine', scratch: {}, grounded })
    expect(extras.atlas).toMatchObject({ mode: 'on', holders: [], challenges: [] })
    expect(extras.matches).toEqual(base.matches)
    expect(m.readAtlas).not.toHaveBeenCalled()
  })

  it('atlas failures never fail the night', async () => {
    process.env.KAIROS_IDEA_ATLAS = 'on'
    m.readAtlas.mockRejectedValue(new Error('prefs corrupt'))
    m.mutateAtlas.mockRejectedValue(new Error('db down'))
    const { gen, ctx, out } = await night()
    expect((gen.input.context as { inputErrors: string[] }).inputErrors).toEqual(['atlas: prefs corrupt'])
    expect(ctx.atlas).toMatchObject({ holders: [], challenges: [] })
    expect(out.ok).toBe(true)
    expect(m.writeTournament).toHaveBeenCalledTimes(1)
    expect(metas().find((x) => x.key === 'c1')?.atlas?.took).toBeNull()
  })
})
