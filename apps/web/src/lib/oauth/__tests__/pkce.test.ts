import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { verifyPkceS256 } from '../pkce'

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

describe('verifyPkceS256', () => {
  it('accepts a verifier matching its S256 challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(verifyPkceS256(verifier, challengeFor(verifier))).toBe(true)
  })

  it('rejects a mismatched verifier', () => {
    const challenge = challengeFor('the-real-verifier')
    expect(verifyPkceS256('a-different-verifier', challenge)).toBe(false)
  })

  it('rejects empty inputs', () => {
    expect(verifyPkceS256('', challengeFor('x'))).toBe(false)
    expect(verifyPkceS256('x', '')).toBe(false)
  })

  it('rejects a plaintext (non-hashed) challenge', () => {
    const verifier = 'plain-verifier'
    expect(verifyPkceS256(verifier, verifier)).toBe(false)
  })
})
