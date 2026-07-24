import { describe, it, expect, vi } from 'vitest'

// No engine_policies rows in the DB → every route falls through to
// DEFAULT_POLICIES. That fallback table is what this suite locks down.
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    })),
  },
}))

import { routeTask } from '../route-task'
import { DEFAULT_PREFERENCES } from '../providers'

const USER = 'user-1'

describe('routeTask default policies (quality-over-cost, 2026-07-24)', () => {
  it.each([
    // Everything that shapes the self-model or speaks to the operator → heavy
    ['archetype', 'heavy'],
    ['cortex', 'heavy'],
    ['contradiction', 'heavy'],
    ['brief', 'heavy'],
    ['advisory', 'heavy'],
    ['aether', 'heavy'],
    ['chat', 'heavy'],
    ['reflect', 'heavy'],
    ['digest', 'heavy'],
    ['delta', 'heavy'],
    // Genuinely mechanical lanes stay cheap
    ['classify', 'cheap'],
  ] as const)('%s → %s', async (taskType, tier) => {
    const decision = await routeTask(USER, { taskType })
    expect(decision).toEqual({ providerId: 'byok', modelId: null, tier, source: 'default' })
  })

  it('unknown task types fall back to standard', async () => {
    const decision = await routeTask(USER, { taskType: 'does-not-exist' })
    expect(decision.tier).toBe('standard')
  })
})

describe('tier → model defaults', () => {
  it('standard tier defaults to Claude Sonnet 5, heavy to Opus 4.8', () => {
    expect(DEFAULT_PREFERENCES.standard.modelId).toBe('claude-sonnet-5')
    expect(DEFAULT_PREFERENCES.heavy.modelId).toBe('claude-opus-4-8')
    expect(DEFAULT_PREFERENCES.cheap.modelId).toBe('claude-haiku-4-5-20251001')
  })
})
