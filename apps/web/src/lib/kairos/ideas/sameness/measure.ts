import { cosine } from '@/lib/kairos/beliefs/cosine'
import { unpackVector } from '@/lib/kairos/constitution/drift'
import { IDEA_CANDIDATES_MAX, NOVELTY_BORDERLINE_COSINE, type IdeaCandidate } from '@/lib/kairos/ideas/types'
import type { StoredCandidate } from '@/lib/kairos/ideas/judge-context'

// Lane C batch sameness (pure). Novelty only compares a candidate with
// history; this asks whether tonight's batch is too similar to ITSELF
// (mean pairwise cosine distance) or mostly echoes the archive.

export const SAMENESS_MIN_MEASURED = 4
export const ECHO_SHARE_MAX = 0.5
export const CENTRAL_SHOWN = 6
// keepTail: p below this is the tail; a missing p counts as typical.
export const TAIL_P = 0.15
export const MISSING_P = 0.5
const HEAD_KEEP_MIN = 3
const HEAD_KEEP_BASE = 6

export interface BatchSameness {
  candidates: number
  measured: number
  meanDistance: number | null
  echoShare: number
}

type Measurable = Pick<StoredCandidate, 'vector' | 'novelty'>

const round3 = (n: number) => Math.round(n * 1000) / 1000

function vectorsOf(cands: readonly Measurable[]): number[][] {
  return cands.flatMap((c) => (c.vector ? [unpackVector(c.vector)] : []))
}

function meanDistance(vectors: readonly number[][]): number | null {
  let sum = 0
  let pairs = 0
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sum += 1 - cosine(vectors[i], vectors[j])
      pairs++
    }
  }
  return pairs > 0 ? sum / pairs : null
}

export function batchSameness(cands: readonly Measurable[]): BatchSameness {
  const vectors = vectorsOf(cands)
  const distance = meanDistance(vectors)
  const echoes = cands.filter((c) => c.novelty.maxCosine >= NOVELTY_BORDERLINE_COSINE).length
  return {
    candidates: cands.length,
    measured: vectors.length,
    meanDistance: distance === null ? null : round3(distance),
    echoShare: cands.length ? round3(echoes / cands.length) : 0,
  }
}

// Too similar: enough measured vectors AND (a tight batch OR mostly archive echoes).
export function tooSimilar(s: BatchSameness, threshold: number): boolean {
  if (s.measured < SAMENESS_MIN_MEASURED) return false
  return (s.meanDistance !== null && s.meanDistance < threshold) || s.echoShare >= ECHO_SHARE_MAX
}

// Titles of the n candidates closest to the rest of the batch (the "usual pattern").
export function centralCandidates(cands: ReadonlyArray<Pick<StoredCandidate, 'title' | 'vector'>>, n = CENTRAL_SHOWN): string[] {
  const withVec = cands.flatMap((c, i) => (c.vector ? [{ title: c.title, v: unpackVector(c.vector), i }] : []))
  if (withVec.length < 2) return cands.slice(0, n).map((c) => c.title)
  const scored = withVec.map((a) => ({
    ...a,
    mean: withVec.reduce((s, b) => (b === a ? s : s + cosine(a.v, b.v)), 0) / (withVec.length - 1),
  }))
  return scored.sort((a, b) => b.mean - a.mean || a.i - b.i).slice(0, n).map((c) => c.title)
}

const pOf = (c: IdeaCandidate) => (typeof c.likelihood === 'number' ? c.likelihood : MISSING_P)

// Keep the whole low-p tail plus the lowest-p few of the head, in arrival
// order; past the cap, the most typical go first. Re-keyed c1..cN.
export function keepTail(cands: readonly IdeaCandidate[]): IdeaCandidate[] {
  const indexed = cands.map((c, i) => ({ c, i, p: pOf(c) }))
  const tail = indexed.filter((x) => x.p < TAIL_P)
  const headRoom = Math.max(HEAD_KEEP_MIN, HEAD_KEEP_BASE - tail.length)
  const head = indexed.filter((x) => x.p >= TAIL_P).sort((a, b) => a.p - b.p || a.i - b.i).slice(0, headRoom)
  let kept = [...tail, ...head]
  if (kept.length > IDEA_CANDIDATES_MAX) kept = kept.sort((a, b) => a.p - b.p || a.i - b.i).slice(0, IDEA_CANDIDATES_MAX)
  return kept.sort((a, b) => a.i - b.i).map((x, k) => ({ ...x.c, key: `c${k + 1}` }))
}

// Model-stated typicality, clamped to [0, 1] and rounded; anything else → undefined.
export function readLikelihood(raw: unknown): number | undefined {
  const p = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof p !== 'number' || !Number.isFinite(p)) return undefined
  return round3(Math.min(1, Math.max(0, p)))
}

// The lens name exactly as shown, or null for an unknown / missing lens.
export function readLens(raw: unknown, names: readonly string[]): string | null {
  if (typeof raw !== 'string') return null
  const want = raw.trim().toLowerCase()
  return names.find((n) => n.toLowerCase() === want) ?? null
}
