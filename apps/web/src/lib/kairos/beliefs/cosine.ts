// Cosine similarity shared by the belief comparison (same-topic pairing) and
// the constitution drift probe. Defensive: empty or length-mismatched vectors,
// a zero vector, or a non-finite result give 0; the result is clamped to [-1, 1].
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  const c = dot / (Math.sqrt(na) * Math.sqrt(nb))
  return Number.isFinite(c) ? Math.max(-1, Math.min(1, c)) : 0
}
