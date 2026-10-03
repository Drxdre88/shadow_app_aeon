// Dream fingerprints: hashes of 8-word shingles of the dream text, minus every
// shingle that already appears in what the model was shown. What is left is
// wording the dream invented, so a later memory sharing ≥2 of them echoes the
// dream (the conscience laundering probe). Pure and environment-free so the
// audit side can hash new memories the same way.
export const SHINGLE_WORDS = 8
export const MAX_FINGERPRINTS = 64

export function fnv1a32(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function hashShingle(shingle: string): string {
  const a = fnv1a32(shingle).toString(16).padStart(8, '0')
  const b = fnv1a32(shingle, 0x9747b28c).toString(16).padStart(8, '0')
  return `${a}${b}`
}

export function shingleWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function shingleHashes(text: string, size = SHINGLE_WORDS): string[] {
  const words = shingleWords(text)
  const out: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i + size <= words.length; i++) {
    const h = hashShingle(words.slice(i, i + size).join(' '))
    if (!seen.has(h)) {
      seen.add(h)
      out.push(h)
    }
  }
  return out
}

function spread<T>(items: readonly T[], cap: number): T[] {
  if (items.length <= cap) return [...items]
  return Array.from({ length: cap }, (_, i) => items[Math.floor((i * items.length) / cap)])
}

export function dreamFingerprints(dreamTexts: readonly string[], sourceTexts: readonly string[], cap = MAX_FINGERPRINTS): string[] {
  const source = new Set(sourceTexts.flatMap((t) => shingleHashes(t)))
  const seen = new Set<string>()
  const novel: string[] = []
  for (const h of dreamTexts.flatMap((t) => shingleHashes(t))) {
    if (source.has(h) || seen.has(h)) continue
    seen.add(h)
    novel.push(h)
  }
  return spread(novel, cap)
}

export function sharedFingerprintCount(fingerprints: readonly string[], text: string): number {
  const own = new Set(shingleHashes(text))
  return fingerprints.reduce((n, h) => (own.has(h) ? n + 1 : n), 0)
}
