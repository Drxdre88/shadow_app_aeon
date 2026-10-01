import {
  NOVELTY_BORDERLINE_COSINE,
  NOVELTY_REPEAT_COSINE,
  type NoveltyClass,
  type NoveltyResult,
} from './types'

// Novelty gate (docs/kairos/35). A candidate's max cosine to the idea archive,
// pending proposals and held beliefs (lib/data/ideas findNearestIdeaNeighbours)
// decides its class: ≥ NOVELTY_REPEAT_COSINE → repeat (dropped);
// [NOVELTY_BORDERLINE_COSINE, REPEAT) → borderline (the judge is asked
// "meaningfully different?"); below → novel. No neighbours → novel at 0.

export interface NoveltyNeighbour {
  id: string
  kind: 'idea' | 'proposal' | 'belief'
  similarity: number
}

export function noveltyClassFor(maxCosine: number): NoveltyClass {
  if (maxCosine >= NOVELTY_REPEAT_COSINE) return 'repeat'
  if (maxCosine >= NOVELTY_BORDERLINE_COSINE) return 'borderline'
  return 'novel'
}

// Order-independent: takes the max, not the first. Non-finite similarities
// are ignored.
export function classifyNovelty(neighbours: readonly NoveltyNeighbour[]): NoveltyResult {
  let nearest: NoveltyNeighbour | null = null
  for (const n of neighbours) {
    if (!Number.isFinite(n.similarity)) continue
    if (!nearest || n.similarity > nearest.similarity) nearest = n
  }
  if (!nearest) return { class: 'novel', maxCosine: 0, nearestId: null, nearestKind: null }
  return {
    class: noveltyClassFor(nearest.similarity),
    maxCosine: nearest.similarity,
    nearestId: nearest.id,
    nearestKind: nearest.kind,
  }
}
