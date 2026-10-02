import { beforeEach, describe, expect, it, vi } from 'vitest'

// The router's single choke point: getModelForUser (only reached through
// getProviderForUser, i.e. Kairos) declines when the paid backup is off.
const h = vi.hoisted(() => ({ selects: [] as unknown[][], enabled: true }))

vi.mock('@/lib/db', () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.limit = () => c
    c.set = () => c
    c.catch = () => Promise.resolve()
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return c
  }
  return { db: { select: vi.fn(() => chain(h.selects.shift() ?? [])), update: vi.fn(() => chain([])) } }
})
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => h.enabled) }))
vi.mock('../crypto', () => ({ decryptSecret: vi.fn(() => 'sk-test') }))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => (modelId: string) => ({ modelId })) }))

import { db } from '@/lib/db'
import { isPaidBackupEnabled } from '@/lib/kairos/paid-backup'
import { decryptSecret } from '../crypto'
import { AiCredentialMissingError, PaidBackupOffError, buildModelWithKey, getModelForUser, resolveModelForUser } from '../router'
import { isPaidBackupOffError } from '../paid-backup-off'

const CRED = { id: 'c1', ciphertext: 'x', iv: 'y', authTag: 'z' }

beforeEach(() => {
  vi.clearAllMocks()
  h.selects = []
  h.enabled = true
})

describe('getModelForUser — paid backup switch', () => {
  it('on: resolves and decrypts the saved key as before', async () => {
    h.selects = [[], [CRED]] // no tier prefs → defaults; then the credential
    const model = await getModelForUser('u1', 'heavy')
    expect(isPaidBackupEnabled).toHaveBeenCalledWith('u1')
    expect(decryptSecret).toHaveBeenCalledTimes(1)
    expect(model).toMatchObject({ modelId: expect.any(String) })
  })

  it('off: declines exactly like "no key", without touching the credential', async () => {
    h.enabled = false
    h.selects = [[], [CRED]]
    const err = await getModelForUser('u1', 'heavy').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PaidBackupOffError)
    expect(err).toBeInstanceOf(AiCredentialMissingError)
    expect(isPaidBackupOffError(err)).toBe(true)
    expect((err as Error).message).toBe('paid backup off')
    expect(decryptSecret).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  it('a plain missing key is not mistaken for the switch', () => {
    expect(isPaidBackupOffError(new AiCredentialMissingError('anthropic'))).toBe(false)
  })

  it('buildModelWithKey (credential test/save) ignores the switch', async () => {
    h.enabled = false
    await expect(buildModelWithKey('anthropic', 'claude-x', 'sk-direct')).resolves.toMatchObject({ modelId: 'claude-x' })
    expect(isPaidBackupEnabled).not.toHaveBeenCalled()
  })
})

// Saved prefs (and the DB column defaults) can name retired models; the router
// must never call one.
describe('resolveModelForUser — retired saved models', () => {
  const PREFS = {
    cheapProviderId: 'anthropic', cheapModelId: 'claude-haiku-4-5-20251001',
    standardProviderId: 'anthropic', standardModelId: 'claude-sonnet-4-6',
    heavyProviderId: 'anthropic', heavyModelId: 'claude-opus-4-7',
  }

  it('remaps a retired heavy model to Opus 5.5 at high effort', async () => {
    h.selects = [[PREFS], [CRED]]
    const resolved = await resolveModelForUser('u1', 'heavy')
    expect(resolved).toMatchObject({ providerId: 'anthropic', modelId: 'claude-opus-5-5', effort: 'high' })
    expect(resolved.model).toMatchObject({ modelId: 'claude-opus-5-5' })
  })

  it('remaps a retired standard model and sends no effort to Haiku', async () => {
    h.selects = [[PREFS], [CRED]]
    expect(await resolveModelForUser('u1', 'standard')).toMatchObject({ modelId: 'claude-sonnet-5-5', effort: 'medium' })
    h.selects = [[PREFS], [CRED]]
    expect(await resolveModelForUser('u1', 'cheap')).toMatchObject({ modelId: 'claude-haiku-4-5', effort: null })
  })

  it('with no saved prefs uses the registry defaults', async () => {
    h.selects = [[], [CRED]]
    expect(await resolveModelForUser('u1', 'standard')).toMatchObject({ modelId: 'claude-opus-5-5', effort: 'medium' })
  })
})
