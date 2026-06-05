import { randomBytes, createHash } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { oauthClients, oauthAuthCodes, oauthAccessTokens } from '@/lib/db/schema'

const CODE_TTL_MS = 10 * 60 * 1000 // 10 minutes — single-use, short-lived
const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000 // 1 year

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function mintToken(prefix: string): { raw: string; hash: string } {
  const raw = `${prefix}${randomBytes(32).toString('hex')}`
  return { raw, hash: sha256(raw) }
}

// --- Clients (Dynamic Client Registration) ---------------------------------

export async function registerClient(redirectUris: string[], clientName: string | null) {
  const [row] = await db
    .insert(oauthClients)
    .values({ redirectUris, clientName })
    .returning()
  return row
}

export async function getClient(clientId: string) {
  if (!clientId) return null
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).limit(1)
  return row ?? null
}

// --- Authorization codes ----------------------------------------------------

export async function createAuthCode(input: {
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  scope: string
  resource?: string
}): Promise<string> {
  const { raw, hash } = mintToken('aeon_ac_')
  await db.insert(oauthAuthCodes).values({
    codeHash: hash,
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
    resource: input.resource ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })
  return raw
}

/**
 * Atomically consume an auth code: the `usedAt IS NULL` guard in the WHERE
 * clause means a replayed code can never be redeemed twice, even under a race.
 * Returns null if the code is unknown, already used, or expired.
 */
export async function consumeAuthCode(rawCode: string) {
  const hash = sha256(rawCode)
  const [row] = await db
    .update(oauthAuthCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthAuthCodes.codeHash, hash), isNull(oauthAuthCodes.usedAt)))
    .returning()
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) return null
  return row
}

// --- Access / refresh tokens ------------------------------------------------

export async function issueTokens(input: { clientId: string; userId: string; scope: string }) {
  const access = mintToken('aeon_at_')
  const refresh = mintToken('aeon_rt_')
  const now = Date.now()
  await db.insert(oauthAccessTokens).values({
    tokenHash: access.hash,
    tokenPrefix: access.raw.slice(0, 12),
    refreshHash: refresh.hash,
    clientId: input.clientId,
    userId: input.userId,
    scope: input.scope,
    expiresAt: new Date(now + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
  })
  return {
    accessToken: access.raw,
    refreshToken: refresh.raw,
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    scope: input.scope,
  }
}

/**
 * Rotate a refresh token: revoke the old record and mint a fresh access+refresh
 * pair for the same user. Refresh-token rotation limits the blast radius of a
 * leaked refresh token.
 */
export async function rotateRefreshToken(rawRefresh: string, clientId?: string) {
  const hash = sha256(rawRefresh)
  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(and(eq(oauthAccessTokens.refreshHash, hash), isNull(oauthAccessTokens.revokedAt)))
    .limit(1)
  if (!row) return null
  if (clientId && row.clientId !== clientId) return null
  if (row.refreshExpiresAt && row.refreshExpiresAt.getTime() < Date.now()) return null

  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthAccessTokens.id, row.id))

  return issueTokens({ clientId: row.clientId, userId: row.userId, scope: row.scope })
}

/** Resolve an OAuth access token to its user — called by authenticateRequest. */
export async function verifyOAuthAccessToken(
  rawToken: string
): Promise<{ userId: string; scope: string } | null> {
  if (!rawToken.startsWith('aeon_at_')) return null
  const hash = sha256(rawToken)
  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(and(eq(oauthAccessTokens.tokenHash, hash), isNull(oauthAccessTokens.revokedAt)))
    .limit(1)
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) return null

  db.update(oauthAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthAccessTokens.id, row.id))
    .catch(() => {})

  return { userId: row.userId, scope: row.scope }
}
