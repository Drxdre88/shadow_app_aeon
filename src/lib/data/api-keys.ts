import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { apiKeys } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'

const KEY_PREFIX = 'aeon_k1_'

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export async function createApiKey(userId: string, name: string) {
  const raw = randomBytes(16).toString('hex')
  const fullKey = `${KEY_PREFIX}${raw}`
  const keyPrefix = fullKey.slice(0, 10)
  const keyHash = hashKey(fullKey)

  const [record] = await db
    .insert(apiKeys)
    .values({ userId, name, keyPrefix, keyHash })
    .returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt })

  return { ...record, key: fullKey }
}

export async function listApiKeys(userId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
}

export async function verifyApiKey(token: string): Promise<{ userId: string; keyId: string } | null> {
  if (!token.startsWith(KEY_PREFIX)) return null

  const prefix = token.slice(0, 10)
  const tokenHash = hashKey(token)
  const tokenHashBuffer = Buffer.from(tokenHash, 'hex')

  const candidates = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, keyHash: apiKeys.keyHash })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))

  for (const candidate of candidates) {
    const candidateBuffer = Buffer.from(candidate.keyHash, 'hex')
    if (candidateBuffer.length === tokenHashBuffer.length && timingSafeEqual(tokenHashBuffer, candidateBuffer)) {
      db.update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, candidate.id))
        .catch(() => {})

      return { userId: candidate.userId, keyId: candidate.id }
    }
  }

  return null
}

export async function revokeApiKey(keyId: string, userId: string) {
  const [revoked] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id })

  return !!revoked
}

export async function renameApiKey(keyId: string, userId: string, name: string) {
  const [updated] = await db
    .update(apiKeys)
    .set({ name })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id, name: apiKeys.name })

  return updated || null
}

export async function countActiveKeys(userId: string): Promise<number> {
  const keys = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))

  return keys.length
}
