// Drift maths (docs/kairos/34 §2) — pure. Per-probe cosine similarity of
// tonight's answer embedding vs the pinned baseline's, the mean, and the alert
// rule: alert when mean < 0.8 OR at least 3 probes fall below 0.6 ("flipped").

import { cosine } from '@/lib/kairos/beliefs/cosine'

export const DRIFT_MEAN_ALERT = 0.8
export const DRIFT_PROBE_FLIP = 0.6
export const DRIFT_MIN_FLIPPED = 3

export interface ProbeSimilarity {
  probeId: string
  sim: number
}

export interface DriftComparison {
  mean: number
  perProbe: ProbeSimilarity[]
  flipped: string[]
  alert: boolean
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000

export function driftAlert(mean: number, sims: readonly number[]): boolean {
  return mean < DRIFT_MEAN_ALERT || sims.filter((s) => s < DRIFT_PROBE_FLIP).length >= DRIFT_MIN_FLIPPED
}

// Compares every probe present on both sides, in `order` (the probe set's
// order). Returns null when nothing overlaps — there is no drift to measure.
export function compareToBaseline(
  baseline: ReadonlyMap<string, readonly number[]>,
  current: ReadonlyMap<string, readonly number[]>,
  order: readonly string[],
): DriftComparison | null {
  const perProbe: ProbeSimilarity[] = []
  for (const probeId of order) {
    const b = baseline.get(probeId)
    const c = current.get(probeId)
    if (!b || !c) continue
    perProbe.push({ probeId, sim: round4(cosine(b, c)) })
  }
  if (perProbe.length === 0) return null
  const sims = perProbe.map((p) => p.sim)
  const mean = round4(sims.reduce((s, x) => s + x, 0) / sims.length)
  return {
    mean,
    perProbe,
    flipped: perProbe.filter((p) => p.sim < DRIFT_PROBE_FLIP).map((p) => p.probeId),
    alert: driftAlert(mean, sims),
  }
}

// ── Compact vector storage ─────────────────────────────────────────────────
// A baseline pins one 1024-dim vector per probe in jsonb. Raw floats would be
// ~250 KB per baseline; symmetric int8 quantisation (per-vector scale, base64)
// is ~1.4 KB per probe and moves cosine similarity by < 0.001 — well below
// the 0.6/0.8 alert thresholds.

export interface PackedVector {
  s: number
  q: string
}

export function packVector(vec: readonly number[]): PackedVector {
  let maxAbs = 0
  for (const x of vec) maxAbs = Math.max(maxAbs, Math.abs(x))
  const bytes = new Int8Array(vec.length)
  if (maxAbs > 0) {
    for (let i = 0; i < vec.length; i++) bytes[i] = Math.round((vec[i] / maxAbs) * 127)
  }
  return { s: maxAbs, q: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }
}

export function unpackVector(packed: PackedVector): number[] {
  const buf = Buffer.from(packed.q, 'base64')
  const bytes = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const k = packed.s / 127
  return Array.from(bytes, (b) => b * k)
}

export function isPackedVector(v: unknown): v is PackedVector {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.s === 'number' && Number.isFinite(r.s) && typeof r.q === 'string'
}
