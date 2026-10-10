import { describe, expect, it } from 'vitest'
import { FALLBACK_PRICE, MODEL_PRICES_PER_MTOK, estimateCostUsd } from '../spend-pricing'
import registry from '@aeon/shared/ai/model-registry.json'

describe('estimateCostUsd', () => {
  it('prices Opus 5.5 input and output at list rates', () => {
    const { costUsd, priced } = estimateCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000 })
    expect(priced).toBe(true)
    expect(costUsd).toBeCloseTo(4 + 2, 6)
  })

  it('splits cached input out of the SDK total input', () => {
    const { costUsd } = estimateCostUsd('claude-sonnet-5-5', {
      inputTokens: 1_000_000,
      cacheReadTokens: 600_000,
      cacheWriteTokens: 200_000,
      outputTokens: 0,
    })
    expect(costUsd).toBeCloseTo(0.2 * 2 + 0.2 * 2.5 + 0.6 * 0.1, 6)
  })

  it('falls back to Opus rates for an unpriced model and says so', () => {
    const { costUsd, priced } = estimateCostUsd('gpt-6-astra', { inputTokens: 1_000_000 })
    expect(priced).toBe(false)
    expect(costUsd).toBeCloseTo(FALLBACK_PRICE.input, 6)
  })

  it('treats missing usage as zero cost', () => {
    expect(estimateCostUsd('claude-opus-5-5', undefined).costUsd).toBe(0)
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: Number.NaN, outputTokens: -5 }).costUsd).toBe(0)
  })

  it('prices every current Anthropic model in the registry', () => {
    const anthropic = registry.models.filter((m) => m.provider === 'anthropic' && m.status === 'current')
    for (const m of anthropic) expect(MODEL_PRICES_PER_MTOK[m.id], m.id).toBeDefined()
  })
})
