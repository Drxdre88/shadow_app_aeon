import { ELO_K, ELO_START } from './types'
import type { IdeaPair } from './pairing'

// Elo over the judge's pairwise votes (docs/kairos/35). Each pair is judged in
// both orders: the same winner twice is a win; a split (position bias), or a
// single surviving vote, is a draw; no vote at all leaves both ratings alone.
// Ratings update sequentially in schedule order (deterministic).

export interface EloRecord {
  elo: number
  wins: number
  losses: number
  draws: number
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400))
}

// scoreA: 1 win, 0.5 draw, 0 loss. Returns the new [ra, rb].
export function updateElo(ra: number, rb: number, scoreA: number, k: number = ELO_K): [number, number] {
  const ea = expectedScore(ra, rb)
  const delta = k * (scoreA - ea)
  return [ra + delta, rb - delta]
}

export type PairOutcome = { kind: 'win'; winner: string; loser: string } | { kind: 'draw' } | { kind: 'none' }

export function pairOutcome(pair: IdeaPair, votes: ReadonlyMap<string, string>): PairOutcome {
  const valid = (w: string | undefined) => (w === pair.a || w === pair.b ? w : undefined)
  const f = valid(votes.get(pair.forward))
  const s = valid(votes.get(pair.swapped))
  if (!f && !s) return { kind: 'none' }
  if (f && s && f === s) return { kind: 'win', winner: f, loser: f === pair.a ? pair.b : pair.a }
  return { kind: 'draw' }
}

export function computeElo(
  keys: readonly string[],
  pairs: readonly IdeaPair[],
  votes: ReadonlyMap<string, string>,
  opts: { start?: number; k?: number } = {},
): Map<string, EloRecord> {
  const start = opts.start ?? ELO_START
  const k = opts.k ?? ELO_K
  const table = new Map<string, EloRecord>(keys.map((key) => [key, { elo: start, wins: 0, losses: 0, draws: 0 }]))
  for (const pair of pairs) {
    const a = table.get(pair.a)
    const b = table.get(pair.b)
    if (!a || !b) continue
    const outcome = pairOutcome(pair, votes)
    if (outcome.kind === 'none') continue
    const scoreA = outcome.kind === 'draw' ? 0.5 : outcome.winner === pair.a ? 1 : 0
    const [ra, rb] = updateElo(a.elo, b.elo, scoreA, k)
    a.elo = ra
    b.elo = rb
    if (outcome.kind === 'draw') {
      a.draws++
      b.draws++
    } else if (scoreA === 1) {
      a.wins++
      b.losses++
    } else {
      b.wins++
      a.losses++
    }
  }
  return table
}
