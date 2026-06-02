// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C2) — pure citation helpers.
//
// Lives separately from chat-retrieval.ts so unit tests can exercise the
// regex + intersection logic without booting the DB driver (which the
// retrieval module pulls transitively via @/lib/db).
// ─────────────────────────────────────────────────────────────────────────

// Match [[uuid]] tokens in assistant text. Permissive on variant/version
// bits — older rows may not be strict UUIDv4, and the intersection guard
// downstream already guarantees the id maps to a real retrieved memory.
// Factory rather than a const so each `.exec()` / `.test()` caller gets a
// fresh regex with a clean lastIndex. `matchAll()` is safe either way.
export function citationTokenRegex(): RegExp {
  return /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi
}

// Returns the set of memory ids cited inline, in order of first appearance.
// The model can hallucinate markers, so the caller should intersect this
// set with the ids that were actually retrieved before persisting.
export function extractCitationIds(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(citationTokenRegex())) {
    const id = m[1].toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export interface CitationRetrievalShape {
  cortex: { id: string } | null
  archetypes: Array<{ id: string }>
  substrate: Array<{ id: string }>
}

export function intersectWithRetrieved(
  cited: string[],
  retrieval: CitationRetrievalShape,
): string[] {
  const retrievedIds = new Set<string>()
  if (retrieval.cortex) retrievedIds.add(retrieval.cortex.id.toLowerCase())
  for (const a of retrieval.archetypes) retrievedIds.add(a.id.toLowerCase())
  for (const s of retrieval.substrate) retrievedIds.add(s.id.toLowerCase())
  return cited.filter((id) => retrievedIds.has(id))
}
