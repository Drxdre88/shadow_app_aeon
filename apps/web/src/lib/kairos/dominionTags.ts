// ─────────────────────────────────────────────────────────────────────────
// Soft, many-to-many Dominion association via tags.
//
// A memory has ONE home Dominion (the dominionId FK — nullable, may be the
// resolution fallback) AND can be *referenced* by any number of Dominions
// whose id appears as a `dominion:<uuid>` tag. Read paths union both, so a
// cross-front reflection (e.g. distilled from a dialogue that spanned Swarm +
// Shadow Lab) surfaces from every Dominion it touches without being *owned*
// by one. This is fluid grouping over rigid pinning.
//
// The tag encodes the Dominion *id*, never the name — a rename never drifts
// the link. It is a soft pointer with no referential integrity (consistent
// with memories.supersededById): a deleted Dominion may leave a dangling tag;
// readers simply don't resolve it, and a delete hook can strip it later.
// ─────────────────────────────────────────────────────────────────────────

export const DOMINION_TAG_PREFIX = 'dominion:'

/** Encode a Dominion id as a soft-association tag. */
export const dominionTag = (id: string): string => `${DOMINION_TAG_PREFIX}${id}`

/** Pull the Dominion ids referenced by a memory's tags (ignores other tags). */
export function dominionIdsFromTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags
    .filter((t): t is string => typeof t === 'string' && t.startsWith(DOMINION_TAG_PREFIX))
    .map((t) => t.slice(DOMINION_TAG_PREFIX.length))
}
