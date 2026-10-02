import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import { db } from '@/lib/db'
import { userAiCredentials, userAiPreferences } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { decryptSecret } from './crypto'
import { DEFAULT_PREFERENCES, normalizeTierPreference, tierEffort, type AiTier, type ProviderId } from './providers'
import type { ModelEffort } from '@aeon/shared/ai/models'
import { PAID_BACKUP_OFF_ERROR_NAME, PAID_BACKUP_OFF_NOTE } from './paid-backup-off'
import { isPaidBackupEnabled } from '@/lib/kairos/paid-backup'

export class AiCredentialMissingError extends Error {
  readonly provider: ProviderId
  constructor(provider: ProviderId) {
    super(`No active credential found for provider ${provider}`)
    this.name = 'AiCredentialMissingError'
    this.provider = provider
  }
}

/**
 * Thrown instead of resolving the user's key when they switched the Kairos
 * "Paid backup" off. Subclasses the missing-credential error so every existing
 * caller declines exactly as it does with no key (deterministic paths, skips).
 */
export class PaidBackupOffError extends AiCredentialMissingError {
  constructor(provider: ProviderId) {
    super(provider)
    this.message = PAID_BACKUP_OFF_NOTE
    this.name = PAID_BACKUP_OFF_ERROR_NAME
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
  // Saved ids may be retired (column defaults, older saves): remap at read time.
  if (tier === 'cheap') return normalizeTierPreference(tier, { providerId: prefs.cheapProviderId, modelId: prefs.cheapModelId })
  if (tier === 'standard') return normalizeTierPreference(tier, { providerId: prefs.standardProviderId, modelId: prefs.standardModelId })
  return normalizeTierPreference(tier, { providerId: prefs.heavyProviderId, modelId: prefs.heavyModelId })
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

// The single choke point for the user's saved key: its only consumer is
// getProviderForUser, which only Kairos calls (the credential test/save paths
// use buildModelWithKey with the key they were handed, unaffected). With the
// Kairos "Paid backup" switch off, no key is resolved at all.
export interface ResolvedTierModel {
  model: LanguageModel
  providerId: ProviderId
  modelId: string
  // The tier's effort when the model accepts one (null for e.g. Haiku/Gemini).
  effort: ModelEffort | null
}

export async function resolveModelForUser(userId: string, tier: AiTier): Promise<ResolvedTierModel> {
  const [{ providerId, modelId }, paidAllowed] = await Promise.all([
    resolveTier(userId, tier),
    isPaidBackupEnabled(userId),
  ])
  if (!paidAllowed) throw new PaidBackupOffError(providerId)
  const apiKey = await getDecryptedKey(userId, providerId)
  return { model: buildModel(providerId, modelId, apiKey), providerId, modelId, effort: tierEffort(tier, modelId) }
}

export async function getModelForUser(userId: string, tier: AiTier): Promise<LanguageModel> {
  return (await resolveModelForUser(userId, tier)).model
}

export async function buildModelWithKey(providerId: ProviderId, modelId: string, apiKey: string): Promise<LanguageModel> {
  return buildModel(providerId, modelId, apiKey)
}
