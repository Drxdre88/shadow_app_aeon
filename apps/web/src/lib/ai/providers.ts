import {
  CURRENT_MODELS,
  DEFAULT_ROLE_MODEL,
  effortFor,
  remapLegacyModel,
  type ModelEffort,
  type ModelEntry,
  type ModelRole,
} from '@aeon/shared/ai/models'

export type ProviderId = 'anthropic' | 'openai' | 'google'
export type AiTier = 'cheap' | 'standard' | 'heavy'

export type ModelDescriptor = {
  id: string
  label: string
  contextK: number | null
  tiers: AiTier[]
  efforts: ModelEffort[]
  note: string
}

export type ProviderDescriptor = {
  id: ProviderId
  label: string
  docsUrl: string
  keyPrefix: string
  models: ModelDescriptor[]
}

// Which tiers a model suits, from its registry role. Informational for the
// picker; any listed model may serve any tier.
const ROLE_TIERS: Record<ModelRole, AiTier[]> = {
  top: ['heavy'],
  flagship: ['heavy', 'standard'],
  balanced: ['standard', 'cheap'],
  coding: ['standard', 'heavy'],
  fast: ['cheap'],
}

const PROVIDER_META: Omit<ProviderDescriptor, 'models'>[] = [
  { id: 'anthropic', label: 'Anthropic', docsUrl: 'https://console.anthropic.com/settings/keys', keyPrefix: 'sk-ant-' },
  { id: 'openai', label: 'OpenAI', docsUrl: 'https://platform.openai.com/api-keys', keyPrefix: 'sk-' },
  { id: 'google', label: 'Google (Gemini)', docsUrl: 'https://aistudio.google.com/apikey', keyPrefix: 'AIza' },
]

function toDescriptor(m: ModelEntry): ModelDescriptor {
  return { id: m.id, label: m.label, contextK: m.contextK, tiers: ROLE_TIERS[m.role], efforts: m.efforts, note: m.note }
}

// Derived from the shared model registry: current entries only, in registry
// order, so a provider's first model is its flagship.
export const PROVIDERS: ProviderDescriptor[] = PROVIDER_META.map((meta) => ({
  ...meta,
  models: CURRENT_MODELS.filter((m) => m.provider === meta.id).map(toDescriptor),
}))

export type TierPreference = { providerId: ProviderId; modelId: string }

export const DEFAULT_PREFERENCES: Record<AiTier, TierPreference> = {
  cheap: { providerId: DEFAULT_ROLE_MODEL.cheap.provider, modelId: DEFAULT_ROLE_MODEL.cheap.model },
  standard: { providerId: DEFAULT_ROLE_MODEL.standard.provider, modelId: DEFAULT_ROLE_MODEL.standard.model },
  heavy: { providerId: DEFAULT_ROLE_MODEL.heavy.provider, modelId: DEFAULT_ROLE_MODEL.heavy.model },
}

export function getProvider(id: ProviderId): ProviderDescriptor | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

export function getModelDescriptor(providerId: ProviderId, modelId: string): ModelDescriptor | undefined {
  return getProvider(providerId)?.models.find((m) => m.id === modelId)
}

export function isValidProvider(id: string): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id)
}

function providerModelForTier(providerId: ProviderId, tier: AiTier): string | undefined {
  const models = getProvider(providerId)?.models ?? []
  return (models.find((m) => m.tiers.includes(tier)) ?? models[0])?.id
}

/** The model a key test runs on: the cheap-tier default for its provider. */
export function testModelFor(providerId: ProviderId): string {
  if (providerId === DEFAULT_PREFERENCES.cheap.providerId) return DEFAULT_PREFERENCES.cheap.modelId
  return providerModelForTier(providerId, 'cheap') ?? DEFAULT_PREFERENCES.cheap.modelId
}

/** Effort sent for a tier: the tier default when the model accepts it. */
export function tierEffort(tier: AiTier, modelId: string): ModelEffort | null {
  return effortFor(modelId, DEFAULT_ROLE_MODEL[tier].effort)
}

/**
 * AI SDK provider options carrying effort, namespaced per vendor. Google and
 * models without an effort parameter get none.
 */
export function effortProviderOptions(
  providerId: ProviderId | string,
  effort: ModelEffort | null,
): Record<string, Record<string, string>> | undefined {
  if (!effort) return undefined
  if (providerId === 'anthropic') return { anthropic: { effort } }
  if (providerId === 'openai') return { openai: { reasoningEffort: effort } }
  return undefined
}

/**
 * Saved preferences may name a retired model (DB column defaults, older saves).
 * Map them onto the current lineup so nobody calls a retired model and
 * re-saving the form never fails validation. A model unknown to the registry
 * and the remap falls back to the same provider's model for that tier, so a
 * user with only one provider's key is never switched to another provider.
 */
export function normalizeTierPreference(tier: AiTier, pref: { providerId: string; modelId: string }): TierPreference {
  if (!isValidProvider(pref.providerId)) return { ...DEFAULT_PREFERENCES[tier] }
  const remapped = remapLegacyModel(pref.modelId)
  if (getModelDescriptor(pref.providerId, remapped)) return { providerId: pref.providerId, modelId: remapped }
  const fallback = providerModelForTier(pref.providerId, tier)
  return fallback ? { providerId: pref.providerId, modelId: fallback } : { ...DEFAULT_PREFERENCES[tier] }
}

export function normalizePreferences(
  prefs: Record<AiTier, { providerId: string; modelId: string }>,
): Record<AiTier, TierPreference> {
  return {
    cheap: normalizeTierPreference('cheap', prefs.cheap),
    standard: normalizeTierPreference('standard', prefs.standard),
    heavy: normalizeTierPreference('heavy', prefs.heavy),
  }
}

/**
 * Write-path counterpart: swap retired ids for their successors and leave
 * everything else untouched, so validation still rejects a genuinely unknown
 * model instead of silently replacing it.
 */
export function remapPreferenceIds<T>(prefs: T): T {
  if (!prefs || typeof prefs !== 'object') return prefs
  const out: Record<string, unknown> = { ...(prefs as Record<string, unknown>) }
  for (const tier of ['cheap', 'standard', 'heavy'] as const) {
    const t = out[tier] as { modelId?: unknown } | undefined
    if (t && typeof t === 'object' && typeof t.modelId === 'string') {
      out[tier] = { ...t, modelId: remapLegacyModel(t.modelId) }
    }
  }
  return out as T
}
