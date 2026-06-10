// ─────────────────────────────────────────────────────────────────────────
// Consolidation — pure helpers for the memory dedup pass. No DB, unit-testable.
//
// Dedup collapses near-duplicate memories by superseding the redundant rows
// against one canonical (stamp superseded_at/by — never delete). This file
// holds only the decisions: which types are safe to auto-merge, how duplicate
// pairs cluster, and which row survives. The DB plumbing lives in
// lib/data/memories.ts (dedupMemories).
// ─────────────────────────────────────────────────────────────────────────

// Cosine similarity at/above which two memories count as near-duplicates.
// High by design — we only merge things that are genuinely the same capture,
// not merely related.
export const DEFAULT_DEDUP_THRESHOLD = 0.97

// Machine-generated, high-redundancy types that are safe to merge autonomously.
// Operator-authored types (note/decision/idea/reflection/fact…) are deliberately
// EXCLUDED — those must go through a propose-not-commit pass, never silent merge.
// `snapshot` is also excluded: a daily snapshot series is a time-series, not a
// duplicate set, and belongs to the snapshot-rollup pass, not dedup.
export const AUTO_DEDUP_TYPES = ['session_event'] as const

export type DedupCandidate = {
  id: string
  pinned: boolean
  confidence: number | null
  createdAt: Date
}

// Union-find over duplicate pairs → connected-component clusters. A transitive
// chain (A~B, B~C) collapses into one cluster {A,B,C}. Singletons are dropped.
export function buildClusters(pairs: Array<[string, string]>): string[][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b))
  }
  for (const [a, b] of pairs) union(a, b)

  const groups = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(id)
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

// Pick the survivor of a duplicate cluster: pinned wins, then highest
// confidence, then newest. Returns the canonical id + the rows to supersede.
export function pickCanonical(cluster: DedupCandidate[]): {
  canonicalId: string
  loserIds: string[]
} {
  const sorted = [...cluster].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const ac = a.confidence ?? 0
    const bc = b.confidence ?? 0
    if (ac !== bc) return bc - ac
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
  const [canonical, ...losers] = sorted
  return { canonicalId: canonical.id, loserIds: losers.map((l) => l.id) }
}
