import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ auth: () => auth() }))
vi.mock('@/lib/changelog-private', () => ({
  PRIVATE_CHANGELOG_VERSION: '9.9.0',
  PRIVATE_CHANGELOG_MD: '# Vorath Changelog',
}))

import { getPrivateChangelog } from '../changelog-private'

describe('getPrivateChangelog', () => {
  beforeEach(() => {
    auth.mockReset()
    vi.unstubAllEnvs()
  })

  it('returns the log to the Vorath owner', async () => {
    vi.stubEnv('VORATH_USER_IDS', 'owner-1')
    auth.mockResolvedValue({ user: { id: 'owner-1' } })
    await expect(getPrivateChangelog()).resolves.toEqual({ version: '9.9.0', markdown: '# Vorath Changelog' })
  })

  it('returns null to any other signed-in user', async () => {
    vi.stubEnv('VORATH_USER_IDS', 'owner-1')
    auth.mockResolvedValue({ user: { id: 'tester-2', vorath: true } })
    await expect(getPrivateChangelog()).resolves.toBeNull()
  })

  it('returns null when signed out', async () => {
    vi.stubEnv('VORATH_USER_IDS', 'owner-1')
    auth.mockResolvedValue(null)
    await expect(getPrivateChangelog()).resolves.toBeNull()
  })

  it('returns null in production when no owner is configured', async () => {
    vi.stubEnv('VORATH_USER_IDS', '')
    vi.stubEnv('KAIROS_OPERATOR_USER_ID', '')
    vi.stubEnv('NODE_ENV', 'production')
    auth.mockResolvedValue({ user: { id: 'owner-1' } })
    await expect(getPrivateChangelog()).resolves.toBeNull()
  })
})
