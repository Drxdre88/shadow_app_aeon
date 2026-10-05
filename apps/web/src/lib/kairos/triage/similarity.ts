// Deterministic duplicate pre-filter for card sorting: a cheap title (and a
// little description) similarity so the prompt only carries the few existing
// cards worth comparing. No model, no embeddings, no network.

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'in', 'into', 'is', 'it',
  'of', 'on', 'or', 'our', 'so', 'the', 'to', 'up', 'we', 'with', 'new', 'add', 'make', 'get', 'set',
])

export interface SimilarityCard {
  id: string
  name: string
  description?: string | null
}

export interface ScoredCandidate<T extends SimilarityCard> {
  card: T
  score: number
}

export const DUPLICATE_MIN_SCORE = 0.3
export const DUPLICATE_MAX_CANDIDATES = 5

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function wordTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of normalise(text).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue
    out.add(stem(raw))
  }
  return out
}

function trigrams(text: string): Set<string> {
  const flat = ` ${normalise(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= flat.length; i++) out.add(flat.slice(i, i + 3))
  return out
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return (2 * shared) / (a.size + b.size)
}

const DESCRIPTION_CHARS = 300

// 0..1: mostly title words, then title character shape, then title + notes.
export function cardSimilarity(a: SimilarityCard, b: SimilarityCard): number {
  const titleWords = dice(wordTokens(a.name), wordTokens(b.name))
  const titleShape = dice(trigrams(a.name), trigrams(b.name))
  const body = (c: SimilarityCard) => `${c.name} ${(c.description ?? '').slice(0, DESCRIPTION_CHARS)}`
  const withNotes = dice(wordTokens(body(a)), wordTokens(body(b)))
  return 0.6 * titleWords + 0.25 * titleShape + 0.15 * withNotes
}

// The closest existing cards to `card`, best first, never the card itself.
export function pickDuplicateCandidates<T extends SimilarityCard>(
  card: SimilarityCard,
  pool: readonly T[],
  opts: { limit?: number; minScore?: number } = {},
): ScoredCandidate<T>[] {
  const limit = opts.limit ?? DUPLICATE_MAX_CANDIDATES
  const minScore = opts.minScore ?? DUPLICATE_MIN_SCORE
  return pool
    .filter((other) => other.id !== card.id)
    .map((other) => ({ card: other, score: cardSimilarity(card, other) }))
    .filter((s) => s.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
}
