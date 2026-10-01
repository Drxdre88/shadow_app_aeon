import { listSurvivorEmbeddingsBetween } from '@/lib/data/ideas'
import { cosineSimilarity } from '@/lib/kairos/autofile'
import { DIVERSITY_ALARM_DISTANCE } from './types'

// Weekly idea diversity (docs/kairos/35): mean pairwise cosine DISTANCE of the
// survivors' embeddings. A collapse (every night's survivors saying the same
// thing) shows as a low mean; below DIVERSITY_ALARM_DISTANCE with ≥ 3
// survivors raises the alarm for the weekly review / daily message.

const DAY_MS = 86_400_000
export const DIVERSITY_WINDOW_DAYS = 7
export const DIVERSITY_MIN_SURVIVORS = 3

function norm(v: readonly number[]): number {
  let s = 0
  for (const x of v) s += x * x
  return Math.sqrt(s)
}

// Mean of (1 − cosine) over every unordered pair. Pairs involving a zero or
// non-finite vector are skipped (cosine is undefined); null when fewer than
// two vectors or no valid pair remains.
export function meanPairwiseCosineDistance(embeddings: number[][]): number | null {
  const valid = embeddings.filter((v) => v.length > 0 && v.every(Number.isFinite) && norm(v) > 0)
  if (valid.length < 2) return null
  let sum = 0
  let pairs = 0
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      sum += 1 - cosineSimilarity(valid[i], valid[j])
      pairs++
    }
  }
  return pairs > 0 ? sum / pairs : null
}

export interface WeeklyIdeaDiversity {
  survivors: number
  meanDistance: number | null
  alarm: boolean
  // UTC date (YYYY-MM-DD) the trailing window starts on.
  weekStart: string
}

// Window: the TRAILING 7 days [now − 7d, now), not the ISO calendar week, so a
// reading on any weekday covers a full week of nights (an ISO week read on a
// Monday would hold one night). `survivors` counts rows with a stored
// embedding; un-embedded survivors can't be measured.
export async function weeklyIdeaDiversity(userId: string, now: Date = new Date()): Promise<WeeklyIdeaDiversity> {
  const from = new Date(now.getTime() - DIVERSITY_WINDOW_DAYS * DAY_MS)
  const rows = await listSurvivorEmbeddingsBetween(userId, from, now)
  const meanDistance = meanPairwiseCosineDistance(rows.map((r) => r.embedding))
  return {
    survivors: rows.length,
    meanDistance,
    alarm: rows.length >= DIVERSITY_MIN_SURVIVORS && meanDistance !== null && meanDistance < DIVERSITY_ALARM_DISTANCE,
    weekStart: from.toISOString().slice(0, 10),
  }
}
