import type { ProviderId } from './providers'

export type ProviderUi = {
  id: ProviderId
  label: string
  tint: string
}

export const PROVIDER_UI: ProviderUi[] = [
  { id: 'anthropic', label: 'Anthropic', tint: '#c97e4a' },
  { id: 'openai',    label: 'OpenAI',    tint: '#10a37f' },
  { id: 'google',    label: 'Gemini',    tint: '#4f8df7' },
]

export const PROVIDER_TINT: Record<ProviderId, string> = Object.fromEntries(
  PROVIDER_UI.map((p) => [p.id, p.tint]),
) as Record<ProviderId, string>

export const PROVIDER_LABEL: Record<ProviderId, string> = Object.fromEntries(
  PROVIDER_UI.map((p) => [p.id, p.label]),
) as Record<ProviderId, string>
