import { z } from 'zod'
import { computeElo } from '@/lib/kairos/ideas/elo'
import { spliceBeforeDataEnd } from '@/lib/kairos/ideas/generate-prompt'
import { contenders, type IdeaJudgeContext } from '@/lib/kairos/ideas/judge-context'
import { eliminationReason } from '@/lib/kairos/ideas/select'
import type { IdeaCritique } from '@/lib/kairos/ideas/types'
import { parseCellKey, tagCandidate, type AtlasCellRef } from '@/lib/kairos/ideas/atlas/cells'
import { ideaAtlasMode, ideaSwissEnabled, ideaSwissRounds } from '@/lib/kairos/ideas/atlas/flag'
import { challengeResult, planChallenges, readAtlasJudge, readAtlasTag, type AtlasJudgeState } from '@/lib/kairos/ideas/atlas/judge'
import { readAtlasTags, renderAtlasTargets, withAtlasSystem } from '@/lib/kairos/ideas/atlas/prompt'
import { pickAtlasTargets } from '@/lib/kairos/ideas/atlas/targets'
import {
  applyAtlasNight,
  decideAtlasNight,
  type AtlasChallengeOutcome,
  type AtlasHolderSource,
  type AtlasNightDecision,
  type AtlasNightEntry,
} from '@/lib/kairos/ideas/atlas/update'
import { pairRound1, toRoundSchedule } from '@/lib/kairos/ideas/swiss/pairing'
import type { SwissState } from '@/lib/kairos/ideas/swiss/state'
import { noveltyTonight } from '@/lib/kairos/ideas/stepping/schedule'
import { errorReason } from '../_errors'
import type { IdeaExtension, JobContext } from './types'

// Lane A (idea atlas + Swiss) idea-tournament hooks. Every hook returns its
// input unchanged unless KAIROS_IDEA_ATLAS / KAIROS_IDEA_SWISS were on when
// tonight's job was planned (the plan-time decision rides in the job
// context). The pref store is loaded lazily so flag-off never touches it.

const store = () => import('@/lib/data/kairos-idea-atlas')

const generateAtlasSchema = z.object({
  v: z.literal(1),
  mode: z.enum(['observe', 'on']),
  targets: z.array(z.string()).max(16),
})
type GenerateAtlas = z.infer<typeof generateAtlasSchema>

const dominionsSchema = z.array(z.object({ id: z.string(), name: z.string() }))

function readGenerateAtlas(jobContext: JobContext): GenerateAtlas | null {
  const parsed = generateAtlasSchema.safeParse(jobContext.atlas)
  return parsed.success ? parsed.data : null
}

function dominionsOf(jobContext: JobContext): Array<{ id: string; name: string }> {
  const parsed = dominionsSchema.safeParse(jobContext.dominions)
  return parsed.success ? parsed.data : []
}

interface AtlasScratch {
  mode: AtlasJudgeState['mode']
  entries: AtlasNightEntry[]
  outcomes: AtlasChallengeOutcome[]
  decision: AtlasNightDecision | null
  applied: AtlasNightDecision | null
}

const live = (ctx: IdeaJudgeContext) => ctx.candidates.filter((c) => c.novelty.class !== 'repeat')

const scratchOf = (scratch: Record<string, unknown>) => scratch.atlas as AtlasScratch | undefined

// A live novelty night (lane D) overrides atlas targets and holder challenges.
const noveltyNight = (round: unknown, date: string) => round === 'novelty' || noveltyTonight(date) === 'on'

function withSwissRound1(judge: IdeaJudgeContext): IdeaJudgeContext {
  const keys = contenders(judge).map((c) => c.key)
  if (keys.length < 2) return judge
  const r1 = pairRound1(keys)
  const sched = toRoundSchedule(r1.pairs, { pair: 0, match: 0 })
  const swiss: SwissState = {
    v: 1,
    round: 1,
    rounds: ideaSwissRounds(),
    roundPairIds: sched.pairs.map((p) => p.id),
    votes: {},
    byes: r1.bye ? [r1.bye] : [],
    viable: [],
    critiques: {},
    refinements: {},
  }
  return { ...judge, pairs: sched.pairs, matches: sched.matches, swiss }
}

function nightEntries(ctx: IdeaJudgeContext, critiques: ReadonlyMap<string, IdeaCritique>, votes: ReadonlyMap<string, string>): AtlasNightEntry[] {
  const list = live(ctx)
  const elo = computeElo(list.map((c) => c.key), ctx.pairs, votes)
  const out: AtlasNightEntry[] = []
  for (const c of list) {
    const tag = readAtlasTag(c.atlas)
    if (!tag) continue
    const record = elo.get(c.key)
    const viable = eliminationReason({
      key: c.key,
      novelty: c.novelty,
      critique: critiques.get(c.key) ?? null,
      record: null,
      ...(c.bridge ? { bridged: true } : {}),
    }) === null
    out.push({ key: c.key, cell: tag.cell, viable, elo: record ? record.elo : null, wins: record?.wins ?? 0 })
  }
  return out
}

export const atlasExtension: IdeaExtension = {
  async planGenerate(draft, ctx) {
    const mode = ideaAtlasMode()
    if (mode === 'off') return draft
    let prompt = draft.prompt
    let targets: string[] = []
    if (mode === 'on' && !noveltyNight(draft.context.round, ctx.day)) {
      try {
        const state = await (await store()).readKairosIdeaAtlas(ctx.userId)
        targets = pickAtlasTargets(state, ctx.dominions, ctx.day)
      } catch (err) {
        ctx.errors.push(`atlas: ${errorReason(err)}`.slice(0, 200))
      }
      const refs = targets.map(parseCellKey).filter((r): r is AtlasCellRef => r !== null)
      if (refs.length) prompt = spliceBeforeDataEnd(prompt, renderAtlasTargets(refs, new Map(ctx.dominions.map((d) => [d.id, d.name]))))
    }
    const atlas: GenerateAtlas = { v: 1, mode, targets }
    return { ...draft, system: withAtlasSystem(draft.system), prompt, context: { ...draft.context, atlas } }
  },

  parseOptions(jobContext) {
    if (!readGenerateAtlas(jobContext)) return {}
    return { extendCandidate: (rawItem, built) => ({ ...built, ...readAtlasTags(rawItem) }) }
  },

  enrichStoredCandidate(stored, candidate, ctx) {
    if (!readGenerateAtlas(ctx.jobContext)) return stored
    const tag = tagCandidate(
      { kind: candidate.kind, leap: candidate.leap, citedIds: candidate.citedIds, direction: candidate.direction, maxCosine: stored.novelty.maxCosine },
      { evidence: ctx.evidence, directions: ctx.grounded.directions, dominions: dominionsOf(ctx.jobContext) },
    )
    if (!tag) return stored
    return { ...stored, kind: tag.kind, leap: tag.leap, atlas: { cell: tag.cell, area: tag.area, kind: tag.kind, leap: tag.leap, leapClaimed: tag.leapClaimed } }
  },

  async buildJudgeContextExtras(judge, ctx) {
    let out = ideaSwissEnabled() ? withSwissRound1(judge) : judge
    const gen = readGenerateAtlas(ctx.jobContext)
    if (!gen) return out
    const atlas: AtlasJudgeState = { v: 1, mode: gen.mode, areas: dominionsOf(ctx.jobContext).map((d) => d.id), targets: gen.targets, holders: [], challenges: [] }
    if (gen.mode === 'on' && !noveltyNight(ctx.jobContext.round, judge.date)) {
      try {
        const state = await (await store()).readKairosIdeaAtlas(ctx.job.userId)
        const tagged = live(out).flatMap((c) => {
          const tag = readAtlasTag(c.atlas)
          return tag ? [{ key: c.key, cell: tag.cell }] : []
        })
        const plan = planChallenges(tagged, state, { pairs: out.pairs, matches: out.matches })
        out = { ...out, matches: [...out.matches, ...plan.matches] }
        atlas.holders = plan.holders
        atlas.challenges = plan.challenges
      } catch (err) {
        console.warn('[kairos:idea-atlas] challenge planning skipped:', errorReason(err))
      }
    }
    return { ...out, atlas }
  },

  async prepareJudge(judged, scope) {
    const atlas = readAtlasJudge(scope.ctx.atlas)
    if (!atlas) return
    const entries = nightEntries(scope.ctx, judged.critiques, judged.votes)
    const stepping = scope.scratch.stepping as { novelty?: unknown } | undefined
    const novelty = stepping?.novelty === 'on' || noveltyNight(undefined, scope.ctx.date)
    const outcomes = novelty ? [] : atlas.challenges.map((ch) => ({ cell: ch.cell, key: ch.a, result: challengeResult(ch, judged.votes) }))
    const scratch: AtlasScratch = { mode: atlas.mode, entries, outcomes, decision: null, applied: null }
    scope.scratch.atlas = scratch
    const state = await (await store()).readKairosIdeaAtlas(scope.job.userId)
    scratch.decision = decideAtlasNight(state, scope.ctx.date, entries, outcomes, atlas.mode)
  },

  metaExtras(candidate, _selection, _critique, scope) {
    const tag = readAtlasTag(candidate.atlas)
    if (!tag) return null
    const took = scratchOf(scope.scratch)?.decision?.took.get(candidate.key) ?? null
    return { atlas: { cell: tag.cell, area: tag.area, kind: tag.kind, leap: tag.leap, leapClaimed: tag.leapClaimed, took } }
  },

  async afterTournamentWrite(result, rows, scope) {
    const scratch = scratchOf(scope.scratch)
    const atlas = readAtlasJudge(scope.ctx.atlas)
    if (!scratch || !atlas) return
    const holders = new Map<string, AtlasHolderSource>()
    const add = (list: typeof rows.others, ids: readonly string[]) => list.forEach((r, i) => {
      if (ids[i]) holders.set(r.meta.key, { memoryId: ids[i], title: r.title, claim: r.meta.claim, elo: r.meta.elo })
    })
    add(rows.survivors, result.survivorIds)
    add(rows.others, result.archivedIds)
    const date = scope.ctx.date
    scratch.applied = await (await store()).mutateKairosIdeaAtlas(scope.job.userId, (state) => {
      const decision = decideAtlasNight(state, date, scratch.entries, scratch.outcomes, scratch.mode)
      if (decision.noop) return { state: null, result: decision }
      return {
        state: applyAtlasNight(state, { date, entries: scratch.entries, decision, holders, targets: atlas.targets, areaIds: atlas.areas }),
        result: decision,
      }
    })
  },

  summarizeJudge(_rows, scope) {
    const scratch = scratchOf(scope.scratch)
    if (!scratch) return null
    const d = scratch.applied
    const took = d ? [...d.took.values()] : []
    return {
      atlas: {
        mode: scratch.mode,
        tagged: scratch.entries.length,
        challenges: scratch.outcomes.length,
        applied: Boolean(d && !d.noop),
        filled: took.filter((t) => t === 'filled').length,
        replaced: took.filter((t) => t === 'replaced').length,
        defended: d?.defended.length ?? 0,
      },
    }
  },
}
