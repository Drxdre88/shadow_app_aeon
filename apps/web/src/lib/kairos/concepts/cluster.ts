// Concept tier clustering (docs/kairos/26 §4, docs/kairos/32 §2.4). Pure — no
// DB, no model. Greedy agglomerative over cosine with COMPLETE linkage: two
// clusters merge only when every cross pair clears the threshold, so every pair
// inside a cluster is guaranteed ≥ threshold (no single-link chaining that
// glues unrelated ideas together through one bridge memory).

export const CONCEPT_SIM_THRESHOLD = 0.82
export const CONCEPT_MIN_SIZE = 4
export const CONCEPT_MAX_SIZE = 12
export const CONCEPT_MATCH_MIN_OVERLAP = 0.6

export interface ClusterItem {
  id: string
  embedding: readonly number[]
}

export interface ClusterOptions {
  threshold?: number
  minSize?: number
  maxSize?: number
}

function normalise(v: readonly number[]): Float64Array {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  const out = new Float64Array(v.length)
  if (norm === 0) return out
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

function dot(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  return dot(normalise(a), normalise(b))
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Returns clusters as arrays of ids (each sorted ascending), ordered by size
// desc then first id. Input order is irrelevant: items are de-duplicated and
// sorted by id first, and equal similarities break on index pair, so the same
// set of items always yields the same clusters.
export function clusterByCosine(items: readonly ClusterItem[], opts: ClusterOptions = {}): string[][] {
  const threshold = opts.threshold ?? CONCEPT_SIM_THRESHOLD
  const minSize = Math.max(1, opts.minSize ?? CONCEPT_MIN_SIZE)
  const maxSize = Math.max(minSize, opts.maxSize ?? CONCEPT_MAX_SIZE)

  const byId = new Map<string, ClusterItem>()
  for (const it of items) if (!byId.has(it.id) && it.embedding.length > 0) byId.set(it.id, it)
  const ids = [...byId.keys()].sort(byString)
  const n = ids.length
  if (n < minSize) return []

  const vecs = ids.map((id) => normalise(byId.get(id)!.embedding))
  const sim = new Float64Array(n * n)
  const edges: Array<[number, number, number]> = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = dot(vecs[i], vecs[j])
      sim[i * n + j] = s
      sim[j * n + i] = s
      if (s >= threshold) edges.push([s, i, j])
    }
  }
  edges.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2])

  const owner = new Int32Array(n)
  const members = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    owner[i] = i
    members.set(i, [i])
  }

  for (const [, i, j] of edges) {
    const ci = owner[i]
    const cj = owner[j]
    if (ci === cj) continue
    const a = members.get(ci)!
    const b = members.get(cj)!
    if (a.length + b.length > maxSize) continue
    let complete = true
    for (const x of a) {
      for (const y of b) {
        if (sim[x * n + y] < threshold) { complete = false; break }
      }
      if (!complete) break
    }
    if (!complete) continue
    const [keep, drop] = ci < cj ? [ci, cj] : [cj, ci]
    const dropped = members.get(drop)!
    for (const m of dropped) owner[m] = keep
    members.set(keep, [...members.get(keep)!, ...dropped])
    members.delete(drop)
  }

  return [...members.values()]
    .filter((m) => m.length >= minSize)
    .map((m) => m.map((i) => ids[i]).sort(byString))
    .sort((a, b) => b.length - a.length || byString(a[0], b[0]))
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size === 0 && sb.size === 0) return 0
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / (sa.size + sb.size - inter)
}

export interface ExistingConceptRef {
  id: string
  memberIds: readonly string[]
}

// Best existing concept by member-set Jaccard, when it clears minOverlap.
// Ties break on id so re-runs pick the same target.
export function matchExistingConcept(
  memberIds: readonly string[],
  existing: readonly ExistingConceptRef[],
  minOverlap = CONCEPT_MATCH_MIN_OVERLAP,
): { id: string; overlap: number } | null {
  let best: { id: string; overlap: number } | null = null
  for (const c of existing) {
    const overlap = jaccard(memberIds, c.memberIds)
    if (overlap < minOverlap) continue
    if (!best || overlap > best.overlap || (overlap === best.overlap && c.id < best.id)) {
      best = { id: c.id, overlap }
    }
  }
  return best
}
