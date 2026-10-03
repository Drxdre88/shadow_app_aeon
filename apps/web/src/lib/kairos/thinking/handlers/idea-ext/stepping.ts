import { unpackVector } from '@/lib/kairos/constitution/drift'
import { majorityDominion, type EvidenceRef } from '@/lib/kairos/ideas/compose'
import type { SelectionInput, SelectionResult } from '@/lib/kairos/ideas/select'
import { tasteMode, type SteppingMode } from '@/lib/kairos/ideas/stepping/flag'
import { applyNoveltyRound } from '@/lib/kairos/ideas/stepping/novelty-prompt'
import { selectNoveltySurvivors } from '@/lib/kairos/ideas/stepping/novelty-select'
import { noveltyTonight } from '@/lib/kairos/ideas/stepping/schedule'
import type { SteppingStone } from '@/lib/kairos/ideas/stepping/stones'
import { featuresOf, tasteFit, type IdeaTasteProfile } from '@/lib/kairos/ideas/stepping/taste'
import { applyTasteSelection, type TastePickKind } from '@/lib/kairos/ideas/stepping/taste-select'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'
import { errorReason } from '../_errors'
import type { IdeaExtension, JudgeApplyScope } from './types'

// Lane D (stepping stones + taste) idea-tournament hooks: novelty round 1 night in N, taste + surprise slot.

export const NOVELTY_ROUND_LINE = 'Pure-novelty round.'
export const SURPRISE_LINE = 'Off your usual taste: a deliberate surprise.'

interface SteppingScratch {
  novelty: SteppingMode
  taste: SteppingMode
  profile: IdeaTasteProfile | null
  profileError?: string
  inputs?: readonly SelectionInput[]
  base?: readonly SelectionResult[]
  picks?: ReadonlyMap<string, TastePickKind>
}

// Loaded on use so the flag-off registry import never pulls in the DB client.
const tasteData = () => import('@/lib/data/idea-taste')

const SCRATCH = 'stepping'
const scratchOf = (scope: JudgeApplyScope): SteppingScratch | undefined =>
  scope.scratch[SCRATCH] as SteppingScratch | undefined

function vectorsOf(scope: JudgeApplyScope): Map<string, number[] | null> {
  return new Map(scope.ctx.candidates.map((c) => [c.key, c.vector ? unpackVector(c.vector) : null]))
}

function fitsOf(scope: JudgeApplyScope, profile: IdeaTasteProfile): Map<string, number | null> {
  const evidence = new Map<string, EvidenceRef>(Object.values(scope.ctx.evidence).map((e) => [e.id, e]))
  return new Map(scope.ctx.candidates.map((c) => [c.key, tasteFit(featuresOf({
    dominionId: majorityDominion(c.evidenceIds, evidence),
    claim: c.claim,
    move: c.move,
    kind: c.kind,
    leap: c.leap,
    maxCosine: c.novelty.maxCosine,
  }), profile)]))
}

const tasteApplies = (st: SteppingScratch, mode: SteppingMode): IdeaTasteProfile | null =>
  st.taste === mode && st.novelty !== 'on' && st.profile?.active ? st.profile : null

const survivorKeys = (s: readonly SelectionResult[]) => s.filter((r) => r.status === 'survivor').map((r) => r.key)

function summarize(st: SteppingScratch, winners: string[], scope: JudgeApplyScope): Record<string, unknown> {
  const novelty = st.novelty === 'off' ? null : {
    mode: st.novelty,
    winners: st.novelty === 'on' ? winners : undefined,
    shadow: st.novelty === 'observe' && st.inputs
      ? survivorKeys(selectNoveltySurvivors(st.inputs, vectorsOf(scope)).selection)
      : undefined,
  }
  if (st.taste === 'off') return { stepping: { novelty, taste: null } }
  const p = st.profile
  const shadowProfile = tasteApplies(st, 'observe')
  const shadow = shadowProfile && st.inputs && st.base
    ? applyTasteSelection(st.base, st.inputs, fitsOf(scope, shadowProfile))
    : null
  const skipped = st.novelty === 'on' ? 'novelty_round' : !p ? st.profileError ?? 'no_profile' : p.active ? undefined : 'inactive'
  const taste = {
    mode: st.taste,
    skipped,
    profile: p ? { active: p.active, totals: p.totals, summary: p.summary } : null,
    picks: st.picks ? Object.fromEntries(st.picks) : undefined,
    shadow: shadow ? { winners: survivorKeys(shadow.selection), picks: Object.fromEntries(shadow.picks) } : undefined,
  }
  return { stepping: { novelty, taste } }
}

export const steppingExtension: IdeaExtension = {
  adjustGenerateInputs(inputs, ctx) {
    if (noveltyTonight(ctx.day) !== 'on') return inputs
    return { ...inputs, lessons: [], directionStats: [] }
  },

  async planGenerate(draft, ctx) {
    const novelty = noveltyTonight(ctx.day)
    if (novelty === 'observe') return { ...draft, context: { ...draft.context, noveltyShadow: true } }
    if (novelty !== 'on') return draft
    let stones: SteppingStone[] = []
    try {
      stones = await (await tasteData()).listSteppingStones(ctx.userId, ctx.day, ctx.now)
    } catch (err) {
      ctx.errors.push(`stepping_stones: ${errorReason(err)}`.slice(0, 200))
    }
    const plan = applyNoveltyRound(draft, stones)
    return { ...draft, system: plan.system, prompt: plan.prompt, context: { ...draft.context, round: 'novelty' } }
  },

  parseOptions() {
    if (tasteMode() === 'off') return {}
    return { extendCandidate: (_raw, built, direction) => ({ ...built, move: direction.move }) }
  },

  enrichStoredCandidate(stored, candidate) {
    if (tasteMode() === 'off' || !candidate.move) return stored
    return { ...stored, move: candidate.move }
  },

  async prepareJudge(_judged, scope) {
    const novelty = noveltyTonight(scope.ctx.date)
    const taste = tasteMode()
    if (novelty === 'off' && taste === 'off') return
    const st: SteppingScratch = { novelty, taste, profile: null }
    scope.scratch[SCRATCH] = st
    if (taste === 'off' || novelty === 'on') return
    try {
      st.profile = await (await tasteData()).readIdeaTasteProfile(scope.job.userId, new Date())
    } catch (err) {
      st.profileError = errorReason(err).slice(0, 200)
    }
  },

  postSelect(selection, inputs, scope) {
    const st = scratchOf(scope)
    if (!st) return selection
    st.inputs = inputs
    st.base = selection
    st.picks = undefined
    if (st.novelty === 'on') return selectNoveltySurvivors(inputs, vectorsOf(scope)).selection
    const profile = tasteApplies(st, 'on')
    if (!profile) return selection
    const picked = applyTasteSelection(selection, inputs, fitsOf(scope, profile))
    st.picks = picked.picks
    return picked.selection
  },

  metaExtras(candidate, selection, _critique, scope) {
    const st = scratchOf(scope)
    const out: Partial<IdeaMeta> = {}
    if (candidate.move && tasteMode() !== 'off') out.move = candidate.move
    if (st?.novelty === 'on') out.round = 'novelty'
    const pick = st?.picks?.get(candidate.key)
    if (pick && selection.status === 'survivor') out.pick = pick
    return Object.keys(out).length ? out : null
  },

  composeExtraLines(meta) {
    if (meta.status !== 'survivor') return []
    const lines: string[] = []
    if (meta.round === 'novelty') lines.push(NOVELTY_ROUND_LINE)
    if (meta.pick === 'surprise') lines.push(SURPRISE_LINE)
    return lines
  },

  summarizeJudge(rows, scope) {
    const st = scratchOf(scope)
    return st ? summarize(st, survivorKeys(rows.selection), scope) : null
  },

  async onIdeaOutcome(event) {
    if (tasteMode() === 'off') return
    const by = event.outcome === 'accepted' && event.origin?.kind === 'agent' ? 'agent' : 'operator'
    await (await tasteData()).stampIdeaOutcomeBy(event.userId, event.memoryId, by)
  },
}
