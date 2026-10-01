import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/lib/data/ideas', () => ({
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

import { ideaGenerateHandler, IDEA_TOURNAMENT_CRON } from '../handlers/idea-generate'
import { ideaJudgeHandler } from '../handlers/idea-judge'
import { readJudgeContext, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { ELO_START, type IdeaMeta } from '@/lib/kairos/ideas/types'

const USER = 'user-1'
const DAY = '2026-10-01'
const EARLY = new Date(`${DAY}T03:00:00Z`)
const LATE = new Date(`${DAY}T04:00:00Z`)
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'

function jobFrom(spec: ThinkingJobSpec, id = 'job-gen'): ThinkingJobRow {
  const now = new Date()
  return {
    id, userId: USER, kind: spec.kind, dominionId: spec.dominionId, externalKey: spec.externalKey, status: 'claimed',
    input: spec.input, output: null, claimedBy: 'routine', claimToken: 't', claimedAt: now, deadlineAt: now,
    completedAt: null, attempts: 1, error: null, createdAt: now, updatedAt: now,
  }
}

const snippet = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, title: `title ${id}`, text: `text ${id}`, dominionId: 'dom-1', origin: 'operator', kind: null, type: 'reflection', ...over })

function primeInputs() {
  m.listActiveDominions.mockResolvedValue([{ id: 'dom-1', name: 'Aeon' }])
  m.listOpenObjectives.mockResolvedValue([{ dominionId: 'dom-1', title: 'Ship P3', status: 'active', targetDate: null }])
  m.getLatestAether.mockResolvedValue({ id: 'aether-1', createdAt: EARLY, payload: { coreNarrative: 'n', thoughts: [], tensions: [] } })
  m.listRecentBoardDays.mockResolvedValue([{ id: 'board-1', title: 'Board day', summary: 'finished 3', excerpt: null, dominionId: 'dom-1', createdAt: EARLY }])
  m.listTopHeldBeliefs.mockResolvedValue([{ id: 'belief-1', mind: 'aligned', domain: 'work', claim: 'small ships', dominionId: null }])
  m.listRecentConcepts.mockResolvedValue([])
  m.listOperatorReflections.mockResolvedValue([{ id: 'refl-1', title: 'Tired', summary: 'too many tabs', excerpt: null, dominionId: null, createdAt: EARLY }])
  m.listIdeaOutcomes.mockResolvedValue([{ id: 'old', title: 'Old', direction: 'x', claim: 'c', outcome: 'accepted' }])
  m.listDirectionStats.mockResolvedValue([])
}

const directions = [
  { id: 'd1', label: 'Stop', move: 'stop', dominion: 'Aeon' },
  { id: 'd2', label: 'Test', move: 'test', dominion: null },
]
const cand = (title: string, evidenceIds: string[], direction = 'd1') =>
  ({ direction, title, claim: `${title} claim`, why: 'why', nextStep: 'step', evidenceIds })
const generateAnswer = json({
  directions,
  candidates: [
    cand('Alpha', ['refl-1', 'bogus']),
    cand('Beta', ['board-1'], 'd2'),
    cand('Gamma', ['belief-1']),
    cand('Delta', ['bogus']),
  ],
})

async function plannedGenerateJob(): Promise<ThinkingJobRow> {
  const [spec] = await ideaGenerateHandler.plan(USER, LATE)
  return jobFrom(spec)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.aetherRanToday.mockResolvedValue(false)
  primeInputs()
  m.embedOne.mockImplementation(async (text: string) => [text.charCodeAt(0), 1, 0])
  m.findNearestIdeaNeighbours.mockResolvedValue([])
  m.searchSubstrateForChat.mockResolvedValue([{ id: 'ret-1' }, { id: 'old-idea' }])
  m.listEvidenceSnippets.mockImplementation(async (_u: string, ids: string[]) =>
    ids.map((id) => (id === 'old-idea' ? snippet(id, { kind: 'idea', origin: 'kairos' }) : snippet(id))))
  m.upsertJob.mockImplementation(async (_u: string, spec: ThinkingJobSpec) => ({ ...jobFrom(spec, 'job-judge'), status: 'queued' }))
  m.writeTournament.mockResolvedValue({ written: true, survivorIds: ['s1'], archivedIds: ['a1', 'a2'] })
})

describe('idea_generate plan', () => {
  it('waits for today\'s Aether before 03:30Z, then plans once with the inputs', async () => {
    expect(await ideaGenerateHandler.plan(USER, EARLY)).toEqual([])
    m.aetherRanToday.mockResolvedValueOnce(true)
    const [early] = await ideaGenerateHandler.plan(USER, EARLY)
    expect(early.externalKey).toBe(`idea_generate:${DAY}`)
    const [spec] = await ideaGenerateHandler.plan(USER, LATE)
    expect(spec).toMatchObject({ kind: 'idea_generate', deadlineMinutes: 55, dominionId: null })
    expect(spec.input.validMemoryIds).toEqual(expect.arrayContaining(['aether-1', 'board-1', 'belief-1', 'refl-1']))
    expect(spec.input.prompt).toContain('Ship P3')
    expect(spec.input.prompt).toContain('accepted · x · Old: c')
  })

  it('skips when today\'s job exists or no Dominion is active', async () => {
    m.hasJobWithKeyLike.mockResolvedValueOnce(true)
    expect(await ideaGenerateHandler.plan(USER, LATE)).toEqual([])
    m.listActiveDominions.mockResolvedValueOnce([])
    expect(await ideaGenerateHandler.plan(USER, LATE)).toEqual([])
  })

  it('records a failing input source and still plans', async () => {
    m.listRecentConcepts.mockRejectedValueOnce(new Error('db down'))
    const [spec] = await ideaGenerateHandler.plan(USER, LATE)
    expect((spec.input.context as { inputErrors: string[] }).inputErrors).toEqual(['concepts: db down'])
  })
})

describe('idea_generate apply', () => {
  it('grounds, embeds, gates novelty, gathers evidence and plans the judge', async () => {
    m.findNearestIdeaNeighbours.mockImplementation(async (_u: string, vec: number[]) =>
      vec[0] === 'G'.charCodeAt(0) ? [{ id: 'arch-1', kind: 'idea', similarity: 0.95 }]
        : vec[0] === 'B'.charCodeAt(0) ? [{ id: 'prop-1', kind: 'proposal', similarity: 0.83 }] : [])
    const job = await plannedGenerateJob()
    const out = await ideaGenerateHandler.apply(job, generateAnswer, 'routine')
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(m.embedOne).toHaveBeenCalledWith('Alpha\nAlpha claim', 'document')
    // Repeats get no retrieval.
    expect(m.searchSubstrateForChat).toHaveBeenCalledTimes(2)
    expect(m.upsertJob).toHaveBeenCalledTimes(1)
    const spec = m.upsertJob.mock.calls[0][1] as ThinkingJobSpec
    expect(spec).toMatchObject({ kind: 'idea_judge', externalKey: `idea_judge:${DAY}`, deadlineMinutes: 45 })
    const ctx = readJudgeContext(spec.input.context) as IdeaJudgeContext
    expect(ctx.generateJobId).toBe('job-gen')
    expect(ctx.candidates.map((c) => [c.key, c.title, c.novelty.class])).toEqual([
      ['c1', 'Alpha', 'novel'], ['c2', 'Beta', 'borderline'], ['c3', 'Gamma', 'repeat'],
    ])
    expect(ctx.candidates[0].citedIds).toEqual(['refl-1'])
    // Prior ideas never count as evidence.
    expect(ctx.candidates[0].evidenceIds).toEqual(['refl-1', 'ret-1'])
    expect(ctx.candidates[0].vector).not.toBeNull()
    expect(ctx.nearest['prop-1']).toMatchObject({ kind: 'proposal', title: 'title prop-1' })
    expect(ctx.pairs).toHaveLength(1)
    expect(ctx.matches).toHaveLength(2)
    expect(spec.input.validMemoryIds?.sort()).toEqual(['board-1', 'refl-1', 'ret-1'])
    expect(spec.input.prompt).not.toContain('Gamma claim')
    expect(out.output).toMatchObject({ judgeJobId: 'job-judge', contenders: 2, dropped: { ungrounded: 1 } })
    expect(readJudgeContext(out.output?.judgeContext)).not.toBeNull()
    expect(m.writeTournament).not.toHaveBeenCalled()
  })

  it('ends the night early when every candidate is a repeat: archive, trace, no judge', async () => {
    m.findNearestIdeaNeighbours.mockResolvedValue([{ id: 'arch-1', kind: 'idea', similarity: 0.97 }])
    const job = await plannedGenerateJob()
    const out = await ideaGenerateHandler.apply(job, generateAnswer, 'routine')
    expect(out).toMatchObject({ ok: true, memoryIds: ['s1', 'a1', 'a2'], output: { ended: 'no_novel_candidates', judgeJobId: null } })
    expect(m.upsertJob).not.toHaveBeenCalled()
    const input = m.writeTournament.mock.calls[0][1]
    expect(input).toMatchObject({ tournamentDate: DAY, generateJobId: 'job-gen', judgeJobId: null, survivors: [] })
    expect(input.others).toHaveLength(3)
    expect(input.others[0].meta).toMatchObject({ status: 'repeat', eliminatedReason: 'repeat', judgeJobId: null })
    expect(m.writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: IDEA_TOURNAMENT_CRON, outcome: 'skipped', skipReason: 'no_novel_candidates' }))
  })

  it('treats a failed embed as novel and keeps going', async () => {
    m.embedOne.mockRejectedValue(new Error('voyage 500'))
    const job = await plannedGenerateJob()
    const out = await ideaGenerateHandler.apply(job, generateAnswer, 'routine')
    expect(out).toMatchObject({ ok: true, output: { embedFailures: 3, contenders: 3 } })
    expect(m.findNearestIdeaNeighbours).not.toHaveBeenCalled()
  })

  it('rejects an unparseable answer without side effects', async () => {
    const job = await plannedGenerateJob()
    const out = await ideaGenerateHandler.apply(job, 'nope', 'routine')
    expect(out).toMatchObject({ ok: false })
    if (!out.ok) expect(out.reason).toMatch(/^parse_failed/)
    expect(m.upsertJob).not.toHaveBeenCalled()
  })

  it('fallback: paid parse feeds the same path; a hard failure is traced, a missing key is not', async () => {
    const job = await plannedGenerateJob()
    m.askPaidAndParse.mockImplementationOnce(async (_j: ThinkingJobRow, opts: { parse: (t: string) => unknown }) => ({ ok: true, value: opts.parse(generateAnswer) }))
    const ok = await ideaGenerateHandler.fallback(job)
    expect(ok).toMatchObject({ ok: true, output: { answeredBy: 'api' } })
    expect(m.upsertJob).toHaveBeenCalledTimes(1)

    m.askPaidAndParse.mockResolvedValueOnce({ ok: false, reason: 'no BYOK credential' })
    expect(await ideaGenerateHandler.fallback(job)).toEqual({ ok: false, reason: 'no BYOK credential' })
    expect(m.writeCronFailureTrace).not.toHaveBeenCalled()

    m.askPaidAndParse.mockResolvedValueOnce({ ok: false, reason: 'parse_failed: junk' })
    await ideaGenerateHandler.fallback(job)
    expect(m.writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: IDEA_TOURNAMENT_CRON, reason: 'generate_failed' }))

    // An unexpected provider/DB error is traced too, then rethrown for the sweep.
    m.writeCronFailureTrace.mockClear()
    m.askPaidAndParse.mockRejectedValueOnce(new Error('overloaded'))
    await expect(ideaGenerateHandler.fallback(job)).rejects.toThrow('overloaded')
    expect(m.writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ reason: 'generate_failed', rawExcerpt: 'overloaded' }))
  })
})

// ── judge ──────────────────────────────────────────────────────────────────

async function judgeJob(): Promise<{ job: ThinkingJobRow; ctx: IdeaJudgeContext }> {
  m.findNearestIdeaNeighbours.mockImplementation(async (_u: string, vec: number[]) =>
    vec[0] === 'G'.charCodeAt(0) ? [{ id: 'prop-1', kind: 'proposal', similarity: 0.84 }] : [])
  const answer = json({
    directions,
    candidates: [cand('Alpha', ['refl-1']), cand('Beta', ['board-1'], 'd2'), cand('Gamma', ['belief-1']), cand('Eps', ['refl-1'], 'd2')],
  })
  const gen = await plannedGenerateJob()
  const out = await ideaGenerateHandler.apply(gen, answer, 'routine')
  if (!out.ok) throw new Error(out.reason)
  const spec = m.upsertJob.mock.calls[0][1] as ThinkingJobSpec
  vi.clearAllMocks()
  m.writeTournament.mockResolvedValue({ written: true, survivorIds: ['s1', 's2'], archivedIds: ['a1', 'a2'] })
  m.embedOne.mockResolvedValue([9, 9, 9])
  return { job: jobFrom(spec, 'job-judge'), ctx: readJudgeContext(spec.input.context) as IdeaJudgeContext }
}

const crit = (key: string, supports: string[], over: Record<string, unknown> = {}) =>
  ({ key, verdict: 'grounded', supports, contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: 'ok', ...over })

function judgeAnswer(ctx: IdeaJudgeContext, winner: (a: string, b: string) => string) {
  return json({
    critiques: [
      crit('c1', ['refl-1']),
      crit('c2', ['board-1']),
      crit('c3', ['belief-1'], { meaningfullyDifferent: false }),
      crit('c4', [], { verdict: 'ungrounded' }),
    ],
    votes: ctx.matches.map((mm) => ({ match: mm.id, winner: winner(mm.first, mm.second) })),
    refinements: [{ key: 'c1', claim: 'Alpha sharper', why: 'w', nextStep: 'n' }],
  })
}

describe('idea_judge', () => {
  it('apply: Elo + selection + refinement → one writeTournament and a trace', async () => {
    const { job, ctx } = await judgeJob()
    // c1 always wins; otherwise the first-listed (position bias → draws).
    const out = await ideaJudgeHandler.apply(job, judgeAnswer(ctx, (a, b) => (a === 'c1' || b === 'c1' ? 'c1' : a)), 'routine')
    expect(out).toMatchObject({ ok: true, memoryIds: ['s1', 's2', 'a1', 'a2'] })

    const input = m.writeTournament.mock.calls[0][1]
    expect(input).toMatchObject({ tournamentDate: DAY, generateJobId: 'job-gen', judgeJobId: 'job-judge' })
    const survivors = input.survivors as Array<{ title: string; bodyMd: string; citedIds: string[]; dominionId: string | null; meta: IdeaMeta; embedding: number[] | null }>
    // Beta lost to Alpha and drew the rest: below ELO_START, so ranked out.
    expect(survivors.map((s) => s.title)).toEqual(['Alpha'])
    const [alpha] = survivors
    expect(alpha.meta).toMatchObject({ status: 'survivor', rank: 1, refined: true, claim: 'Alpha sharper', judgeJobId: 'job-judge' })
    expect(alpha.meta.elo).toBeGreaterThan(ELO_START)
    expect(alpha.meta.survivedBecause).toMatch(/^Backed by “title refl-1”; won \d of \d head-to-heads\.$/)
    expect(alpha.bodyMd).toContain('**Claim.** Alpha sharper')
    expect(alpha.bodyMd).toContain('**Survived because:**')
    expect(alpha.citedIds).toEqual(['refl-1'])
    expect(alpha.dominionId).toBe('dom-1')
    // Refined survivor re-embedded; others keep the packed vector.
    expect(m.embedOne).toHaveBeenCalledWith('Alpha\nAlpha sharper', 'document')
    expect(alpha.embedding).toEqual([9, 9, 9])

    const others = input.others as Array<{ title: string; meta: IdeaMeta; embedding: number[] | null }>
    const byTitle = new Map(others.map((o) => [o.title, o.meta]))
    expect(byTitle.get('Gamma')).toMatchObject({ status: 'eliminated', eliminatedReason: 'not_different', refined: false, survivedBecause: null })
    expect(byTitle.get('Eps')).toMatchObject({ status: 'eliminated', eliminatedReason: 'ungrounded' })
    expect(byTitle.get('Beta')).toMatchObject({ status: 'eliminated', eliminatedReason: 'ranked_out', rank: 2 })
    expect(others.every((o) => o.embedding !== null)).toBe(true)
    expect(m.writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: IDEA_TOURNAMENT_CRON, outcome: 'ok' }))
  })

  it('an empty-survivor night still archives everyone and traces a skip', async () => {
    const { job, ctx } = await judgeJob()
    const answer = json({
      critiques: ['c1', 'c2', 'c3', 'c4'].map((k) => crit(k, [], { alreadyKnown: true })),
      votes: ctx.matches.map((mm) => ({ match: mm.id, winner: mm.first })),
    })
    const out = await ideaJudgeHandler.apply(job, answer, 'routine')
    expect(out.ok).toBe(true)
    const input = m.writeTournament.mock.calls[0][1]
    expect(input.survivors).toEqual([])
    expect(input.others).toHaveLength(4)
    expect(m.writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ outcome: 'skipped', skipReason: 'no_survivors' }))
  })

  it('rejects an answer missing a critique', async () => {
    const { job } = await judgeJob()
    const out = await ideaJudgeHandler.apply(job, json({ critiques: [crit('c1', ['refl-1'])] }), 'routine')
    expect(out).toMatchObject({ ok: false })
    expect(m.writeTournament).not.toHaveBeenCalled()
  })

  it('fallback: paid answer persists as api; a hard failure is traced', async () => {
    const { job, ctx } = await judgeJob()
    m.askPaidAndParse.mockImplementationOnce(async (_j: ThinkingJobRow, opts: { parse: (t: string) => unknown; repairContext: string }) => {
      expect(opts.repairContext).toContain(ctx.matches[0].id)
      return { ok: true, value: opts.parse(judgeAnswer(ctx, (a) => a)) }
    })
    const out = await ideaJudgeHandler.fallback(job)
    expect(out).toMatchObject({ ok: true, output: { tournament: { answeredBy: 'api' } } })

    m.askPaidAndParse.mockResolvedValueOnce({ ok: false, reason: 'parse_failed: still junk' })
    expect(await ideaJudgeHandler.fallback(job)).toMatchObject({ ok: false })
    expect(m.writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ reason: 'judge_failed' }))

    m.writeCronFailureTrace.mockClear()
    m.askPaidAndParse.mockRejectedValueOnce(new Error('db down'))
    await expect(ideaJudgeHandler.fallback(job)).rejects.toThrow('db down')
    expect(m.writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ reason: 'judge_failed', rawExcerpt: 'db down' }))
  })

  it('plan: recovery only — rebuilds the judge from a done generate job', async () => {
    const { job: judge, ctx } = await judgeJob()
    m.hasJobWithKeyLike.mockResolvedValue(false)
    m.listJobs.mockResolvedValue([{ externalKey: `idea_generate:${DAY}`, kind: 'idea_generate', status: 'done', output: { judgeContext: ctx } }])
    const [spec] = await ideaJudgeHandler.plan(USER, LATE)
    expect(spec).toMatchObject({ kind: 'idea_judge', externalKey: `idea_judge:${DAY}`, deadlineMinutes: 45 })
    expect(spec.input.prompt).toBe(judge.input.prompt)

    m.hasJobWithKeyLike.mockResolvedValueOnce(true)
    expect(await ideaJudgeHandler.plan(USER, LATE)).toEqual([])
    m.listJobs.mockResolvedValueOnce([{ externalKey: `idea_generate:${DAY}`, status: 'claimed', output: null }])
    expect(await ideaJudgeHandler.plan(USER, LATE)).toEqual([])
    m.listJobs.mockResolvedValueOnce([{ externalKey: `idea_generate:${DAY}`, status: 'done', output: { ended: 'no_novel_candidates' } }])
    expect(await ideaJudgeHandler.plan(USER, LATE)).toEqual([])
  })
})
