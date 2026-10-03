import {
  STAGE_MAX_AMBIENT_SEEN,
  STAGE_MAX_BYTES,
  STAGE_MAX_CITES,
  STAGE_MAX_COALITIONS,
  STAGE_MAX_CYCLES,
  STAGE_MAX_MEMBERS,
  STAGE_MAX_POSTED_JOBS,
  STAGE_MAX_SURPRISE,
} from '@/lib/data/validators/kairos-stage'
import { BRAIN_JOBS } from '@/lib/kairos/routines/catalog'
import { STAGE_SPECULATIVE_KINDS } from './flag'
import { londonDateHour } from '@/lib/kairos/thinking/deadlines'
import { clamp01, hash8, jaccard, normaliseCandidate, stageTokens } from './normalise'
import type {
  AmbientCandidate,
  KairosStageState,
  StageCandidateInput,
  StageCoalition,
  StageFocus,
  StageMember,
  StagePost,
  StagePostResult,
  StageSource,
  StageTier,
} from './types'

// ─────────────────────────────────────────────────────────────────────────
// Stage selector (spec_stage §5) — pure, no I/O. Every write goes through
// applyStagePost inside mutateKairosStage (FOR UPDATE), so it must stay pure:
// it can run twice when a concurrent first insert of the preferences row wins.
// ─────────────────────────────────────────────────────────────────────────

export const SALIENCE_WEIGHTS = { importance: 0.35, surprise: 0.25, goalRelevance: 0.25, need: 0.15 } as const
export const LIGHT_TIER_FACTOR = 0.6
export const MASS_HALF_LIFE_MS = 6 * 3_600_000
export const MERGE_JACCARD = 0.5
export const MERGE_JACCARD_WITH_CITE = 0.3
export const STAGE_RENDER_TOP = 4
export const WIN_MIN_STRENGTH = 0.15
export const INHIBITION_PER_WIN = 0.85
export const IGNITION_WINS = 3
export const FOCUS_REPLACE_RATIO = 1.5

export function emptyStageState(): KairosStageState {
  return { v: 1, updatedAt: null, coalitions: [], cycles: [], focus: null, surprise: [], postedJobs: [], ambientSeen: [] }
}

// 'YYYY-MM-DDTHH' — the London hour bucket a cycle covers.
export function londonCycleKey(now: Date): string {
  const { date, hour } = londonDateHour(now)
  return `${date}T${String(hour).padStart(2, '0')}`
}

export function londonDateOf(now: Date): string {
  return londonDateHour(now).date
}

// Light tier = the cheap daytime pulse, plus speculative kinds (dreams).
// Unknown kinds count as deep.
export function stageTierForKind(kind: string): StageTier {
  if ((STAGE_SPECULATIVE_KINDS as readonly string[]).includes(kind)) return 'light'
  return BRAIN_JOBS.find((j) => j.kind === kind)?.tier ?? 'deep'
}

export function salience(c: Pick<StageCandidateInput, 'importance' | 'surprise' | 'goalRelevance' | 'need'>, tier: StageTier): number {
  const w = SALIENCE_WEIGHTS
  const raw = clamp01(w.importance * c.importance + w.surprise * c.surprise + w.goalRelevance * c.goalRelevance + w.need * c.need)
  return tier === 'light' ? raw * LIGHT_TIER_FACTOR : raw
}

export function decayedMass(c: Pick<StageCoalition, 'mass' | 'massAt'>, now: Date): number {
  const dt = Math.max(0, now.getTime() - new Date(c.massAt).getTime())
  return c.mass * Math.pow(0.5, dt / MASS_HALF_LIFE_MS)
}

// Decayed mass with inhibition of return (×0.85 per consecutive win).
export function effectiveStrength(c: StageCoalition, now: Date): number {
  return decayedMass(c, now) * Math.pow(INHIBITION_PER_WIN, c.wins)
}

export interface RankedCoalition {
  coalition: StageCoalition
  strength: number
}

export function rankCoalitions(state: KairosStageState, now: Date, opts: { deepOnly?: boolean } = {}): RankedCoalition[] {
  return state.coalitions
    .filter((c) => !opts.deepOnly || c.deepBacked)
    .map((coalition) => ({ coalition, strength: effectiveStrength(coalition, now) }))
    .sort((a, b) =>
      b.strength - a.strength
      || a.coalition.firstAt.localeCompare(b.coalition.firstAt)
      || a.coalition.id.localeCompare(b.coalition.id))
}

// Focus lasts one London day.
export function activeFocus(state: KairosStageState, now: Date): StageFocus | null {
  return state.focus && state.focus.londonDate === londonDateOf(now) ? state.focus : null
}

export function stageNeedsRollover(state: KairosStageState, now: Date): boolean {
  return !state.updatedAt || londonCycleKey(new Date(state.updatedAt)) < londonCycleKey(now)
}

export function surpriseSince(state: KairosStageState, since: Date, now: Date = new Date()): number {
  const from = since.getTime()
  const to = now.getTime()
  return state.surprise.reduce((sum, e) => {
    const t = new Date(e.at).getTime()
    return t > from && t <= to ? sum + e.s : sum
  }, 0)
}

// The first post in a new London hour closes the previous hour's cycle: the
// top coalition (as of that cycle's last post) wins if strong enough. Three
// consecutive wins by a deep/owner-backed coalition ignite the day's focus.
export function closeCycleIfDue(state: KairosStageState, now: Date): KairosStageState {
  if (!state.updatedAt) return state
  const at = new Date(state.updatedAt)
  const prevKey = londonCycleKey(at)
  if (prevKey >= londonCycleKey(now) || state.cycles.some((c) => c.cycle === prevKey)) return state
  const s = structuredClone(state)
  const ranked = rankCoalitions(s, at)
  const lead = ranked[0]
  const winner = lead && lead.strength >= WIN_MIN_STRENGTH ? lead : null
  const lastWinnerId = s.cycles.at(-1)?.winnerId ?? null
  for (const c of s.coalitions) {
    c.wins = winner && c.id === winner.coalition.id ? (lastWinnerId === c.id ? c.wins + 1 : 1) : 0
  }
  if (winner) ignite(s, winner, at, now)
  s.cycles.push({ cycle: prevKey, winnerId: winner?.coalition.id ?? null, top: ranked.slice(0, STAGE_RENDER_TOP).map((r) => r.coalition.id), at: now.toISOString() })
  s.cycles = s.cycles.slice(-STAGE_MAX_CYCLES)
  return s
}

function ignite(s: KairosStageState, winner: RankedCoalition, at: Date, now: Date): void {
  const c = s.coalitions.find((x) => x.id === winner.coalition.id)
  if (!c || c.wins < IGNITION_WINS || !c.deepBacked) return
  const focus = activeFocus(s, now)
  if (focus?.coalitionId === c.id) return
  if (focus) {
    const held = s.coalitions.find((x) => x.id === focus.coalitionId)
    const heldStrength = held ? effectiveStrength(held, at) : 0
    if (winner.strength < FOCUS_REPLACE_RATIO * heldStrength) return
  }
  s.focus = { coalitionId: c.id, text: c.text, since: now.toISOString(), londonDate: londonDateOf(now) }
}

interface IngestMeta {
  kind: string
  source: StageSource
  tier: StageTier
  jobId?: string
  given?: readonly string[]
}

function bestMatch(s: KairosStageState, item: StageCandidateInput): StageCoalition | null {
  const tokens = stageTokens(item.text)
  const cites = item.cites ?? []
  let best: StageCoalition | null = null
  let bestScore = -1
  for (const c of s.coalitions) {
    const j = jaccard(tokens, stageTokens(c.text))
    const shared = cites.some((x) => c.cites.includes(x))
    if ((j >= MERGE_JACCARD || (j >= MERGE_JACCARD_WITH_CITE && shared)) && j > bestScore) {
      best = c
      bestScore = j
    }
  }
  return best
}

function ingest(s: KairosStageState, item: StageCandidateInput, meta: IngestMeta, now: Date, result: StagePostResult): void {
  const nowIso = now.toISOString()
  const base = salience(item, meta.tier)
  const cites = item.cites ?? []
  const match = bestMatch(s, item)
  const memberId = `m_${hash8(`${match?.id ?? ''}|${meta.jobId ?? ''}|${meta.kind}|${nowIso}|${item.text}`)}`
  const member: StageMember = {
    id: memberId, kind: meta.kind, source: meta.source, ...(meta.jobId ? { jobId: meta.jobId } : {}), tier: meta.tier, at: nowIso, base,
  }
  if (match) {
    const newCites = cites.filter((x) => !match.cites.includes(x))
    // Echo rule: a job shown this coalition that hands it back with no new
    // evidence adds nothing (rumination guard).
    if (meta.given?.includes(match.id) && newCites.length === 0) {
      match.members = [...match.members, { ...member, base: 0, echo: true as const }].slice(-STAGE_MAX_MEMBERS)
      result.echoed++
      return
    }
    match.mass = Math.min(1000, decayedMass(match, now) + base)
    match.massAt = nowIso
    match.components = {
      importance: Math.max(match.components.importance, item.importance),
      surprise: Math.max(match.components.surprise, item.surprise),
      goalRelevance: Math.max(match.components.goalRelevance, item.goalRelevance),
      need: Math.max(match.components.need, item.need),
    }
    match.cites = [...match.cites, ...newCites].slice(0, STAGE_MAX_CITES)
    match.members = [...match.members, member].slice(-STAGE_MAX_MEMBERS)
    match.deepBacked = match.deepBacked || meta.tier !== 'light'
    result.merged++
  } else {
    let id = `c_${hash8(item.text.toLowerCase())}`
    if (s.coalitions.some((c) => c.id === id)) id = `c_${hash8(`${item.text}|${nowIso}|${s.coalitions.length}`)}`
    s.coalitions.push({
      id,
      text: item.text,
      cites: cites.slice(0, STAGE_MAX_CITES),
      components: { importance: item.importance, surprise: item.surprise, goalRelevance: item.goalRelevance, need: item.need },
      mass: base,
      massAt: nowIso,
      firstAt: nowIso,
      wins: 0,
      deepBacked: meta.tier !== 'light',
      members: [member],
    })
  }
  result.posted++
  const s01 = meta.tier === 'light' ? item.surprise * LIGHT_TIER_FACTOR : item.surprise
  s.surprise.push({ at: nowIso, s: clamp01(s01), kind: meta.kind, tier: meta.tier })
}

// Over the byte budget: drop the weakest coalitions, then the oldest cycles.
function fitBudget(s: KairosStageState, now: Date): void {
  while (JSON.stringify(s).length > STAGE_MAX_BYTES) {
    if (s.coalitions.length > 1) {
      const weakest = rankCoalitions(s, now).at(-1)!.coalition.id
      s.coalitions = s.coalitions.filter((c) => c.id !== weakest)
    } else if (s.cycles.length > 0) s.cycles.shift()
    else if (s.surprise.length > 0) s.surprise.shift()
    else break
  }
}

export interface StagePostInput {
  post?: StagePost
  ambient?: readonly AmbientCandidate[]
}

// The one pure mutation: close a due cycle, ingest the post's items and any
// unseen ambient facts, cap and prune. `state: null` = nothing to write
// (re-posting the same job is a no-op).
export function applyStagePost(
  state: KairosStageState,
  input: StagePostInput,
  now: Date,
): { state: KairosStageState | null; result: StagePostResult } {
  const result: StagePostResult = { posted: 0, merged: 0, echoed: 0, ambient: 0, dropped: 0 }
  const post = input.post
  if (post?.jobId && state.postedJobs.includes(post.jobId)) return { state: null, result: { ...result, skipped: 'duplicate_job' } }
  const items: StageCandidateInput[] = []
  for (const raw of post?.items ?? []) {
    const c = normaliseCandidate(raw)
    if (c) items.push(c)
    else result.dropped++
  }
  const seen = new Set(state.ambientSeen)
  const ambient: AmbientCandidate[] = []
  for (const a of input.ambient ?? []) {
    if (seen.has(a.key)) continue
    seen.add(a.key)
    const c = normaliseCandidate(a)
    if (c) ambient.push({ ...a, ...c })
    else result.dropped++
  }
  if (items.length === 0 && ambient.length === 0 && !post?.jobId) return { state: null, result: { ...result, skipped: 'empty' } }

  let s = closeCycleIfDue(state, now)
  if (s === state) s = structuredClone(state)
  s.focus = activeFocus(s, now)
  if (post) {
    for (const item of items) ingest(s, item, { kind: post.kind, source: post.source, tier: post.tier, jobId: post.jobId, given: post.given }, now, result)
    if (post.jobId) s.postedJobs = [...s.postedJobs, post.jobId].slice(-STAGE_MAX_POSTED_JOBS)
  }
  for (const a of ambient) {
    ingest(s, a, { kind: a.kind, source: a.source, tier: a.tier }, now, result)
    s.ambientSeen = [...s.ambientSeen, a.key].slice(-STAGE_MAX_AMBIENT_SEEN)
    result.ambient++
  }
  s.surprise = s.surprise.slice(-STAGE_MAX_SURPRISE)
  const keep = new Set(rankCoalitions(s, now).slice(0, STAGE_MAX_COALITIONS).map((r) => r.coalition.id))
  s.coalitions = s.coalitions.filter((c) => keep.has(c.id))
  s.updatedAt = now.toISOString()
  fitBudget(s, now)
  return { state: s, result }
}
