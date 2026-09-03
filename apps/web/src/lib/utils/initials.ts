/**
 * Display initials for a person's name — first letter of the first two words.
 *
 * This is the CLIENT-side avatar helper. It is deliberately separate from
 * `deriveInitials` in `lib/data/virtual-members.ts`, which is DB-authoritative
 * (persisted into a varchar(4) column) and must not change shape to suit a UI.
 *
 * Splits on code points rather than UTF-16 code units, so a name whose first
 * character is an emoji or an astral-plane CJK glyph renders as that glyph
 * instead of a lone surrogate (the classic "" box).
 */
export function getInitials(name: string | null | undefined, fallback = '?'): string {
  const seed = (name ?? '').trim()
  if (!seed) return fallback
  const initials = seed
    .split(/\s+/)
    .map((word) => [...word][0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return initials || ([...seed][0]?.toUpperCase() ?? fallback)
}

/**
 * Initials for someone we only have an email address for.
 *
 * A magic-link signup never carries a name — only OAuth providers hand one over
 * — so name-only initials leave those people rendering as '?'. The local part is
 * the one other thing we know, and its separators are word boundaries:
 * `john.smith` -> JS, `marcelpie0` -> M. Returns '' (not the '?' fallback) so a
 * caller can keep walking its own chain.
 */
export function getInitialsFromEmail(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0]
  if (!local) return ''
  return getInitials(local.split(/[._\-+]+/).filter(Boolean).join(' '), '')
}
