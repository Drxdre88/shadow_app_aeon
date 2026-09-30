// ─────────────────────────────────────────────────────────────────────────
// Shared retrieval ranker (docs/kairos/32 §1) — ONE formula for both ranking
// stacks: prepareContext (lib/data/memories.ts) and the Kairos substrate
// (lib/kairos/retrieve.ts, pre-rerank pool AND post-rerank blend).
//
//   final rank = relevance × standingFactor
//
// standingFactor:
//   - scored row (standing != null): 0.5 + standing (0.5..1.5). The engine's
//     standing already folds trust, freshness, usage, support and outcome, so
//     nothing else is multiplied in.
//   - unscored row (standing NULL, i.e. every row before the first engine
//     run): confidenceBoost × recencyMultiplier — exactly the P0 composite, so
//     retrieval is unchanged until the engine scores a row.
// ─────────────────────────────────────────────────────────────────────────

import { recencyMultiplier } from '@/lib/data/memories'
import { confidenceBoost } from './confidence'

export interface RankableRow {
  standing?: number | null
  confidence?: number | null
  updatedAt?: Date | null
  createdAt?: Date | null
  pinned?: boolean | null
}

export const STANDING_OFFSET = 0.5

export function standingFactor(row: RankableRow, now: number = Date.now()): number {
  const standing = row.standing
  if (standing != null && Number.isFinite(standing)) return STANDING_OFFSET + standing
  return (
    confidenceBoost({ confidence: row.confidence, updatedAt: row.updatedAt, pinned: row.pinned }, now)
    * recencyMultiplier(row.createdAt, now)
  )
}

export function rankScore(relevance: number, row: RankableRow, now: number = Date.now()): number {
  return (Number(relevance) || 0) * standingFactor(row, now)
}

export interface RankOptions<T> {
  now?: number
  // Hard partition applied BEFORE score: higher tier always ranks first.
  tier?: (row: T) => number
  // Applied only on exact score ties: higher wins. Remaining ties keep input
  // order (stable sort).
  tieBreak?: (row: T) => number
}

export interface Ranked<T> {
  row: T
  score: number
}

export function scoreRows<T extends RankableRow>(
  rows: readonly T[],
  relevanceOf: (row: T) => number,
  opts: RankOptions<T> = {},
): Ranked<T>[] {
  const now = opts.now ?? Date.now()
  const { tier, tieBreak } = opts
  return rows
    .map((row) => ({
      row,
      score: rankScore(relevanceOf(row), row, now),
      tier: tier ? tier(row) : 0,
      tie: tieBreak ? tieBreak(row) : 0,
    }))
    .sort((a, b) => b.tier - a.tier || b.score - a.score || b.tie - a.tie)
    .map(({ row, score }) => ({ row, score }))
}

export function rankRows<T extends RankableRow>(
  rows: readonly T[],
  relevanceOf: (row: T) => number,
  opts: RankOptions<T> = {},
): T[] {
  return scoreRows(rows, relevanceOf, opts).map((r) => r.row)
}
