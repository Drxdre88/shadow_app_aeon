import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bypass the action's auth dependency without touching the full helpers chain.
vi.mock('../helpers', () => ({
  requireAuth: vi.fn(),
  requireAiAccess: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({ buildModelWithKey: vi.fn() }))

// presenceFor reads userAiCredentials + userAiPreferences via Drizzle. Stub
// the chain so each db.select() call can be programmed per-test.
let credentialRows: Array<{ provider: string }> = []
let preferenceRows: Array<{ heavyProviderId: string }> = []
let selectCallCount = 0

vi.mock('@/lib/db', () => {
  const select = () => {
    const idx = selectCallCount++
    const rows = idx === 0 ? credentialRows : preferenceRows
    return {
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
          limit: async () => rows,
        }),
      }),
    }
  }
  return { db: { select } }
})

vi.mock('@/lib/db/schema', () => ({
  userAiCredentials: new Proxy({}, { get: () => ({}) }),
  userAiPreferences: new Proxy({}, { get: () => ({}) }),
}))

vi.mock('@/lib/ai/crypto', () => ({
  encryptSecret: vi.fn(),
  keyHint: vi.fn(),
}))

import { hasAiCredentials } from '../ai-credentials'
import { requireAuth } from '../helpers'

const mockRequireAuth = vi.mocked(requireAuth)

function programDb(creds: Array<{ provider: string }>, heavyProviderId?: string) {
  credentialRows = creds
  preferenceRows = heavyProviderId ? [{ heavyProviderId }] : []
  selectCallCount = 0
}

describe('hasAiCredentials (action)', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset()
    selectCallCount = 0
  })

  it('uses requireAuth (not requireAiAccess) — non-admin users can call it', async () => {
    mockRequireAuth.mockResolvedValue('user-1')
    programDb([])
    await expect(hasAiCredentials()).resolves.toEqual({
      hasAny: false,
      configured: [],
      activeProvider: null,
    })
    expect(mockRequireAuth).toHaveBeenCalledOnce()
  })

  it('returns presence shape for an admin with a wired key', async () => {
    mockRequireAuth.mockResolvedValue('admin-1')
    programDb([{ provider: 'anthropic' }], 'anthropic')
    await expect(hasAiCredentials()).resolves.toEqual({
      hasAny: true,
      configured: ['anthropic'],
      activeProvider: 'anthropic',
    })
  })

  it('propagates the Unauthorized throw when requireAuth rejects', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'))
    await expect(hasAiCredentials()).rejects.toThrow(/unauthorized/i)
  })
})

describe('presenceFor branch matrix (via hasAiCredentials)', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset()
    mockRequireAuth.mockResolvedValue('user-1')
    selectCallCount = 0
  })

  it('no credentials → hasAny:false and no active provider', async () => {
    programDb([])
    await expect(hasAiCredentials()).resolves.toEqual({
      hasAny: false, configured: [], activeProvider: null,
    })
  })

  it('heavy-tier provider is wired → it is the active provider', async () => {
    programDb([{ provider: 'openai' }, { provider: 'anthropic' }], 'anthropic')
    const res = await hasAiCredentials()
    expect(res.hasAny).toBe(true)
    expect(new Set(res.configured)).toEqual(new Set(['anthropic', 'openai']))
    expect(res.activeProvider).toBe('anthropic')
  })

  it('heavy-tier provider not wired → falls back to first configured', async () => {
    programDb([{ provider: 'openai' }], 'anthropic')
    await expect(hasAiCredentials()).resolves.toEqual({
      hasAny: true, configured: ['openai'], activeProvider: 'openai',
    })
  })

  it('preferences row missing → default heavy is anthropic; if not wired, falls back to first', async () => {
    programDb([{ provider: 'openai' }])
    const res = await hasAiCredentials()
    expect(res.hasAny).toBe(true)
    expect(res.configured).toEqual(['openai'])
    expect(res.activeProvider).toBe('openai')
  })

  it('duplicate rows for the same provider are deduped in configured', async () => {
    programDb([{ provider: 'anthropic' }, { provider: 'anthropic' }], 'anthropic')
    const res = await hasAiCredentials()
    expect(res.configured).toEqual(['anthropic'])
    expect(res.activeProvider).toBe('anthropic')
  })
})
