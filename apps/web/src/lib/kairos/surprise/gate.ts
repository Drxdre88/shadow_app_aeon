import type { BeliefSourceType } from '@/lib/kairos/origin'
import type { SurpriseMode } from './flag'
import { readSurpriseMark } from './marks'

// The surprise gate (spec_surprise Lane 1) — pure decisions for Kairos's own
// rewrites of aligned beliefs in writeAlignedBeliefs. Reinforcement is never
// gated. An operator-sourced replace always goes through (it IS the owner
// correcting the belief). Any other replace goes through only while its
// target is open for update; otherwise it lands beside the target and adds
// one to the target's pressure. A retire needs a re-check flag, or (gate on)
// an open mark. 'observe' computes the would-gate verdict but never blocks;
// 'off' changes nothing.

export const PRESSURE_WINDOW_MS = 14 * 86_400_000
export const PRESSURE_OPEN_AT = 2
// A mark that never opened (pressure only): openUntil far in the past.
const NEVER_OPEN = new Date(0).toISOString()

export interface ReplaceVerdict {
  // The replace may supersede its target.
  allow: boolean
  // It would be held beside the target with the gate on.
  wouldGate: boolean
  // An operator-sourced replace: an owner correction.
  ownerCorrection: boolean
}

export function decideReplace(mode: SurpriseMode, newType: BeliefSourceType, targetOpen: boolean): ReplaceVerdict {
  if (mode === 'off') return { allow: true, wouldGate: false, ownerCorrection: false }
  if (newType === 'operator') return { allow: true, wouldGate: false, ownerCorrection: true }
  if (targetOpen) return { allow: true, wouldGate: false, ownerCorrection: false }
  return { allow: mode !== 'on', wouldGate: true, ownerCorrection: false }
}

export function decideRetire(mode: SurpriseMode, flagged: boolean, targetOpen: boolean): boolean {
  return flagged || (mode === 'on' && targetOpen)
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// Pure: the row's sourceMetadata with engine.surprise.pressure bumped by one.
// A pressure older than the window restarts at 1. A row with no (or a
// malformed) mark gets a closed mark carrying only the pressure.
export function withPressureBump(sourceMetadata: Record<string, unknown>, now: Date): Record<string, unknown> {
  const engine = isObj(sourceMetadata.engine) ? sourceMetadata.engine : {}
  const raw = isObj(engine.surprise) ? engine.surprise : null
  const mark = readSurpriseMark(sourceMetadata)
  const base = mark && raw ? raw : { openUntil: NEVER_OPEN, signals: [] }
  const prev = mark?.pressure
  const since = prev ? Date.parse(prev.since) : NaN
  const fresh = prev && Number.isFinite(since) && now.getTime() - since <= PRESSURE_WINDOW_MS
  const pressure = fresh ? { n: prev.n + 1, since: prev.since } : { n: 1, since: now.toISOString() }
  return { ...sourceMetadata, engine: { ...engine, surprise: { ...base, pressure } } }
}

// Human words for why a belief is open, from its mark's signal kinds.
const WHY: Record<string, string> = {
  prediction_wrong: 'a prediction resting on it went wrong',
  promise_lapsed: 'a promise resting on it lapsed',
  promise_dropped: 'a promise resting on it was dropped',
  owner_correction: 'the operator corrected something it rests on',
  contradiction: 'it seems to contradict another held belief',
  support_lost: 'it lost part of its support',
  pressure: 'newer evidence kept arguing against it',
}

export function openWhy(sourceMetadata: unknown): string {
  const kinds = [...new Set((readSurpriseMark(sourceMetadata)?.signals ?? []).map((s) => s.kind))]
  const words = kinds.map((k) => WHY[k] ?? 'a surprising event touched it')
  return words.length ? [...new Set(words)].join('; ') : 'a surprising event touched it'
}

// The newest signal instant on the mark (ms), or null.
export function latestSignalAt(sourceMetadata: unknown): number | null {
  let best: number | null = null
  for (const s of readSurpriseMark(sourceMetadata)?.signals ?? []) {
    const t = Date.parse(s.at)
    if (Number.isFinite(t) && (best === null || t > best)) best = t
  }
  return best
}
