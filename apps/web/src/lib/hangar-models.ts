export const HANGAR_MODELS_CHECKED_AT = '2026-09-10'

interface HangarModelOption {
  id: string
  label: string
}

const models: Record<string, readonly HangarModelOption[]> = {
  copilot: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini' },
    { id: 'mai-code-1.1-flash', label: 'MAI-Code-1.1-Flash' },
    { id: 'grok-4.5', label: 'Grok 4.5' },
    { id: 'grok-4.6', label: 'Grok 4.6' },
    { id: 'kimi-k3', label: 'Kimi K3' },
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
    { id: 'auto', label: 'Copilot Auto' },
  ],
  claude: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  codex: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
  ],
}

export function getHangarModels(engine: string): readonly HangarModelOption[] {
  return Object.hasOwn(models, engine) ? models[engine] : []
}
