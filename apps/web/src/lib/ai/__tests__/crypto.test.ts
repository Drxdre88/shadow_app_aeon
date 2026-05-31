import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'crypto'

beforeAll(() => {
  process.env.AI_KEYS_MASTER_KEY = randomBytes(32).toString('base64')
})

describe('ai/crypto', () => {
  it('roundtrips a secret', async () => {
    const { encryptSecret, decryptSecret } = await import('../crypto')
    const plaintext = 'sk-ant-fakebutlongenough-xxxxxxxxxxxxxxxx'
    const enc = encryptSecret(plaintext)
    expect(enc.ciphertext).not.toContain(plaintext)
    expect(enc.iv).toBeTruthy()
    expect(enc.authTag).toBeTruthy()
    expect(decryptSecret(enc)).toBe(plaintext)
  })

  it('produces a distinct iv each call', async () => {
    const { encryptSecret } = await import('../crypto')
    const a = encryptSecret('same-input-value-12345')
    const b = encryptSecret('same-input-value-12345')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('rejects tampered ciphertext', async () => {
    const { encryptSecret, decryptSecret } = await import('../crypto')
    const enc = encryptSecret('original-secret-value')
    const tampered = { ...enc, ciphertext: Buffer.from('garbage').toString('base64') }
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('keyHint returns last-4 suffix', async () => {
    const { keyHint } = await import('../crypto')
    expect(keyHint('sk-ant-abcd1234efgh5678')).toBe('…5678')
    expect(keyHint('short')).toBe('****')
  })
})
