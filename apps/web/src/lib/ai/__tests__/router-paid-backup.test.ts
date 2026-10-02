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
import { AiCredentialMissingError, PaidBackupOffError, buildModelWithKey, getModelForUser } from '../router'
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
