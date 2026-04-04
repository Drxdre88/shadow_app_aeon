import { randomBytes, createHash } from 'crypto'
import { db } from '@/lib/db'
import { mobileSessions, mobileLoginTokens, users, accounts } from '@/lib/db/schema'
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

export type GoogleProfile = {
  email: string
  sub: string
  name?: string
  picture?: string
}

export async function verifyGoogleIdToken(
  idToken: string
): Promise<GoogleProfile | null> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  )
  if (!res.ok) return null

  const payload = await res.json()

  if (!payload.email || !payload.email_verified || payload.email_verified === 'false') {
    return null
  }

  const expectedClientId = process.env.AUTH_GOOGLE_ID
  if (!expectedClientId || payload.aud !== expectedClientId) {
    return null
  }

  return {
    email: payload.email,
    sub: payload.sub,
    name: payload.name,
    picture: payload.picture,
  }
}

export async function findOrCreateGoogleUser(profile: GoogleProfile) {
  const [existing] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(
      and(
        eq(accounts.provider, 'google'),
        eq(accounts.providerAccountId, profile.sub)
      )
    )
    .limit(1)

  if (existing) {
    return findUserById(existing.userId)
  }

  const existingUser = await findUserByEmail(profile.email)

  if (existingUser) {
    await db.insert(accounts).values({
      userId: existingUser.id,
      type: 'oauth',
      provider: 'google',
      providerAccountId: profile.sub,
    })
    if (profile.picture && !existingUser.image) {
      await db
        .update(users)
        .set({ image: profile.picture })
        .where(eq(users.id, existingUser.id))
    }
    return existingUser
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)

  const [newUser] = await db
    .insert(users)
    .values({
      email: profile.email,
      name: profile.name || profile.email.split('@')[0],
      image: profile.picture,
      emailVerified: new Date(),
      role: adminEmails.includes(profile.email) ? 'admin' : 'user',
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      image: users.image,
    })

  await db.insert(accounts).values({
    userId: newUser.id,
    type: 'oauth',
    provider: 'google',
    providerAccountId: profile.sub,
  })

  return newUser
}

async function findUserById(id: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  return user || null
}
