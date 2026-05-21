'use server'

import { revalidatePath } from 'next/cache'
import { generateText } from 'ai'
import { requireAiAccess } from './helpers'
import {
  listCredentials,
  upsertCredential,
  revokeCredential,
  renameCredential,
  getPreferences,
  upsertPreferences,
  type PreferenceShape,
} from '@/lib/data/ai-credentials'
import { buildModelWithKey } from '@/lib/ai/router'
import { isValidProvider, DEFAULT_PREFERENCES, getModelDescriptor, type ProviderId } from '@/lib/ai/providers'

export async function fetchCredentials() {
  const userId = await requireAiAccess()
  return listCredentials(userId)
}

export async function saveCredential(input: { provider: string; label: string; apiKey: string }) {
  const userId = await requireAiAccess()
  if (!isValidProvider(input.provider)) throw new Error('Invalid provider')
  const label = input.label.trim() || `${input.provider} key`
  const apiKey = input.apiKey.trim()
  if (apiKey.length < 8) throw new Error('API key looks too short')
  const row = await upsertCredential(userId, input.provider, label, apiKey)
  revalidatePath('/settings/ai')
  return row
}

export async function deleteCredential(id: string) {
  const userId = await requireAiAccess()
  const ok = await revokeCredential(id, userId)
  if (!ok) throw new Error('Credential not found')
  revalidatePath('/settings/ai')
  return { revoked: true }
}

export async function patchCredentialLabel(id: string, label: string) {
  const userId = await requireAiAccess()
  const trimmed = label.trim()
  if (!trimmed) throw new Error('Label required')
  const row = await renameCredential(id, userId, trimmed)
  if (!row) throw new Error('Credential not found')
  revalidatePath('/settings/ai')
  return row
}

export async function testCandidateKey(input: { provider: string; apiKey: string; modelId?: string }) {
  await requireAiAccess()
  if (!isValidProvider(input.provider)) throw new Error('Invalid provider')
  const providerId = input.provider as ProviderId
  const modelId = input.modelId ?? DEFAULT_PREFERENCES.cheap.modelId
  const descriptor = getModelDescriptor(providerId, modelId)
  if (!descriptor) throw new Error('Unknown model for provider')

  const apiKey = input.apiKey.trim()
  if (apiKey.length < 8) throw new Error('API key looks too short')

  const startedAt = Date.now()
  try {
    const model = await buildModelWithKey(providerId, modelId, apiKey)
    const { text, usage } = await generateText({
      model,
      prompt: 'Reply with exactly: ok',
      maxOutputTokens: 8,
    })
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      sample: text.trim().slice(0, 32),
      usage: {
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      },
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Connection test failed',
    }
  }
}

export async function fetchPreferences() {
  const userId = await requireAiAccess()
  const prefs = await getPreferences(userId)
  if (prefs) return prefs
  return {
    cheap: { ...DEFAULT_PREFERENCES.cheap },
    standard: { ...DEFAULT_PREFERENCES.standard },
    heavy: { ...DEFAULT_PREFERENCES.heavy },
  }
}

export async function savePreferences(prefs: PreferenceShape) {
  const userId = await requireAiAccess()
  for (const tier of ['cheap', 'standard', 'heavy'] as const) {
    const t = prefs[tier]
    if (!isValidProvider(t.providerId)) throw new Error(`Invalid provider for ${tier}`)
    if (!getModelDescriptor(t.providerId as ProviderId, t.modelId)) {
      throw new Error(`Unknown model "${t.modelId}" for provider ${t.providerId}`)
    }
  }
  const saved = await upsertPreferences(userId, prefs)
  revalidatePath('/settings/ai')
  return saved
}
