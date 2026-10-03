import { cosine } from '@/lib/kairos/beliefs/cosine'
import { jaccard, tokens } from './text'
import {
  COLLISION_AGE_GAP_DAYS,
  COLLISION_ANCHOR_FLOOR,
  COLLISION_COS_MAX,
  COLLISION_COS_MIN,
  COLLISION_JACCARD_MAX,
  COLLISION_PAIRS,
  COLLISION_TRIANGLE_MIN,
  pairKeyOf,
  type CollisionCandidate,
} from './types'

// Pure, deterministic pair selection: the same candidates, anchor and clock
// give the same pairs in any input order (ties break on pairKey).

const DAY_MS = 86_400_000

export type AgeBucket = '0-7d' | '7-30d' | '30-120d' | '120d+'

export function ageBucket(createdAt: Date, now: Date): AgeBucket {
  const days = (now.getTime() - createdAt.getTime()) / DAY_MS
  if (days < 7) return '0-7d'
  if (days < 30) return '7-30d'
  if (days < 120) return '30-120d'
  return '120d+'
}

const areaOf = (c: CollisionCandidate) => c.dominionId ?? '(none)'

export interface PickedPair {
  a: CollisionCandidate
  b: CollisionCandidate
  pairKey: string
  cos: number
  relevance: number
  score: number
}

export interface PickResult {
  pairs: PickedPair[]
  anchor: 'aether' | 'triangle'
  // Pairs that passed every hard filter (before the greedy pick).
  considered: number
}

export interface PickOptions {
  now: Date
  recentPairKeys?: ReadonlySet<string>
  max?: number
}

function farInTime(a: CollisionCandidate, b: CollisionCandidate, now: Date): boolean {
  if (ageBucket(a.createdAt, now) !== ageBucket(b.createdAt, now)) return true
  return Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) >= COLLISION_AGE_GAP_DAYS * DAY_MS
}

const linked = (a: CollisionCandidate, b: CollisionCandidate) => a.linkedIds.includes(b.id) || b.linkedIds.includes(a.id)

export function pickCollisionPairs(
  candidates: readonly CollisionCandidate[],
  anchorVector: readonly number[] | null,
  opts: PickOptions,
): PickResult {
  const seen = new Set<string>()
  const cands = [...candidates]
    .filter((c) => c.embedding.length > 0 && !seen.has(c.id) && seen.add(c.id))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  const n = cands.length
  const anchor = anchorVector && anchorVector.length > 0 ? anchorVector : null
  const anchorCos = anchor ? cands.map((c) => cosine(c.embedding, anchor)) : []
  const sim: number[][] = cands.map(() => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(cands[i].embedding, cands[j].embedding)
      sim[i][j] = s
      sim[j][i] = s
    }
  }
  const words = cands.map((c) => tokens(`${c.title} ${c.summary ?? ''}`))
  const recent = opts.recentPairKeys ?? new Set<string>()

  const relevanceOf = (i: number, j: number): number | null => {
    if (anchor) {
      const r = Math.min(anchorCos[i], anchorCos[j])
      return r >= COLLISION_ANCHOR_FLOOR ? r : null
    }
    let best: number | null = null
    for (let k = 0; k < n; k++) {
      if (k === i || k === j) continue
      const r = Math.min(sim[i][k], sim[j][k])
      if (r >= COLLISION_TRIANGLE_MIN && (best === null || r > best)) best = r
    }
    return best
  }

  const viable: PickedPair[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = cands[i]
      const b = cands[j]
      if (areaOf(a) === areaOf(b)) continue
      if (!farInTime(a, b, opts.now)) continue
      const cos = sim[i][j]
      if (cos < COLLISION_COS_MIN || cos > COLLISION_COS_MAX) continue
      if (jaccard(words[i], words[j]) >= COLLISION_JACCARD_MAX) continue
      if (linked(a, b)) continue
      const pairKey = pairKeyOf(a.id, b.id)
      if (recent.has(pairKey)) continue
      const relevance = relevanceOf(i, j)
      if (relevance === null) continue
      viable.push({ a, b, pairKey, cos, relevance, score: (1 - cos) * relevance })
    }
  }

  viable.sort((x, y) => y.score - x.score || (x.pairKey < y.pairKey ? -1 : x.pairKey > y.pairKey ? 1 : 0))
  const max = opts.max ?? COLLISION_PAIRS
  const used = new Set<string>()
  const areaPairs = new Set<string>()
  const pairs: PickedPair[] = []
  for (const p of viable) {
    if (pairs.length >= max) break
    const areas = [areaOf(p.a), areaOf(p.b)].sort().join('|')
    if (used.has(p.a.id) || used.has(p.b.id) || areaPairs.has(areas)) continue
    used.add(p.a.id)
    used.add(p.b.id)
    areaPairs.add(areas)
    pairs.push(p)
  }
  return { pairs, anchor: anchor ? 'aether' : 'triangle', considered: viable.length }
}
