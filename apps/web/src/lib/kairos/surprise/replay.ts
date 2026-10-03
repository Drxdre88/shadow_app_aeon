import type { KairosAgendaItem } from '@/lib/data/validators/kairos-agenda'
import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import type { KairosPromise } from '@/lib/data/validators/kairos-promises'
import type { KairosSurpriseLedger, SurpriseReplay } from '@/lib/data/validators/kairos-surprise'
import { SURPRISE_MAX_REPLAY_IDS } from '@/lib/data/validators/kairos-surprise'
import { readBelief } from '@/lib/kairos/beliefs/types'
import { isOpen } from './marks'

// ─────────────────────────────────────────────────────────────────────────
// Replay (spec_surprise Lane 3) — pure. Instead of recency only, the nightly
// syntheses also see what is about to matter (need) and what is most worth
// re-reading (gain). Priority = need × gain; a memory replayed three nights
// running is inhibited (×0.5) so the set keeps moving. The I/O half lives in
// ./replay-reader.
// ─────────────────────────────────────────────────────────────────────────

export const REPLAY_TOP = 8
export const REPLAY_PER_DOMINION = 4
export const REPLAY_AGENDA_HOURS = 72
export const REPLAY_PREDICTION_DAYS = 7
export const REPLAY_HOP = 0.8
export const REPLAY_STREAK_NIGHTS = 3
export const REPLAY_INHIBIT = 0.5

const HOUR = 3_600_000
const DAY = 24 * HOUR

export type ReplayWhy = 'agenda' | 'prediction' | 'goal' | 'promise' | 'belief'

export interface ReplayNeed {
  id: string
  need: number
  why: ReplayWhy
  dominionId: string | null
}

export interface ReplayGoal {
  id: string
  dominionId: string | null
  seedIds: readonly string[]
}

export interface ReplaySources {
  agenda: readonly Pick<KairosAgendaItem, 'status' | 'dueAt' | 'basisIds' | 'dominionId'>[]
  predictions: readonly Pick<KairosPrediction, 'status' | 'dueDate' | 'basisIds' | 'dominionId'>[]
  goals: readonly ReplayGoal[]
  promises: readonly Pick<KairosPromise, 'status' | 'dueDate' | 'source'>[]
}

export interface ReplayCiter {
  id: string
  dominionId: string | null
  provenance: readonly string[]
}

export interface ReplayRow {
  id: string
  title: string
  summary: string | null
  dominionId: string | null
  sourceMetadata: unknown
}

export interface ReplayCandidate {
  id: string
  title: string
  summary: string | null
  dominionId: string | null
  why: ReplayWhy
  need: number
  gain: number
  priority: number
  questioned: boolean
  inhibited: boolean
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

// Agenda item due within 72h: 1 − h/72 (overdue → 1). null = not due soon.
export function agendaNeed(dueAt: string, now: Date): number | null {
  const t = Date.parse(dueAt)
  if (!Number.isFinite(t)) return null
  const h = Math.max(0, (t - now.getTime()) / HOUR)
  return h > REPLAY_AGENDA_HOURS ? null : clamp01(1 - h / REPLAY_AGENDA_HOURS)
}

// Open prediction due within 7 days: .2 + .8(1 − d/7) (overdue → 1).
export function predictionNeed(dueDate: string, now: Date): number | null {
  const t = Date.parse(`${dueDate}T12:00:00.000Z`)
  if (!Number.isFinite(t)) return null
  const d = Math.max(0, (t - now.getTime()) / DAY)
  return d > REPLAY_PREDICTION_DAYS ? null : clamp01(0.2 + 0.8 * (1 - d / REPLAY_PREDICTION_DAYS))
}

function put(out: Map<string, ReplayNeed>, id: string, need: number, why: ReplayWhy, dominionId: string | null) {
  if (!id) return
  const cur = out.get(id)
  if (!cur || need > cur.need) out.set(id, { id, need: round3(need), why, dominionId: dominionId ?? cur?.dominionId ?? null })
}

// Direct need per memory id (max over sources): agenda basis, open
// prediction basis, active/proposed goal (+ seeds) .7, overdue goal-sourced
// promise (its goal + seeds) .9.
export function collectReplayNeeds(src: ReplaySources, now: Date): Map<string, ReplayNeed> {
  const out = new Map<string, ReplayNeed>()
  for (const a of src.agenda) {
    if (a.status !== 'open' && a.status !== 'fired') continue
    const need = agendaNeed(a.dueAt, now)
    if (need !== null) for (const id of a.basisIds) put(out, id, need, 'agenda', a.dominionId)
  }
  for (const p of src.predictions) {
    if (p.status !== 'open' && p.status !== 'needs_verdict') continue
    const need = predictionNeed(p.dueDate, now)
    if (need !== null) for (const id of p.basisIds) put(out, id, need, 'prediction', p.dominionId)
  }
  const goals = new Map(src.goals.map((g) => [g.id, g]))
  for (const g of src.goals) for (const id of [g.id, ...g.seedIds]) put(out, id, 0.7, 'goal', g.dominionId)
  const today = now.toISOString().slice(0, 10)
  for (const p of src.promises) {
    if (p.status !== 'open' || p.source.kind !== 'goal' || !p.source.goalId || p.dueDate >= today) continue
    const goal = goals.get(p.source.goalId)
    for (const id of [p.source.goalId, ...(goal?.seedIds ?? [])]) put(out, id, 0.9, 'promise', goal?.dominionId ?? null)
  }
  return out
}

// One hop: a held belief citing a needed id inherits that need × .8.
export function applyBeliefHop(needs: ReadonlyMap<string, ReplayNeed>, citers: readonly ReplayCiter[]): Map<string, ReplayNeed> {
  const out = new Map(needs)
  for (const b of citers) {
    let best = 0
    for (const pid of b.provenance) best = Math.max(best, needs.get(pid)?.need ?? 0)
    if (best > 0) put(out, b.id, best * REPLAY_HOP, 'belief', b.dominionId)
  }
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function negativeOutcome(meta: unknown): boolean {
  if (!isObj(meta) || !isObj(meta.engine) || !isObj(meta.engine.outcome)) return false
  const n = Number(meta.engine.outcome.negative)
  return Number.isFinite(n) && n > 0
}

// Gain: open mark 1.0; belief under re-check .9; belief confidence in
// [.4,.75] .7; negative outcome .6; other belief .3; non-belief .4.
export function replayGain(meta: unknown, now: Date): { gain: number; questioned: boolean } {
  if (isOpen(meta, now)) return { gain: 1, questioned: true }
  const belief = readBelief(meta)
  if (belief?.recheck) return { gain: 0.9, questioned: true }
  if (belief && belief.confidence >= 0.4 && belief.confidence <= 0.75) return { gain: 0.7, questioned: false }
  if (negativeOutcome(meta)) return { gain: 0.6, questioned: false }
  return { gain: belief ? 0.3 : 0.4, questioned: false }
}

// Ids replayed on every one of the previous (REPLAY_STREAK_NIGHTS − 1)
// nights — tonight would make three in a row.
export function inhibitedIds(history: readonly (readonly string[])[]): Set<string> {
  const need = REPLAY_STREAK_NIGHTS - 1
  if (history.length < need) return new Set()
  const [first, ...rest] = history.slice(0, need)
  return new Set(first.filter((id) => rest.every((h) => h.includes(id))))
}

// Scores every row that has a need. Retired beliefs never replay. Sorted by
// priority desc, ties by id (deterministic).
export function scoreReplay(input: {
  needs: ReadonlyMap<string, ReplayNeed>
  rows: readonly ReplayRow[]
  now: Date
  inhibited?: ReadonlySet<string>
}): ReplayCandidate[] {
  const out: ReplayCandidate[] = []
  for (const row of input.rows) {
    const need = input.needs.get(row.id)
    if (!need) continue
    if (readBelief(row.sourceMetadata)?.status === 'retired') continue
    const { gain, questioned } = replayGain(row.sourceMetadata, input.now)
    const inhibited = input.inhibited?.has(row.id) ?? false
    const priority = round3(need.need * gain * (inhibited ? REPLAY_INHIBIT : 1))
    if (priority <= 0) continue
    out.push({
      id: row.id,
      title: row.title,
      summary: row.summary,
      dominionId: row.dominionId ?? need.dominionId,
      why: need.why,
      need: need.need,
      gain,
      priority,
      questioned,
      inhibited,
    })
  }
  return out.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
}

export const topReplay = (c: readonly ReplayCandidate[], n = REPLAY_TOP) => c.slice(0, n)

export const topReplayForDominion = (c: readonly ReplayCandidate[], dominionId: string, n = REPLAY_PER_DOMINION) =>
  c.filter((x) => x.dominionId === dominionId).slice(0, n)

const WHY_LABEL: Record<ReplayWhy, string> = {
  agenda: 'agenda item due soon',
  prediction: 'prediction due soon',
  goal: 'open goal',
  promise: 'overdue promise',
  belief: 'belief behind something due soon',
}

// Short reason line (no ids) shared by the aether and cortex renderers.
export function replayNote(c: Pick<ReplayCandidate, 'why' | 'questioned'>): string {
  return c.questioned ? `${WHY_LABEL[c.why]}; under question` : WHY_LABEL[c.why]
}

// The ledger's replay block for tonight. Idempotent per night (a second
// computation the same night writes nothing). prevHits = how many of last
// night's ids the latest aether actually cited.
export function applyReplayNight(
  ledger: KairosSurpriseLedger,
  input: { night: string; ids: readonly string[]; cited: Iterable<string> },
): { state: KairosSurpriseLedger | null; result: SurpriseReplay | null } {
  if (ledger.replay?.night === input.night) return { state: null, result: ledger.replay }
  const prev = ledger.replay
  const cited = new Set(input.cited)
  const replay: SurpriseReplay = {
    night: input.night,
    ids: [...new Set(input.ids)].slice(0, SURPRISE_MAX_REPLAY_IDS),
    ...(prev ? { prevHits: prev.ids.filter((id) => cited.has(id)).length } : {}),
  }
  return { state: { ...ledger, replay }, result: replay }
}
