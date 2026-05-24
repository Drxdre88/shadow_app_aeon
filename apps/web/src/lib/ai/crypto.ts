import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

function getMasterKey(): Buffer {
  const raw = process.env.AI_KEYS_MASTER_KEY
  if (!raw) {
    throw new Error('AI_KEYS_MASTER_KEY is not set')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('AI_KEYS_MASTER_KEY must decode to 32 bytes (base64-encoded)')
  }
  return key
}

export type EncryptedSecret = {
  ciphertext: string
  iv: string
  authTag: string
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getMasterKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

export function decryptSecret(enc: EncryptedSecret): string {
  const key = getMasterKey()
  const iv = Buffer.from(enc.iv, 'base64')
  const ciphertext = Buffer.from(enc.ciphertext, 'base64')
  const authTag = Buffer.from(enc.authTag, 'base64')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

export function keyHint(plaintext: string): string {
  if (plaintext.length <= 8) return '****'
  return `…${plaintext.slice(-4)}`
}
