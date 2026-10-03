import type { ApplyOutcome } from '@/lib/kairos/engine/types'
import { stageMode, type StageCandidateInput } from '@/lib/kairos/stage'

// ─────────────────────────────────────────────────────────────────────────
// Stage producers (spec_stage §3): one small pure deriver per handler that
// turns what the job just applied into the thoughts it offers the stage. The
// queue posts them after the apply (lib/kairos/stage/queue-glue.ts); the
// selector sanitises, clamps and applies the light-tier ×0.6. Components the
// spec does not state use STAGE_BASE. Blind kinds may still PRODUCE — they
// just never read the stage.
// ─────────────────────────────────────────────────────────────────────────

export const STAGE_BASE = { importance: 0.5, surprise: 0.3, goalRelevance: 0.3, need: 0.3 } as const

type Over = Partial<Omit<StageCandidateInput, 'text'>>

function thought(text: string | null | undefined, over: Over = {}): StageCandidateInput | null {
  const t = text?.trim()
  if (!t) return null
  const cites = over.cites?.filter(Boolean) ?? []
  return {
    text: t,
    importance: over.importance ?? STAGE_BASE.importance,
    surprise: over.surprise ?? STAGE_BASE.surprise,
    goalRelevance: over.goalRelevance ?? STAGE_BASE.goalRelevance,
    need: over.need ?? STAGE_BASE.need,
    ...(cites.length ? { cites } : {}),
  }
}

const some = (...items: Array<StageCandidateInput | null>): StageCandidateInput[] =>
  items.filter((t): t is StageCandidateInput => t !== null)

// The ok outcome with its thoughts attached — untouched when KAIROS_STAGE is
// off or there is nothing to offer, so job outcomes stay byte-identical.
export function withThoughts(outcome: ApplyOutcome, thoughts: readonly StageCandidateInput[]): ApplyOutcome {
  if (!outcome.ok || thoughts.length === 0 || stageMode() === 'off') return outcome
  return { ...outcome, thoughts: [...thoughts] }
}

// pulse: only what the model put in its optional `stage` field (≤2, already
// parsed by parseStageItems). Light tier — the selector weights it ×0.6.
export function pulseThoughts(stage: readonly StageCandidateInput[]): StageCandidateInput[] {
  return stage.slice(0, 2)
}

// reflect: the thought itself, plus its optional `stage` items.
export function reflectThoughts(out: {
  thought: string | null
  goalNotes: readonly unknown[]
  evidenceIds: readonly string[]
  stage?: readonly StageCandidateInput[]
}): StageCandidateInput[] {
  const main = thought(out.thought, { goalRelevance: out.goalNotes.length > 0 ? 0.8 : 0.3, cites: [...out.evidenceIds] })
  return [...some(main), ...(out.stage ?? []).slice(0, 2)]
}

// agenda_due: the note / ask / message text; nothing for 'nothing'.
export function agendaDueThoughts(out: { result: string; text: string }, goalId: string | null): StageCandidateInput[] {
  if (out.result === 'nothing') return []
  return some(thought(out.text, { need: 0.7, ...(goalId ? { goalRelevance: 0.8 } : {}) }))
}

// aether: the most salient thought; tensions and eurekas are surprising.
export function aetherThoughts(payload: {
  thoughts: ReadonlyArray<{ title: string; insight: string; salience: number; kind: string; sourceMemoryIds: string[] }>
}): StageCandidateInput[] {
  const top = [...payload.thoughts].sort((a, b) => b.salience - a.salience)[0]
  if (!top) return []
  const surprising = top.kind === 'eureka' || top.kind === 'tension'
  return some(thought(`${top.title}: ${top.insight}`, {
    importance: top.salience,
    ...(surprising ? { surprise: 0.7 } : {}),
    cites: top.sourceMemoryIds,
  }))
}

// cortex: the first drift signal, else the first recent shift, of one area.
export function cortexThoughts(dominionName: string, payload: { driftSignals: readonly string[]; recentShifts: readonly string[] }): StageCandidateInput[] {
  const signal = payload.driftSignals[0] ?? payload.recentShifts[0]
  if (!signal?.trim()) return []
  return some(thought(`${dominionName}: ${signal}`, { surprise: 0.6, importance: 0.5 }))
}

// belief_extract: what changed in the owner's beliefs. Reinforcement is not
// news and posts nothing; replacements and retirements are surprising.
export function beliefExtractThoughts(answer: {
  claims: ReadonlyArray<{ claim: string; relation: 'new' | 'reinforces' | 'replaces'; targetId: string | null; provenance: string[] }>
  retire: ReadonlyArray<{ reason: string }>
}): StageCandidateInput[] {
  const changed = answer.claims
    .filter((c) => !(c.relation === 'reinforces' && c.targetId))
    .map((c) => thought(`Now believe: ${c.claim}`, { ...(c.relation === 'replaces' ? { surprise: 0.6 } : {}), cites: c.provenance }))
  const retired = answer.retire.map((r) => thought(`Retired a belief: ${r.reason}`, { surprise: 0.6 }))
  return some(...changed, ...retired).slice(0, 3)
}

// idea_judge: the top survivor; importance from where its Elo ranks among
// every contender (beats them all → 1). An unrated survivor sorts last.
export function ideaJudgeThoughts(survivors: ReadonlyArray<{ title: string; elo: number | null }>, allElos: readonly number[]): StageCandidateInput[] {
  const rated = (e: number | null) => e ?? -Infinity
  const top = [...survivors].sort((a, b) => rated(b.elo) - rated(a.elo))[0]
  if (!top) return []
  const others = Math.max(1, allElos.length - 1)
  const beaten = allElos.filter((e) => e < rated(top.elo)).length
  return some(thought(top.title, { importance: 0.4 + 0.6 * Math.min(1, beaten / others) }))
}

// goal_propose: the proposed goal is, by definition, goal-relevant.
export function goalProposeThoughts(title: string): StageCandidateInput[] {
  return some(thought(title, { goalRelevance: 1 }))
}

// ask_mine: the question Kairos most wants answered.
export function askMineThoughts(question: string | null | undefined, cites: readonly string[] = []): StageCandidateInput[] {
  return some(thought(question, { need: 0.6, cites: [...cites] }))
}

// weekly_review: the week's summary.
export function weeklyReviewThoughts(summary: string): StageCandidateInput[] {
  return some(thought(summary))
}

// mind_compare: only when the two minds diverge; surprise ∝ the diverging share.
export function mindCompareThoughts(pairs: ReadonlyArray<{ verdict: string }>): StageCandidateInput[] {
  const diverge = pairs.filter((p) => p.verdict !== 'agree').length
  if (diverge === 0) return []
  const noun = diverge === 1 ? 'belief pair diverges' : 'belief pairs diverge'
  return some(thought(`${diverge} ${noun} between your mind and mine`, { surprise: Math.min(1, diverge / pairs.length) }))
}

// drift_probe: only a flagged drift is news. Conscience results are
// measurement only and are never posted (conscience-probes.ts:9-11).
export function driftProbeThoughts(flag: { alert?: boolean; flipped?: number }): StageCandidateInput[] {
  if (flag.alert) {
    const n = flag.flipped ?? 0
    return some(thought(`My answers drifted from the constitution baseline${n ? ` (${n} flipped)` : ''}`, { importance: 0.9 }))
  }
  return []
}
