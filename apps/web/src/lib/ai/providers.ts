export type ProviderId = 'anthropic' | 'openai' | 'google'
export type AiTier = 'cheap' | 'standard' | 'heavy'

export type ModelDescriptor = {
  id: string
  label: string
  contextK: number
  tiers: AiTier[]
}

export type ProviderDescriptor = {
  id: ProviderId
  label: string
  docsUrl: string
  keyPrefix: string
  models: ModelDescriptor[]
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyPrefix: 'sk-ant-',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', contextK: 200, tiers: ['cheap'] },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', contextK: 1000, tiers: ['standard'] },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', contextK: 200, tiers: ['standard'] },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', contextK: 1000, tiers: ['heavy'] },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', contextK: 1000, tiers: ['heavy'] },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
    models: [
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', contextK: 1000, tiers: ['cheap'] },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', contextK: 1000, tiers: ['standard'] },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', contextK: 1000, tiers: ['heavy'] },
      { id: 'gpt-5.5-mini', label: 'GPT-5.5 mini', contextK: 256, tiers: ['cheap'] },
      { id: 'gpt-5.5', label: 'GPT-5.5', contextK: 256, tiers: ['standard'] },
      { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', contextK: 1024, tiers: ['heavy'] },
    ],
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    docsUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AIza',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', contextK: 1024, tiers: ['cheap'] },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', contextK: 2048, tiers: ['standard', 'heavy'] },
    ],
  },
]

export const DEFAULT_PREFERENCES = {
  cheap: { providerId: 'anthropic' as ProviderId, modelId: 'claude-haiku-4-5-20251001' },
  standard: { providerId: 'anthropic' as ProviderId, modelId: 'claude-sonnet-5' },
  heavy: { providerId: 'anthropic' as ProviderId, modelId: 'claude-opus-4-8' },
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
