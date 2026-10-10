// Pure text rules for the entity map (Total Recall step 2a, decision c695afe6).
// Shared by the seed, the dictionary scan and the search entity list.

// Real words that are also repo/Dominion names: they count only when written
// with a capital first letter, in memory text and in search queries alike.
export const CAPITALISED_ONLY = new Set([
  'rift', 'triad', 'relic', 'swarm', 'visor', 'hydra', 'covenant', 'pulse',
  'hive', 'aether', 'vault', 'atlas', 'signal', 'echo', 'forge',
])

// Too generic to ever be an alias.
export const GENERIC_ALIASES = new Set(['data', 'dev', 'lab', 'core', 'app', 'web', 'api'])

export const REPO_PREFIXES = ['shadow_app_', 'stp_app_', 'shadow_', 'stp_'] as const

const MIN_STEM_ALIAS = 4
const EDGE_PUNCT = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

// lowercase, trim, collapse whitespace, strip punctuation at both ends.
export function normAlias(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(EDGE_PUNCT, '')
}

export function isUsableAlias(norm: string): boolean {
  return norm.length > 0 && !GENERIC_ALIASES.has(norm)
}

// sourceMetadata.repo may be a path (`sefe/Short Term Power/stp_app_ermac`).
export function lastRepoSegment(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const parts = raw.split(/[\\/]/).map((p) => p.trim()).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : null
}

export function repoSlugForm(raw: string): string {
  return normAlias(raw).replace(/-/g, '_')
}

// The slug with a known prefix removed (any length); null when nothing stripped.
function strippedStem(slug: string): string | null {
  for (const p of REPO_PREFIXES) if (slug.startsWith(p) && slug.length > p.length) return slug.slice(p.length)
  return null
}

// Grouping key: shadow_app_aeon and repo:aeon are one repo; shadow-data keeps
// its prefix because "data" alone is generic.
export function repoKey(raw: string): string {
  const slug = repoSlugForm(raw)
  const stem = strippedStem(slug)
  return stem && !GENERIC_ALIASES.has(stem) ? stem : slug
}

// The stripped form becomes an alias only when long and specific enough.
export function repoStemAlias(raw: string): string | null {
  const stem = strippedStem(repoSlugForm(raw))
  return stem && stem.length >= MIN_STEM_ALIAS && !GENERIC_ALIASES.has(stem) ? stem : null
}

// Alias spellings a repo slug contributes: `_` and `-` forms plus the stem.
export function repoSlugAliases(raw: string): string[] {
  const slug = repoSlugForm(raw)
  const stem = repoStemAlias(raw)
  const out = [slug, slug.replace(/_/g, '-')]
  if (stem) out.push(stem, stem.replace(/_/g, '-'))
  return [...new Set(out)]
}

export function displayRepoName(key: string): string {
  return /^[a-z][a-z0-9]*$/.test(key) ? key[0].toUpperCase() + key.slice(1) : key
}

export type AliasRule = 'exact' | 'capitalised' | 'any'

// exact: under 3 chars (initials) must match case-sensitively.
// capitalised: stoplisted words and single-word person names.
export function aliasRule(alias: string, kind: string): AliasRule {
  const norm = normAlias(alias)
  if (norm.length < 3) return 'exact'
  if (CAPITALISED_ONLY.has(norm)) return 'capitalised'
  if (kind === 'person' && !norm.includes(' ')) return 'capitalised'
  return 'any'
}

export function passesRule(rule: AliasRule, alias: string, found: string): boolean {
  if (rule === 'exact') return found === alias.trim()
  if (rule === 'capitalised') {
    const first = found.charAt(0)
    return first !== first.toLowerCase() && first === first.toUpperCase()
  }
  return true
}
