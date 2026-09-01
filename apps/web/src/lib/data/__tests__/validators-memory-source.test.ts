import { describe, expect, it } from 'vitest'
import { createMemorySchema, searchMemoriesSchema } from '../validators'

describe('coding-agent memory sources', () => {
  it.each(['codex', 'copilot'] as const)('accepts %s session summaries', (source) => {
    expect(createMemorySchema.safeParse({
      title: `${source} session`,
      bodyMd: 'Session summary',
      type: 'session_summary',
      source,
    }).success).toBe(true)
  })

  it.each(['codex', 'copilot'] as const)('accepts %s as a search filter', (source) => {
    expect(searchMemoriesSchema.safeParse({ query: 'session', source }).success).toBe(true)
  })
})
