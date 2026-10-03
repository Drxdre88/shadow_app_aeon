// Word tokens for the collision checks: lowercase letters/digits, 3+ chars,
// a trailing plural "s" dropped so "tabs" and "tab" meet.
export function tokens(text: string, minLength = 3): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < minLength) continue
    out.add(raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw)
  }
  return out
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
