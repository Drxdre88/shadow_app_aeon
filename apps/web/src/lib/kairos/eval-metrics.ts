/**
 * Pure scoring functions for retrieval evaluation.
 * No I/O, no DB — safe to unit-test in isolation.
 *
 * All functions accept:
 *   retrievedIds  — ordered list of IDs returned by the retrieval system (rank 0 = best)
 *   relevantIds   — set of IDs that are ground-truth relevant for the query
 *   k             — cutoff depth (default 10)
 */

/** Fraction of relevant docs found in the top-k results. */
export function recallAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k = 10,
): number {
  if (relevantIds.length === 0) return 0
  const topK = new Set(retrievedIds.slice(0, k))
  const hits = relevantIds.filter((id) => topK.has(id)).length
  return hits / relevantIds.length
}

/** Fraction of top-k results that are relevant. */
export function precisionAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k = 10,
): number {
  if (k === 0) return 0
  const topK = retrievedIds.slice(0, k)
  if (topK.length === 0) return 0
  const relevantSet = new Set(relevantIds)
  const hits = topK.filter((id) => relevantSet.has(id)).length
  return hits / topK.length
}

/**
 * Reciprocal Rank — 1 / rank of the first relevant hit (1-indexed).
 * Returns 0 if no relevant doc appears in the list.
 */
export function reciprocalRank(
  retrievedIds: string[],
  relevantIds: string[],
): number {
  const relevantSet = new Set(relevantIds)
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) return 1 / (i + 1)
  }
  return 0
}

/** Mean Reciprocal Rank over multiple queries. */
export function mrr(perQueryRR: number[]): number {
  if (perQueryRR.length === 0) return 0
  return perQueryRR.reduce((s, v) => s + v, 0) / perQueryRR.length
}

/** Fraction of queries with at least one relevant result in top-k. */
export function hitRate(retrievedIdsList: string[][], relevantIdsList: string[][], k = 10): number {
  if (retrievedIdsList.length === 0) return 0
  const hits = retrievedIdsList.filter((retrieved, i) => {
    const topK = new Set(retrieved.slice(0, k))
    return (relevantIdsList[i] ?? []).some((id) => topK.has(id))
  }).length
  return hits / retrievedIdsList.length
}
