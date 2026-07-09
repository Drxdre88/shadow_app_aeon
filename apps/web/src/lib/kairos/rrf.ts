// Reciprocal Rank Fusion (Cormack et al.) — fuse N ranked id lists in rank
// space. Score-scale-agnostic: only positions matter, so FTS ts_rank and
// vector cosine never need to be normalised against each other. k=60 is the
// literature default. Per-list weights bias one signal without breaking RRF.
export const RRF_K = 60

export function rrfFuse(lists: Array<{ ids: string[]; weight: number }>, k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>()
  for (const { ids, weight } of lists) {
    ids.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + rank + 1))
    })
  }
  return scores
}
