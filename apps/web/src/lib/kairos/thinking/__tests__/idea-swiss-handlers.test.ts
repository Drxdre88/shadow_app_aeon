import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'

const m = vi.hoisted(() => ({
  findNearestIdeaNeighbours: vi.fn(),
  writeTournament: vi.fn(),
  listActiveDominions: vi.fn(),
  listEvidenceSnippets: vi.fn(),
  empty: vi.fn(async () => []),
  hasJobWithKeyLike: vi.fn(),
  upsertJob: vi.fn(),
  listJobs: vi.fn(),
  embedOne: vi.fn(),
  searchSubstrateForChat: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
  writeCronFailureTrace: vi.fn(),
  askPaidAndParse: vi.fn(),
  readAtlas: vi.fn(),
}))

vi.mock('@/lib/data/ideas', () => ({
  IDEA_JUDGE_FAILED_REASON: 'judge_failed',
  findNearestIdeaNeighbours: m.findNearestIdeaNeighbours,
  writeTournament: m.writeTournament,
  listIdeaOutcomes: m.empty,
  listDirectionStats: m.empty,
}))
vi.mock('@/lib/data/idea-inputs', () => ({
  getLatestAether: vi.fn(async () => null),
  listActiveDominions: m.listActiveDominions,
  listEvidenceSnippets: m.listEvidenceSnippets,
  listOpenObjectives: m.empty,
  listOperatorReflections: vi.fn(async () => [{ id: 'refl-1', title: 'Tired', summary: 'tabs', excerpt: null, dominionId: null, createdAt: new Date('2026-10-01T00:00:00Z') }]),
  listRecentBoardDays: m.empty,
  listRecentConcepts: m.empty,
  listTopHeldBeliefs: m.empty,
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: m.hasJobWithKeyLike, upsertJob: m.upsertJob, listJobs: m.listJobs }))
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: vi.fn(async () => true) }))
vi.mock('@/lib/kairos/embeddings', () => ({ embedOne: m.embedOne }))
vi.mock('@/lib/kairos/retrieve', () => ({ searchSubstrateForChat: m.searchSubstrateForChat }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: m.writeCronSuccessTrace, writeCronFailureTrace: m.writeCronFailureTrace }))
vi.mock('../paid-fallback', () => ({ askPaidAndParse: m.askPaidAndParse }))
vi.mock('@/lib/data/kairos-idea-atlas', () => ({ readKairosIdeaAtlas: m.readAtlas, mutateKairosIdeaAtlas: vi.fn() }))

import { ideaGenerateHandler } from '../handlers/idea-generate'
import { ideaJudgeHandler } from '../handlers/idea-judge'
import { SWISS_SETTLE_UTC, swissRoundDeadlineMinutes } from '../handlers/idea-judge-swiss'
import { readJudgeContext, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { SWISS_ROUND_SYSTEM_PROMPT } from '@/lib/kairos/ideas/swiss/round-prompt'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'

const USER = 'user-1'
const DAY = '2026-10-01'
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'

function jobFrom(spec: ThinkingJobSpec, id: string): ThinkingJobRow {
  const now = new Date()
  return {
    id, userId: USER, kind: spec.kind, dominionId: spec.dominionId, externalKey: spec.externalKey, status: 'claimed',
    input: spec.input, output: null, claimedBy: 'routine', claimToken: 't', claimedAt: now, deadlineAt: now,
    completedAt: null, attempts: 1, error: null, createdAt: now, updatedAt: now,
  }
}

const crit = (key: string, ok = true) =>
  ({ key, verdict: ok ? 'grounded' : 'ungrounded', supports: ok ? ['refl-1'] : [], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '' })
// c1 beats everyone; otherwise the lower key wins both orders.
const winner = (a: string, b: string) => (a === 'c1' || b === 'c1' ? 'c1' : a < b ? a : b)
const ctxOf = (job: ThinkingJobRow) => readJudgeContext(job.input.context) as IdeaJudgeContext
const roundMatches = (ctx: IdeaJudgeContext) => {
  const ids = new Set((ctx.swiss as { roundPairIds: string[] }).roundPairIds)
  return ctx.matches.filter((mm) => ids.has(mm.pairId))
}
const votesAnswer = (ctx: IdeaJudgeContext) => json({ votes: roundMatches(ctx).map((mm) => ({ match: mm.id, winner: winner(mm.first, mm.second) })) })
const fullAnswer = (ctx: IdeaJudgeContext, viable = ['c1', 'c2', 'c3', 'c4']) => json({
  critiques: ['c1', 'c2', 'c3', 'c4'].map((k) => crit(k, viable.includes(k))),
  votes: ctx.matches.map((mm) => ({ match: mm.id, winner: winner(mm.first, mm.second) })),
  refinements: [{ key: 'c1', claim: 'sharper', why: 'w', nextStep: 'n' }],
})

let jobSeq = 0
async function round1(): Promise<ThinkingJobRow> {
  const [spec] = await ideaGenerateHandler.plan(USER, new Date(`${DAY}T03:35:00Z`))
  const gen = jobFrom(spec, 'job-gen')
  const answer = json({
    directions: [{ id: 'd1', label: 'Stop', move: 'stop', dominion: null }, { id: 'd2', label: 'Test', move: 'test', dominion: null }],
    candidates: ['Alpha', 'Beta', 'Gamma', 'Delta'].map((t) => ({ direction: 'd1', title: t, claim: `${t} c`, why: 'w', nextStep: 's', evidenceIds: ['refl-1'] })),
  })
  const out = await ideaGenerateHandler.apply(gen, answer, 'routine')
  if (!out.ok) throw new Error(out.reason)
  const judgeSpec = m.upsertJob.mock.calls[0][1] as ThinkingJobSpec
  m.upsertJob.mockClear()
  return jobFrom(judgeSpec, 'judge-r1')
}

const plannedSpec = () => m.upsertJob.mock.calls[0][1] as ThinkingJobSpec

beforeEach(() => {
  vi.clearAllMocks()
  jobSeq = 0
  process.env.KAIROS_IDEA_SWISS = '1'
  process.env.KAIROS_IDEA_SWISS_ROUNDS = '3'
  delete process.env.KAIROS_IDEA_ATLAS
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${DAY}T03:40:00Z`))
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.listActiveDominions.mockResolvedValue([{ id: 'dom-1', name: 'Aeon' }])
  m.embedOne.mockImplementation(async (text: string) => [text.charCodeAt(0), 1, 0])
  m.findNearestIdeaNeighbours.mockResolvedValue([])
  m.searchSubstrateForChat.mockResolvedValue([])
  m.listEvidenceSnippets.mockImplementation(async (_u: string, ids: string[]) =>
    ids.map((id) => ({ id, title: `t ${id}`, text: 'x', dominionId: 'dom-1', origin: 'operator', kind: null, type: 'reflection' })))
  m.upsertJob.mockImplementation(async (_u: string, spec: ThinkingJobSpec) => ({ ...jobFrom(spec, `job-${++jobSeq}`), status: 'queued' }))
  m.writeTournament.mockResolvedValue({ written: true, survivorIds: ['s1'], archivedIds: ['a1', 'a2', 'a3'] })
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.KAIROS_IDEA_SWISS
  delete process.env.KAIROS_IDEA_SWISS_ROUNDS
})

describe('Swiss round 1', () => {
  it('the generate apply plans a folded round 1 with Swiss state', async () => {
    const job = await round1()
    const ctx = ctxOf(job)
    expect(job.externalKey).toBe(`idea_judge:${DAY}`)
    expect(ctx.pairs.map((p) => [p.a, p.b])).toEqual([['c1', 'c3'], ['c2', 'c4']])
    expect(ctx.swiss).toMatchObject({ v: 1, round: 1, rounds: 3, roundPairIds: ['p1', 'p2'], byes: [] })
  })

  it('a routine answer stores critiques and plans r2 without writing anything', async () => {
    const job = await round1()
    const out = await ideaJudgeHandler.apply(job, fullAnswer(ctxOf(job)), 'routine')
    expect(out).toMatchObject({ ok: true, memoryIds: [], output: { swiss: { round: 1, nextRound: 2, nextJobId: 'job-2' } } })
    expect(m.writeTournament).not.toHaveBeenCalled()
    const spec = plannedSpec()
    expect(spec).toMatchObject({ kind: 'idea_judge', externalKey: `idea_judge:${DAY}:r2`, deadlineMinutes: 45 })
    expect(spec.input.system).toBe(SWISS_ROUND_SYSTEM_PROMPT)
    expect(spec.input.validMemoryIds).toEqual([])
    const ctx = ctxOf(jobFrom(spec, 'x'))
    expect(ctx.swiss).toMatchObject({ round: 2, viable: ['c1', 'c2', 'c3', 'c4'], refinements: { c1: { claim: 'sharper' } } })
    expect(roundMatches(ctx).map((mm) => [mm.first, mm.second])).toEqual([['c1', 'c2'], ['c3', 'c4'], ['c2', 'c1'], ['c4', 'c3']])
    expect(new Set(ctx.matches.map((mm) => mm.id)).size).toBe(ctx.matches.length)
  })

  it('fewer than two viable candidates: finishes after round 1', async () => {
    const job = await round1()
    const out = await ideaJudgeHandler.apply(job, fullAnswer(ctxOf(job), ['c1']), 'routine')
    expect(out.ok).toBe(true)
    expect(m.upsertJob).not.toHaveBeenCalled()
    expect(m.writeTournament).toHaveBeenCalledTimes(1)
    expect(out.ok && out.output?.tournament).toMatchObject({ swiss: { rounds: 1, viable: 1 } })
  })

  it('a paid fallback round 1 finishes right away (no chained rounds)', async () => {
    const job = await round1()
    m.askPaidAndParse.mockImplementationOnce(async (_j: ThinkingJobRow, opts: { parse: (t: string) => unknown }) => ({ ok: true, value: opts.parse(fullAnswer(ctxOf(job))) }))
    const out = await ideaJudgeHandler.fallback(job)
    expect(out).toMatchObject({ ok: true, output: { tournament: { answeredBy: 'api', swiss: { rounds: 1 } } } })
    expect(m.upsertJob).not.toHaveBeenCalled()
  })
})

async function toRound(k: number): Promise<ThinkingJobRow> {
  let job = await round1()
  let answer = fullAnswer(ctxOf(job))
  for (let r = 1; r < k; r++) {
    m.upsertJob.mockClear()
    const out = await ideaJudgeHandler.apply(job, answer, 'routine')
    if (!out.ok) throw new Error(out.reason)
    job = jobFrom(plannedSpec(), `judge-r${r + 1}`)
    answer = votesAnswer(ctxOf(job))
  }
  m.upsertJob.mockClear()
  return job
}

describe('Swiss rounds ≥ 2', () => {
  it('the final round persists once with Elo over every Swiss pair; rank/ranked_out kept', async () => {
    const r3 = await toRound(3)
    expect(r3.externalKey).toBe(`idea_judge:${DAY}:r3`)
    const out = await ideaJudgeHandler.apply(r3, votesAnswer(ctxOf(r3)), 'routine')
    expect(out.ok).toBe(true)
    expect(m.upsertJob).not.toHaveBeenCalled()
    expect(m.writeTournament).toHaveBeenCalledTimes(1)
    const input = m.writeTournament.mock.calls[0][1]
    expect(input.judgeJobId).toBe('judge-r3')
    const metas = [...input.survivors, ...input.others].map((r: { meta: IdeaMeta }) => r.meta)
    const c1 = metas.find((x: IdeaMeta) => x.key === 'c1') as IdeaMeta
    expect(c1).toMatchObject({ status: 'survivor', rank: 1, refined: true, claim: 'sharper' })
    expect(metas.filter((x: IdeaMeta) => x.status === 'eliminated').every((x: IdeaMeta) => x.eliminatedReason === 'ranked_out' && x.rank !== null)).toBe(true)
    expect(out.ok && out.output?.tournament).toMatchObject({ matches: 12, swiss: { rounds: 3, planned: 3, pairs: 6 } })
  })

  it('an abandoned r3 finishes the night with the r1–r2 votes', async () => {
    const r3 = await toRound(3)
    const ids = await ideaJudgeHandler.abandon!(r3, 'paid backup off')
    expect(ids).toEqual(['s1', 'a1', 'a2', 'a3'])
    expect(m.writeTournament).toHaveBeenCalledTimes(1)
    const input = m.writeTournament.mock.calls[0][1]
    expect(input.survivors[0].meta).toMatchObject({ key: 'c1', status: 'survivor' })
    expect(m.writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('the sweep fallback for a later round never calls the paid model', async () => {
    const r2 = await toRound(2)
    const out = await ideaJudgeHandler.fallback(r2)
    expect(out).toMatchObject({ ok: true, output: { tournament: { answeredBy: 'deterministic', swiss: { rounds: 2 } } } })
    expect(m.askPaidAndParse).not.toHaveBeenCalled()
    expect(m.writeTournament).toHaveBeenCalledTimes(1)
  })

  it('a junk later-round answer finishes on the votes collected so far', async () => {
    const r2 = await toRound(2)
    const out = await ideaJudgeHandler.apply(r2, 'not json', 'routine')
    expect(out).toMatchObject({ ok: true, output: { tournament: { swiss: { rounds: 2, stopped: expect.stringMatching(/^parse_failed/) } } } })
    expect(m.upsertJob).not.toHaveBeenCalled()
    expect(m.writeTournament).toHaveBeenCalledTimes(1)
  })
})

describe('the 04:35Z settle', () => {
  it('round deadlines close by 04:35Z; too close → finish instead of chaining', async () => {
    expect(swissRoundDeadlineMinutes(new Date(`${DAY}T04:00:00Z`))).toBe(35)
    expect(swissRoundDeadlineMinutes(new Date(`${DAY}T04:31:00Z`))).toBeNull()
    expect(swissRoundDeadlineMinutes(new Date(`${DAY}T05:10:00Z`))).toBeNull()
    const job = await round1()
    vi.setSystemTime(new Date(`${DAY}T04:32:00Z`))
    const out = await ideaJudgeHandler.apply(job, fullAnswer(ctxOf(job)), 'routine')
    expect(out.ok).toBe(true)
    expect(m.upsertJob).not.toHaveBeenCalled()
    expect(m.writeTournament).toHaveBeenCalledTimes(1)
  })

  it('mirrors the daily message NIGHT_SETTLED_UTC', () => {
    const src = readFileSync(path.resolve(__dirname, '../handlers/daily-message.ts'), 'utf8')
    expect(src).toContain(`NIGHT_SETTLED_UTC = { hour: ${SWISS_SETTLE_UTC.hour}, minute: ${SWISS_SETTLE_UTC.minute} }`)
    expect(src).toMatch(/FEEDING_KINDS = new Set\(\[[^\]]*'idea_judge'/)
  })
})
