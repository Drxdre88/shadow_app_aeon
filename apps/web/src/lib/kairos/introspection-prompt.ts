import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────
// Shared id grounding for every generator that copies memory ids from its
// prompt (archetypes, cortex, concepts, beliefs, mind compare, weekly
// review). The raw introspection generator that used to live here was
// retired in Kairos 0.17 (superseded by the nightly idea tournament); only
// these helpers remain, under the old path its callers import.
// ─────────────────────────────────────────────────────────────────────────

// Citations arrive messy on bad nights: shortened to an 8-char prefix, wrapped
// in brackets, a bare string, nulls, or the array omitted entirely (2026-07-24
// Shadow Apps trace: all 5 proposals lost the field, and .uuid()/.min(1) turned
// that into a whole-night kill). Grounding is enforced against the actual fed
// substrate (makeFedIdResolver) — the schema only needs shape.
export const fedIdListSchema = (max: number) => z.preprocess(
  (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []),
  z.array(z.string()).transform((a) => a.slice(0, max)),
)

// Models cite ids as "[3b11ff33]", "mem:<uuid>" or a bare prefix despite the
// full-id rule. Strip decoration and lowercase so an honest-but-messy citation
// still gets a chance to resolve against the substrate.
function normaliseCitationId(raw: string): string {
  return raw.trim().replace(/^[[`'"]+|[\]`'"]+$/g, '').trim().replace(/^mem:/i, '').toLowerCase()
}

// An id resolves by exact (case-insensitive) match, or by a UNIQUE prefix of
// ≥8 chars (models shorten uuids to their first block). Anything else —
// null, invented, ambiguous — resolves to null and is dropped by the caller.
// Always returns the canonical fed id, never the model's spelling.
export function makeFedIdResolver(validIds: Iterable<string>): (raw: unknown) => string | null {
  const byLower = new Map<string, string>()
  for (const id of validIds) byLower.set(id.toLowerCase(), id)
  const lowered = [...byLower.keys()]
  return (raw) => {
    if (typeof raw !== 'string') return null
    const c = normaliseCitationId(raw)
    const exact = byLower.get(c)
    if (exact) return exact
    if (/^[0-9a-f][0-9a-f-]{7,}$/.test(c)) {
      const matches = lowered.filter((id) => id.startsWith(c))
      if (matches.length === 1) return byLower.get(matches[0]) ?? null
    }
    return null
  }
}