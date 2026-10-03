import { describe, expect, it, vi } from 'vitest'

// Importing the barrel (pure helpers) must never need the database client.
describe('surprise barrel', () => {
  it('imports without DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const mod = await import('../index')
    expect(typeof mod.openUntilFor).toBe('function')
    expect(mod.emptySurpriseLedger().v).toBe(1)
    vi.unstubAllEnvs()
  })
})
