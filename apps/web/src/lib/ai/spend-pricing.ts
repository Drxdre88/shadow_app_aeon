import type { AIUsage } from './provider'

export interface ModelPrice {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}

// USD per million tokens. Source: Anthropic list prices,
// https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-10).
// cacheWrite is the 5-minute ephemeral write rate, the only cache the app uses.
// The model registry carries no prices; add a row here when a model is added there.
export const MODEL_PRICES_PER_MTOK: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  'claude-haiku-4-5': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
}

export const FALLBACK_PRICE: ModelPrice = MODEL_PRICES_PER_MTOK['claude-opus-5-5']

export interface CostEstimate {
  costUsd: number
  priced: boolean
}

function tokens(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

export function estimateCostUsd(modelId: string, usage: AIUsage | undefined): CostEstimate {
  const known = MODEL_PRICES_PER_MTOK[modelId]
  const price = known ?? FALLBACK_PRICE
  const cacheRead = tokens(usage?.cacheReadTokens)
  const cacheWrite = tokens(usage?.cacheWriteTokens)
  const uncached = Math.max(0, tokens(usage?.inputTokens) - cacheRead - cacheWrite)
  const output = tokens(usage?.outputTokens)
  const micro = uncached * price.input + cacheWrite * price.cacheWrite + cacheRead * price.cacheRead + output * price.output
  return { costUsd: micro / 1_000_000, priced: Boolean(known) }
}
