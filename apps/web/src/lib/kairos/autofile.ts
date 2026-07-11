// ─────────────────────────────────────────────────────────────────────────
// JARVIS chat slice 2 — content-based Dominion auto-filing at capture.
//
// When a memory arrives with no structural Dominion (no explicit id, no
// project→dominion, no repo→dominion), we embed its text and cosine-match it
// against each Dominion's LIVE cortex embedding — the cortex doc doubles as
// the Dominion's semantic centroid, so there is no separate centroid table to
// maintain. The nearest Dominion above the similarity floor becomes the home
// Dominion; below it the memory stays unfiled — misfiling is worse than not
// filing. Embedding-similarity only (no LLM): provider routing is keyed on a
// Dominion's BYOK credential, which doesn't exist before a Dominion is known.
//
// Pure helpers live here; the pgvector query is classifyDominionByContent in
// lib/data/memories.ts, wired inside createMemory.
// ─────────────────────────────────────────────────────────────────────────

import type { StreamClass } from './streamClass'

// Streams that may be auto-filed by content. Machine-synthesis streams are
// excluded on purpose: their writers always stamp a Dominion explicitly, or
// omit it BY DESIGN (aether is the global self-model; snapshots/traces are
// bookkeeping) — content-matching those would misfile them into whichever
// Dominion they happen to mention.
export const AUTO_FILE_STREAMS: ReadonlySet<StreamClass> = new Set([
  'idea',
  'reflection',
  'execution',
  'agentic',
] as const)

export function autoFileEligible(streamClass: StreamClass): boolean {
  return AUTO_FILE_STREAMS.has(streamClass)
}

// Cosine-similarity floor for assignment (doc↔doc, same shape as the
// backfill corpus). Corpus-dependent — tune on real data via env without a
// deploy. Clamped so a fat-fingered env value can't file everything (too low)
// or nothing (too high).
export const DEFAULT_AUTO_FILE_MIN_SIM = 0.55

export function autoFileMinSim(): number {
  const raw = Number(process.env.KAIROS_AUTO_FILE_MIN_SIM)
  if (!Number.isFinite(raw)) return DEFAULT_AUTO_FILE_MIN_SIM
  return Math.min(Math.max(raw, 0.3), 0.95)
}

// Same text shape as backfillEmbeddings embeds ('document': title + summary +
// body) so the capture-time vector is corpus-consistent and safe to store on
// the row.
export function autoFileText(title: string, summary: string | null | undefined, bodyMd: string): string {
  return [title, summary ?? '', bodyMd].filter(Boolean).join('\n\n')
}

// Exact cosine for the in-process classify scan. The live-cortex candidate set
// is ≤ #Dominions (tiny), and an exact scan sidesteps HNSW post-filter misses
// on a subset that sparse — the index's ~ef_search nearest neighbours across
// the whole corpus rarely include the handful of cortex rows.
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
