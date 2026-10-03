import { cosine } from '@/lib/kairos/beliefs/cosine'

// Pure picking for the nightly dream (spec_dreams §Picking). Deterministic:
// the same candidates, anchor vector and clock give the same picks in any
// input order (ties break on id).

export interface DreamCandidate {
  id: string
  dominionId: string | null
  streamClass: string
  title: string
  summary: string | null
  createdAt: Date
  embedding: number[]
}

export const AGE_BUCKETS = ['0-7d', '7-30d', '30-120d', '120d+'] as const
export type AgeBucket = (typeof AGE_BUCKETS)[number]

export const DREAM_MIN_CANDIDATES = 3
export const DREAM_MIN_PICKS = 2
export const DREAM_PICKS = 4
export const DREAM_PICKS_WIDE = 5
export const DREAM_WIDE_AREAS = 5
export const ANCHOR_FLOOR = 0.1

const DAY_MS = 86_400_000

export function ageBucket(createdAt: Date, now: Date): AgeBucket {
  const days = (now.getTime() - createdAt.getTime()) / DAY_MS
  if (days < 7) return '0-7d'
  if (days < 30) return '7-30d'
  if (days < 120) return '30-120d'
  return '120d+'
}

const areaOf = (c: DreamCandidate) => c.dominionId ?? '(none)'
const byId = (a: DreamCandidate, b: DreamCandidate) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function newest(cands: readonly DreamCandidate[]): DreamCandidate | null {
  return [...cands].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || byId(a, b))[0] ?? null
}

export function pickAnchor(cands: readonly DreamCandidate[], anchorVector: readonly number[] | null): DreamCandidate | null {
  if (cands.length === 0) return null
  if (anchorVector && anchorVector.length > 0) {
    return [...cands].sort((a, b) => cosine(b.embedding, anchorVector) - cosine(a.embedding, anchorVector) || byId(a, b))[0]
  }
  return newest(cands.filter((c) => c.streamClass === 'reflection')) ?? newest(cands)
}

export interface DreamPick {
  candidate: DreamCandidate
  bucket: AgeBucket
}

export function dreamPickTarget(cands: readonly DreamCandidate[]): number {
  const areas = new Set(cands.filter((c) => c.dominionId).map((c) => c.dominionId))
  return areas.size >= DREAM_WIDE_AREAS ? DREAM_PICKS_WIDE : DREAM_PICKS
}

function farthest(pool: readonly DreamCandidate[], chosen: readonly DreamCandidate[]): DreamCandidate {
  let best = pool[0]
  let bestScore = -Infinity
  for (const c of [...pool].sort(byId)) {
    const score = Math.min(...chosen.map((p) => 1 - cosine(c.embedding, p.embedding)))
    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }
  return best
}

// Anchor first, then farthest-point: each next pick maximises its minimum
// distance to the picks so far, preferring a new area AND a new age bucket,
// relaxing the area rule first, then the bucket rule. Every pick stays within
// a cosine floor of the anchor so the dream keeps one thread.
export function pickDreamMemories(cands: readonly DreamCandidate[], anchorVector: readonly number[] | null, now: Date): DreamPick[] {
  const anchor = pickAnchor(cands, anchorVector)
  if (!anchor) return []
  const target = dreamPickTarget(cands)
  const chosen: DreamCandidate[] = [anchor]
  const eligible = cands.filter((c) => c.id !== anchor.id && cosine(c.embedding, anchor.embedding) >= ANCHOR_FLOOR)
  const remaining = new Map(eligible.map((c) => [c.id, c]))
  while (chosen.length < target && remaining.size > 0) {
    const areas = new Set(chosen.map(areaOf))
    const buckets = new Set(chosen.map((c) => ageBucket(c.createdAt, now)))
    const pool = [...remaining.values()]
    const newBucket = pool.filter((c) => !buckets.has(ageBucket(c.createdAt, now)))
    const newBoth = newBucket.filter((c) => !areas.has(areaOf(c)))
    const tier = newBoth.length > 0 ? newBoth : newBucket.length > 0 ? newBucket : pool
    const next = farthest(tier, chosen)
    chosen.push(next)
    remaining.delete(next.id)
  }
  return chosen.map((candidate) => ({ candidate, bucket: ageBucket(candidate.createdAt, now) }))
}

// ── Seeds ────────────────────────────────────────────────────────────────

export const DREAM_SEED_KINDS = ['focus', 'ask', 'promise', 'prediction', 'goal'] as const
export type DreamSeedKind = (typeof DREAM_SEED_KINDS)[number]
export const DREAM_MAX_SEEDS = 3
export const SEED_RECENT_MS = 36 * 3_600_000

export interface DreamSeedItem {
  kind: DreamSeedKind
  ref: string
  text: string
  touchedAt: Date | null
}

// Priority order (focus, asks, promise, prediction, goal), with anything
// touched in the last 36h moved ahead of the rest; at most three.
export function pickSeeds(items: readonly DreamSeedItem[], now: Date, cap = DREAM_MAX_SEEDS): DreamSeedItem[] {
  const recent = (s: DreamSeedItem) =>
    s.touchedAt !== null && now.getTime() - s.touchedAt.getTime() <= SEED_RECENT_MS && s.touchedAt.getTime() <= now.getTime()
  return items
    .map((s, i) => ({ s, i, r: recent(s) ? 0 : 1, p: DREAM_SEED_KINDS.indexOf(s.kind) }))
    .sort((a, b) => a.r - b.r || a.p - b.p || a.i - b.i)
    .slice(0, cap)
    .map((x) => x.s)
}
