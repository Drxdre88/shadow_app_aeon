import { randomBytes, createHash } from 'crypto'
import { db } from '@/lib/db'
import { mobileSessions, mobileLoginTokens, users } from '@/lib/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'

const SESSION_PREFIX = 'aeon_s1_'
const LOGIN_TOKEN_EXPIRY = 10 * 60 * 1000
const SESSION_EXPIRY = 90 * 24 * 60 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createLoginToken(email: string, callbackUrl: string) {
  const raw = randomBytes(32).toString('hex')
  const tokenHash = hashToken(raw)
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_EXPIRY)

  await db.insert(mobileLoginTokens).values({
    email,
    tokenHash,
    callbackUrl,
    expiresAt,
  })

  return raw
}

export async function verifyLoginToken(
  token: string
): Promise<{ email: string; callbackUrl: string } | null> {
  const tokenHash = hashToken(token)

  const [record] = await db
    .select()
    .from(mobileLoginTokens)
    .where(
      and(
        eq(mobileLoginTokens.tokenHash, tokenHash),
        isNull(mobileLoginTokens.usedAt),
        gt(mobileLoginTokens.expiresAt, new Date())
      )
    )
    .limit(1)

  if (!record) return null

  await db
    .update(mobileLoginTokens)
    .set({ usedAt: new Date() })
    .where(eq(mobileLoginTokens.id, record.id))

  return { email: record.email, callbackUrl: record.callbackUrl }
}

export async function createMobileSession(userId: string): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  const fullToken = `${SESSION_PREFIX}${raw}`
  const tokenHash = hashToken(fullToken)
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY)

  await db.insert(mobileSessions).values({
    userId,
    tokenHash,
    expiresAt,
  })

  return fullToken
}

export async function verifyMobileSession(
  token: string
): Promise<{ userId: string } | null> {
  if (!token.startsWith(SESSION_PREFIX)) return null

  const tokenHash = hashToken(token)

  const [record] = await db
    .select({ userId: mobileSessions.userId })
    .from(mobileSessions)
    .where(
      and(
        eq(mobileSessions.tokenHash, tokenHash),
        gt(mobileSessions.expiresAt, new Date())
      )
    )
    .limit(1)

  return record || null
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      image: users.image,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  return user || null
}
