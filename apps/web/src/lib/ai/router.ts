import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import { db } from '@/lib/db'
import { userAiCredentials, userAiPreferences } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { decryptSecret } from './crypto'
import { DEFAULT_PREFERENCES, type AiTier, type ProviderId } from './providers'

export class AiCredentialMissingError extends Error {
  readonly provider: ProviderId
  constructor(provider: ProviderId) {
    super(`No active credential found for provider ${provider}`)
    this.name = 'AiCredentialMissingError'
    this.provider = provider
  }
}

/**
 * Thrown when a stored credential exists but cannot be decrypted — almost always
 * because AI_KEYS_MASTER_KEY was rotated/changed since the key was saved, so the
 * AES-GCM auth tag no longer verifies. Surfaced as an actionable "re-enter your
 * key" instead of the raw OpenSSL "Unsupported state or unable to authenticate
 * data" crypto error that otherwise 500s the whole request.
 */
export class AiCredentialDecryptError extends Error {
  readonly provider: ProviderId
  constructor(provider: ProviderId) {
    super(`Stored credential for ${provider} could not be decrypted — please re-enter your API key in Settings`)
    this.name = 'AiCredentialDecryptError'
    this.provider = provider
  }
}

type TierResolution = { providerId: ProviderId; modelId: string }

async function resolveTier(userId: string, tier: AiTier): Promise<TierResolution> {
  const [prefs] = await db.select().from(userAiPreferences).where(eq(userAiPreferences.userId, userId))
  if (!prefs) return DEFAULT_PREFERENCES[tier]
  if (tier === 'cheap') return { providerId: prefs.cheapProviderId as ProviderId, modelId: prefs.cheapModelId }
  if (tier === 'standard') return { providerId: prefs.standardProviderId as ProviderId, modelId: prefs.standardModelId }
  return { providerId: prefs.heavyProviderId as ProviderId, modelId: prefs.heavyModelId }
}

async function getDecryptedKey(userId: string, providerId: ProviderId): Promise<string> {
  const [cred] = await db
    .select()
    .from(userAiCredentials)
    .where(and(
      eq(userAiCredentials.userId, userId),
      eq(userAiCredentials.provider, providerId),
      isNull(userAiCredentials.revokedAt),
    ))
    .limit(1)
  if (!cred) throw new AiCredentialMissingError(providerId)

  db.update(userAiCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(userAiCredentials.id, cred.id))
    .catch(() => {})

  try {
    return decryptSecret({ ciphertext: cred.ciphertext, iv: cred.iv, authTag: cred.authTag })
  } catch {
    // Auth-tag failure (master key changed) or corrupt ciphertext — turn the raw
    // OpenSSL error into a typed, actionable one callers can present cleanly.
    throw new AiCredentialDecryptError(providerId)
  }
}

function buildModel(providerId: ProviderId, modelId: string, apiKey: string): LanguageModel {
  switch (providerId) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId)
  }
}

export async function getModelForUser(userId: string, tier: AiTier): Promise<LanguageModel> {
  const { providerId, modelId } = await resolveTier(userId, tier)
  const apiKey = await getDecryptedKey(userId, providerId)
  return buildModel(providerId, modelId, apiKey)
}

export async function buildModelWithKey(providerId: ProviderId, modelId: string, apiKey: string): Promise<LanguageModel> {
  return buildModel(providerId, modelId, apiKey)
}
