// Pure scoring maths for the retrieval eval (no I/O; unit-tested by eval-metrics.test.mjs).

export const CATEGORIES = ['single_fact', 'knowledge_update', 'temporal', 'multi_session', 'entity', 'big_picture', 'abstention']

// How a hit reached the ranked list; a missing `via` means plain search.
export const VIAS = ['search', 'link', 'signpost']

export function recallAtK(ranked, relevant, k) {
  if (!relevant.length) return null
  const top = new Set(ranked.slice(0, k))
  return relevant.filter((id) => top.has(id)).length / relevant.length
}

export function hitAtK(ranked, relevant, k) {
  if (!relevant.length) return null
  const rel = new Set(relevant)
  return ranked.slice(0, k).some((id) => rel.has(id)) ? 1 : 0
}

export function reciprocalRank(ranked, relevant) {
  if (!relevant.length) return null
  const rel = new Set(relevant)
  const i = ranked.findIndex((id) => rel.has(id))
  return i === -1 ? 0 : 1 / (i + 1)
}

export function firstRelevantRank(ranked, relevant) {
  const rel = new Set(relevant)
  const i = ranked.findIndex((id) => rel.has(id))
  return i === -1 ? null : i + 1
}

// 1 when a must-not (stale) id appears in the top k above the first relevant id (or with no relevant id at all).
export function staleAbove(ranked, relevant, mustNot, k) {
  if (!mustNot?.length) return null
  const top = ranked.slice(0, k)
  const firstRel = firstRelevantRank(top, relevant) ?? Infinity
  const stale = new Set(mustNot)
  return top.some((id, i) => stale.has(id) && i + 1 < firstRel) ? 1 : 0
}

// Abstention: pass when the path returns no candidate answer in its top k ('empty'), or when the endpoint flags
// its best match as weak (retrieval.lowConfidence === true → 'lowConfidence'). `candidates` must already exclude
// always-on context (pinned rows) so only query-driven results count as a confident answer.
export function abstentionRule(candidates, k, lowConfidence) {
  if (candidates.slice(0, k).length === 0) return 'empty'
  if (lowConfidence === true) return 'lowConfidence'
  return null
}

export function abstentionPass(candidates, k, lowConfidence) {
  return abstentionRule(candidates, k, lowConfidence) ? 1 : 0
}

// Counts relevant ids in the top k by how they arrived (via[i] aligns with ranked[i]; absent → 'search').
export function relevantVia(ranked, via, relevant, k) {
  const rel = new Set(relevant)
  const out = { search: 0, link: 0, signpost: 0 }
  ranked.slice(0, k).forEach((id, i) => {
    if (!rel.has(id)) return
    const v = VIAS.includes(via?.[i]) ? via[i] : 'search'
    out[v]++
  })
  return out
}

export function scoreQuestion(fixture, ranked, candidates, { lowConfidence, via } = {}) {
  const relevant = fixture.relevantIds ?? []
  if (fixture.category === 'abstention' || relevant.length === 0) {
    const rule = abstentionRule(candidates, 10, lowConfidence)
    return { abstain: rule ? 1 : 0, abstainRule: rule, falseHits: Math.min(candidates.length, 10) }
  }
  return {
    recall5: recallAtK(ranked, relevant, 5),
    recall10: recallAtK(ranked, relevant, 10),
    rr: reciprocalRank(ranked, relevant),
    hit1: hitAtK(ranked, relevant, 1),
    hit5: hitAtK(ranked, relevant, 5),
    hit10: hitAtK(ranked, relevant, 10),
    firstRank: firstRelevantRank(ranked, relevant),
    stale: staleAbove(ranked, relevant, fixture.mustNotIds, 10),
    lowConfidence: lowConfidence === true ? 1 : lowConfidence === false ? 0 : null,
    via: relevantVia(ranked, via, relevant, 10),
  }
}

function sumVia(rows) {
  const out = { search: 0, link: 0, signpost: 0 }
  for (const r of rows) for (const v of VIAS) out[v] += r.score.via?.[v] ?? 0
  return out
}

function mean(values) {
  const v = values.filter((x) => x !== null && x !== undefined)
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}

export function aggregate(rows) {
  const answerable = rows.filter((r) => r.score && r.score.abstain === undefined)
  const abstain = rows.filter((r) => r.score && r.score.abstain !== undefined)
  return {
    n: answerable.length,
    recall5: mean(answerable.map((r) => r.score.recall5)),
    recall10: mean(answerable.map((r) => r.score.recall10)),
    mrr: mean(answerable.map((r) => r.score.rr)),
    hit1: mean(answerable.map((r) => r.score.hit1)),
    hit5: mean(answerable.map((r) => r.score.hit5)),
    hit10: mean(answerable.map((r) => r.score.hit10)),
    staleAbove: mean(answerable.map((r) => r.score.stale)),
    lowConfidenceAnswerable: mean(answerable.map((r) => r.score.lowConfidence)),
    relevantVia: sumVia(answerable),
    abstainN: abstain.length,
    abstainPass: mean(abstain.map((r) => r.score.abstain)),
    abstainByRule: {
      empty: abstain.filter((r) => r.score.abstainRule === 'empty').length,
      lowConfidence: abstain.filter((r) => r.score.abstainRule === 'lowConfidence').length,
    },
    errors: rows.filter((r) => r.error).length,
  }
}

export function aggregateByCategory(rows) {
  const out = {}
  for (const c of CATEGORIES) {
    const sub = rows.filter((r) => r.category === c)
    if (sub.length) out[c] = aggregate(sub)
  }
  return out
}
