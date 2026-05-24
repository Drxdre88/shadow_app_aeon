import { db } from '@/lib/db'
import { userAiCredentials, userAiPreferences } from '@/lib/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { encryptSecret, keyHint } from '@/lib/ai/crypto'
import type { ProviderId } from '@/lib/ai/providers'

export type CredentialSummary = {
  id: string
  provider: string
  label: string
  keyHint: string | null
  lastUsedAt: Date | null
  createdAt: Date
}

export async function listCredentials(userId: string): Promise<CredentialSummary[]> {
  return db
    .select({
      id: userAiCredentials.id,
      provider: userAiCredentials.provider,
      label: userAiCredentials.label,
      keyHint: userAiCredentials.keyHint,
      lastUsedAt: userAiCredentials.lastUsedAt,
      createdAt: userAiCredentials.createdAt,
    })
    .from(userAiCredentials)
    .where(and(eq(userAiCredentials.userId, userId), isNull(userAiCredentials.revokedAt)))
    .orderBy(desc(userAiCredentials.createdAt))
}

export async function upsertCredential(
  userId: string,
  provider: ProviderId,
  label: string,
  apiKey: string,
): Promise<CredentialSummary> {
  const enc = encryptSecret(apiKey)
  const hint = keyHint(apiKey)

  await db
    .update(userAiCredentials)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(userAiCredentials.userId, userId),
      eq(userAiCredentials.provider, provider),
      isNull(userAiCredentials.revokedAt),
    ))

  const [row] = await db
    .insert(userAiCredentials)
    .values({
      userId,
      provider,
      label,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      keyHint: hint,
    })
    .returning({
      id: userAiCredentials.id,
      provider: userAiCredentials.provider,
      label: userAiCredentials.label,
      keyHint: userAiCredentials.keyHint,
      lastUsedAt: userAiCredentials.lastUsedAt,
      createdAt: userAiCredentials.createdAt,
    })

  return row
}

export async function revokeCredential(id: string, userId: string): Promise<boolean> {
  const [row] = await db
    .update(userAiCredentials)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(userAiCredentials.id, id),
      eq(userAiCredentials.userId, userId),
      isNull(userAiCredentials.revokedAt),
    ))
    .returning({ id: userAiCredentials.id })
  return !!row
}

export async function renameCredential(id: string, userId: string, label: string) {
  const [row] = await db
    .update(userAiCredentials)
    .set({ label })
    .where(and(
      eq(userAiCredentials.id, id),
      eq(userAiCredentials.userId, userId),
      isNull(userAiCredentials.revokedAt),
    ))
    .returning({
      id: userAiCredentials.id,
      provider: userAiCredentials.provider,
      label: userAiCredentials.label,
      keyHint: userAiCredentials.keyHint,
      lastUsedAt: userAiCredentials.lastUsedAt,
      createdAt: userAiCredentials.createdAt,
    })
  return row || null
}

export type PreferenceShape = {
  cheap: { providerId: string; modelId: string }
  standard: { providerId: string; modelId: string }
  heavy: { providerId: string; modelId: string }
}

export async function getPreferences(userId: string): Promise<PreferenceShape | null> {
  const [row] = await db
    .select()
    .from(userAiPreferences)
    .where(eq(userAiPreferences.userId, userId))
    .limit(1)
  if (!row) return null
  return {
    cheap: { providerId: row.cheapProviderId, modelId: row.cheapModelId },
    standard: { providerId: row.standardProviderId, modelId: row.standardModelId },
    heavy: { providerId: row.heavyProviderId, modelId: row.heavyModelId },
  }
}

export async function upsertPreferences(userId: string, prefs: PreferenceShape) {
  await db
    .insert(userAiPreferences)
    .values({
      userId,
      cheapProviderId: prefs.cheap.providerId,
      cheapModelId: prefs.cheap.modelId,
      standardProviderId: prefs.standard.providerId,
      standardModelId: prefs.standard.modelId,
      heavyProviderId: prefs.heavy.providerId,
      heavyModelId: prefs.heavy.modelId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userAiPreferences.userId,
      set: {
        cheapProviderId: prefs.cheap.providerId,
        cheapModelId: prefs.cheap.modelId,
        standardProviderId: prefs.standard.providerId,
        standardModelId: prefs.standard.modelId,
        heavyProviderId: prefs.heavy.providerId,
        heavyModelId: prefs.heavy.modelId,
        updatedAt: new Date(),
      },
    })
  return prefs
}
