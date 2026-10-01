import { MATCHES_PER_CANDIDATE } from './types'

// Server-scheduled pairwise matches for the idea judge (docs/kairos/35).
// Round-robin-lite: walk circulant offsets 1, 2, … over the candidate ring and
// add pair (i, i+d) while both ends are still below the target degree, so every
// candidate meets ~`perCandidate` distinct opponents. Deterministic: the same
// keys always produce the same schedule.
//
// Every pair is asked TWICE with the order swapped (position-bias cancel):
// all forward legs first, then all swapped legs in the same pair order, so a
// pair's two legs sit a full schedule apart.

export interface IdeaPair {
  // p1..pN
  id: string
  a: string
  b: string
  // The two legs: forward (a first) and swapped (b first).
  forward: string
  swapped: string
}

export interface IdeaMatch {
  // m1..m2N — what the model answers by.
  id: string
  pairId: string
  // Shown as "A" then "B".
  first: string
  second: string
}

export interface MatchSchedule {
  pairs: IdeaPair[]
  matches: IdeaMatch[]
}

export function schedulePairs(keys: readonly string[], perCandidate: number = MATCHES_PER_CANDIDATE): Array<[string, string]> {
  const n = keys.length
  if (n < 2 || perCandidate < 1) return []
  const degree = new Array<number>(n).fill(0)
  const seen = new Set<string>()
  const out: Array<[number, number]> = []
  for (let d = 1; d <= Math.floor(n / 2); d++) {
    for (let i = 0; i < n; i++) {
      const j = (i + d) % n
      const lo = Math.min(i, j)
      const hi = Math.max(i, j)
      const id = `${lo}:${hi}`
      if (seen.has(id)) continue
      if (degree[i] >= perCandidate || degree[j] >= perCandidate) continue
      seen.add(id)
      degree[i]++
      degree[j]++
      out.push([i, j])
    }
  }
  return out.map(([i, j]) => [keys[i], keys[j]])
}

export function scheduleMatches(keys: readonly string[], perCandidate: number = MATCHES_PER_CANDIDATE): MatchSchedule {
  const raw = schedulePairs(keys, perCandidate)
  const n = raw.length
  const pairs: IdeaPair[] = raw.map(([a, b], i) => ({
    id: `p${i + 1}`,
    a,
    b,
    forward: `m${i + 1}`,
    swapped: `m${n + i + 1}`,
  }))
  return {
    pairs,
    matches: [
      ...pairs.map((p) => ({ id: p.forward, pairId: p.id, first: p.a, second: p.b })),
      ...pairs.map((p) => ({ id: p.swapped, pairId: p.id, first: p.b, second: p.a })),
    ],
  }
}
