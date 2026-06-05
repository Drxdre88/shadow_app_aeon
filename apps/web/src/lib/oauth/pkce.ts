import { createHash } from 'crypto'

/**
 * Verify an RFC 7636 PKCE code_verifier against a stored S256 challenge.
 * challenge === base64url( SHA256( verifier ) ). Only S256 is supported —
 * the "plain" method is intentionally rejected (it offers no real protection).
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  const hash = createHash('sha256').update(verifier).digest('base64url')
  // Length check first so the comparison below is over equal-length strings.
  if (hash.length !== challenge.length) return false
  let mismatch = 0
  for (let i = 0; i < hash.length; i++) {
    mismatch |= hash.charCodeAt(i) ^ challenge.charCodeAt(i)
  }
  return mismatch === 0
}
