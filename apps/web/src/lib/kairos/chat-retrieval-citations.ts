// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C2) — pure citation helpers.
//
// Lives separately from chat-retrieval.ts so unit tests can exercise the
// regex + intersection logic without booting the DB driver (which the
// retrieval module pulls transitively via @/lib/db).
// ─────────────────────────────────────────────────────────────────────────

// Match [[uuid]] tokens in assistant text. We accept any 8-4-4-4-12 hex
// shape — older rows or non-`gen_random_uuid()`-inserted ids may not be
// strict UUIDv4, and the intersection check downstream already guarantees
// the id maps to a real retrieved memory, so strict variant/version bits
// would just suppress legitimate chips.
const CITATION_RE = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi

// Returns the set of memory ids cited inline, in order of first appearance.
// The model can hallucinate markers, so the caller should intersect this
// set with the ids that were actually retrieved before persisting.
export function extractCitationIds(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(CITATION_RE)) {
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
