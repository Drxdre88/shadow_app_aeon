import { describe, expect, it } from 'vitest'
import { LEGACY_REMAP } from '@aeon/shared/ai/models'
import {
  DEFAULT_PREFERENCES,
  PROVIDERS,
  effortProviderOptions,
  getModelDescriptor,
  normalizePreferences,
  normalizeTierPreference,
  remapPreferenceIds,
  testModelFor,
  tierEffort,
} from '../providers'

describe('PROVIDERS (derived from the model registry)', () => {
  it('offers no retired model id', () => {
    const offered = PROVIDERS.flatMap((p) => p.models.map((m) => m.id))
    for (const legacy of Object.keys(LEGACY_REMAP)) expect(offered).not.toContain(legacy)
  })

  it('lists each provider\'s flagship first (used when a tier switches provider)', () => {
    expect(PROVIDERS.find((p) => p.id === 'anthropic')?.models[0]?.id).toBe('claude-opus-5-5')
    expect(PROVIDERS.find((p) => p.id === 'openai')?.models[0]?.id).toBe('gpt-6-astra')
  })

  it('every default preference validates against the offered models', () => {
    for (const pref of Object.values(DEFAULT_PREFERENCES)) {
      expect(getModelDescriptor(pref.providerId, pref.modelId)).toBeDefined()
    }
  })
})

describe('saved preference remap', () => {
  it('maps the DB column defaults and older saves onto current models', () => {
    expect(normalizePreferences({
      cheap: { providerId: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
      standard: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
      heavy: { providerId: 'anthropic', modelId: 'claude-opus-4-7' },
    })).toEqual({
      cheap: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
      standard: { providerId: 'anthropic', modelId: 'claude-sonnet-5-5' },
      heavy: { providerId: 'anthropic', modelId: 'claude-opus-5-5' },
    })
  })

  it('keeps an unknown model on the same provider (never switches the user\'s key)', () => {
    expect(normalizeTierPreference('heavy', { providerId: 'openai', modelId: 'gpt-3-ancient' }))
      .toEqual({ providerId: 'openai', modelId: 'gpt-6-astra' })
    expect(normalizeTierPreference('cheap', { providerId: 'google', modelId: 'gemini-1' }))
      .toEqual({ providerId: 'google', modelId: 'gemini-3.8-flash' })
  })

  it('falls back to the tier default for an unknown provider', () => {
    expect(normalizeTierPreference('standard', { providerId: 'mystery', modelId: 'x' })).toEqual(DEFAULT_PREFERENCES.standard)
  })

  it('write path swaps retired ids but leaves unknown ids for validation to reject', () => {
    const out = remapPreferenceIds({
      cheap: { providerId: 'openai', modelId: 'gpt-5.6-luna' },
      standard: { providerId: 'anthropic', modelId: 'not-a-model' },
      heavy: { providerId: 'anthropic', modelId: 'claude-opus-4-8' },
    })
    expect(out.cheap.modelId).toBe('gpt-6-luna')
    expect(out.standard.modelId).toBe('not-a-model')
    expect(out.heavy.modelId).toBe('claude-opus-5-5')
    expect(remapPreferenceIds(null)).toBeNull()
  })
})

describe('key test model', () => {
  it('uses each provider\'s own cheap model, never a Claude model for another vendor', () => {
    expect(testModelFor('anthropic')).toBe(DEFAULT_PREFERENCES.cheap.modelId)
    expect(getModelDescriptor('openai', testModelFor('openai'))).toBeDefined()
    expect(getModelDescriptor('google', testModelFor('google'))).toBeDefined()
  })
})

describe('effort', () => {
  it('uses the tier effort when the model accepts it', () => {
    expect(tierEffort('heavy', 'claude-opus-5-5')).toBe('high')
    expect(tierEffort('standard', 'claude-opus-5-5')).toBe('medium')
    expect(tierEffort('cheap', 'claude-sonnet-5-5')).toBe('low')
    expect(tierEffort('cheap', 'claude-haiku-4-5')).toBeNull()
    expect(tierEffort('heavy', 'gemini-3.8-flash')).toBeNull()
  })

  it('namespaces provider options per vendor', () => {
    expect(effortProviderOptions('anthropic', 'high')).toEqual({ anthropic: { effort: 'high' } })
    expect(effortProviderOptions('openai', 'medium')).toEqual({ openai: { reasoningEffort: 'medium' } })
    expect(effortProviderOptions('google', 'high')).toBeUndefined()
    expect(effortProviderOptions('anthropic', null)).toBeUndefined()
  })
})
