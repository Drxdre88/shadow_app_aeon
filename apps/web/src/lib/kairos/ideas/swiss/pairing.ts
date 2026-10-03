import { pairOutcome } from '../elo'
import type { IdeaMatch, IdeaPair, MatchSchedule } from '../pairing'

// Swiss pairing for the multi-round idea judge (lane A). Round 1 folds the
// contenders in key order (top half vs bottom half). Later rounds pair within
// score groups — score 1 / ½ / 0 per both-orders pair, Buchholz to break
// ties — never a rematch (backtracking, memoised on a bitmask; n ≤ 16). An
// odd field gives one bye (½ point, no Elo) to the lowest-ranked player who
// has not had one.

export const SWISS_MAX_PLAYERS = 16

export interface SwissStanding {
  key: string
  score: number
  buchholz: number
  opponents: string[]
}

export interface SwissRoundPairing {
  pairs: Array<[string, string]>
  bye: string | null
}

export function swissKeyOrder(a: string, b: string): number {
  const na = Number(a.replace(/^\D+/, ''))
  const nb = Number(b.replace(/^\D+/, ''))
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function swissStandings(
  keys: readonly string[],
  pairs: readonly IdeaPair[],
  votes: ReadonlyMap<string, string>,
  byes: readonly string[] = [],
): Map<string, SwissStanding> {
  const table = new Map<string, SwissStanding>(keys.map((k) => [k, { key: k, score: 0, buchholz: 0, opponents: [] }]))
  for (const p of pairs) {
    const a = table.get(p.a)
    const b = table.get(p.b)
    if (a) a.opponents.push(p.b)
    if (b) b.opponents.push(p.a)
    const out = pairOutcome(p, votes)
    if (out.kind === 'draw') {
      if (a) a.score += 0.5
      if (b) b.score += 0.5
    } else if (out.kind === 'win') {
      const w = table.get(out.winner)
      if (w) w.score += 1
    }
  }
  for (const k of byes) {
    const s = table.get(k)
    if (s) s.score += 0.5
  }
  for (const s of table.values()) s.buchholz = s.opponents.reduce((n, o) => n + (table.get(o)?.score ?? 0), 0)
  return table
}

export function pairRound1(keys: readonly string[]): SwissRoundPairing {
  const sorted = [...keys].sort(swissKeyOrder)
  const half = Math.floor(sorted.length / 2)
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < half; i++) pairs.push([sorted[i], sorted[i + half]])
  return { pairs, bye: sorted.length % 2 === 1 ? sorted[sorted.length - 1] : null }
}

function perfectPairing(order: readonly string[], played: ReadonlySet<string>): Array<[string, string]> | null {
  const n = order.length
  const failed = new Set<number>()
  const solve = (mask: number): Array<[string, string]> | null => {
    if (mask === (1 << n) - 1) return []
    if (failed.has(mask)) return null
    let i = 0
    while (mask & (1 << i)) i++
    for (let j = i + 1; j < n; j++) {
      if (mask & (1 << j) || played.has(pairKey(order[i], order[j]))) continue
      const rest = solve(mask | (1 << i) | (1 << j))
      if (rest) return [[order[i], order[j]], ...rest]
    }
    failed.add(mask)
    return null
  }
  return solve(0)
}

// null when no rematch-free pairing exists (the tournament then ends).
export function pairSwissRound(
  keys: readonly string[],
  standings: ReadonlyMap<string, SwissStanding>,
  played: ReadonlySet<string>,
  byes: ReadonlySet<string> = new Set(),
): SwissRoundPairing | null {
  if (keys.length < 2 || keys.length > SWISS_MAX_PLAYERS) return null
  const st = (k: string) => standings.get(k) ?? { score: 0, buchholz: 0 }
  const ranked = [...keys].sort((a, b) => st(b).score - st(a).score || st(b).buchholz - st(a).buchholz || swissKeyOrder(a, b))
  if (ranked.length % 2 === 0) {
    const pairs = perfectPairing(ranked, played)
    return pairs ? { pairs, bye: null } : null
  }
  const byeOrder = [...ranked].reverse().sort((a, b) => Number(byes.has(a)) - Number(byes.has(b)))
  for (const bye of byeOrder) {
    const pairs = perfectPairing(ranked.filter((k) => k !== bye), played)
    if (pairs) return { pairs, bye }
  }
  return null
}

// Both-orders legs for one round, ids continuing after `after` (unique across
// rounds): forward legs first, then the swapped legs in the same pair order.
export function toRoundSchedule(raw: ReadonlyArray<[string, string]>, after: { pair: number; match: number }): MatchSchedule {
  const n = raw.length
  const pairs: IdeaPair[] = raw.map(([a, b], i) => ({
    id: `p${after.pair + i + 1}`,
    a,
    b,
    forward: `m${after.match + i + 1}`,
    swapped: `m${after.match + n + i + 1}`,
  }))
  const matches: IdeaMatch[] = [
    ...pairs.map((p) => ({ id: p.forward, pairId: p.id, first: p.a, second: p.b })),
    ...pairs.map((p) => ({ id: p.swapped, pairId: p.id, first: p.b, second: p.a })),
  ]
  return { pairs, matches }
}
