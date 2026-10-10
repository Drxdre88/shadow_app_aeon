import { beforeEach, describe, expect, it, vi } from 'vitest'

// The voice line's task: Sonnet 5.5 pinned (not the heavy chat tier), and the
// paid-backup switch does not apply because the owner is speaking. Normal chat
// keeps its route and the switch.
const h = vi.hoisted(() => ({ selects: [] as unknown[][], enabled: false, build: vi.fn((modelId: string) => ({ modelId })) }))

vi.mock('@/lib/db', () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.orderBy = () => c
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
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => h.build) }))

import registry from '@aeon/shared/ai/model-registry.json'
import { isPaidBackupEnabled } from '@/lib/kairos/paid-backup'
import { getProviderForTask, routeTask } from '../route-task'
import { AiCredentialMissingError, PaidBackupOffError } from '../router'

const CRED = { id: 'c1', ciphertext: 'x', iv: 'y', authTag: 'z' }
const PREFS = {
  cheapProviderId: 'anthropic', cheapModelId: 'claude-haiku-4-5',
  standardProviderId: 'anthropic', standardModelId: 'claude-opus-5-5',
  heavyProviderId: 'anthropic', heavyModelId: 'claude-opus-5-5',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.selects = []
  h.enabled = false
})

describe('voice_chat task route', () => {
  it('pins Claude Sonnet 5.5, an id the shared registry lists as current', async () => {
    const decision = await routeTask('u1', { taskType: 'voice_chat' })
    expect(decision).toEqual({ providerId: 'byok', modelId: 'claude-sonnet-5-5', tier: 'standard', source: 'default' })
    const entry = registry.models.find((m) => m.id === 'claude-sonnet-5-5')
    expect(entry).toMatchObject({ provider: 'anthropic', status: 'current' })
  })

  it('uses the owner key with paid backup OFF, ignoring tier prefs', async () => {
    h.selects = [[], [CRED]] // no engine_policies rows, then the credential
    const { provider } = await getProviderForTask('u1', { taskType: 'voice_chat' })
    expect(provider.modelId).toBe('claude-sonnet-5-5')
    expect(h.build).toHaveBeenCalledWith('claude-sonnet-5-5')
    expect(isPaidBackupEnabled).not.toHaveBeenCalled()
  })

  it('still needs a usable key', async () => {
    h.selects = [[], []]
    await expect(getProviderForTask('u1', { taskType: 'voice_chat' })).rejects.toBeInstanceOf(AiCredentialMissingError)
  })
})

describe('normal chat is unchanged', () => {
  it('routes heavy with no pinned model', async () => {
    expect(await routeTask('u1', { taskType: 'chat' })).toEqual({ providerId: 'byok', modelId: null, tier: 'heavy', source: 'default' })
  })

  it('declines with paid backup off', async () => {
    h.selects = [[], [PREFS], [CRED]]
    const err = await getProviderForTask('u1', { taskType: 'chat' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PaidBackupOffError)
    expect(isPaidBackupEnabled).toHaveBeenCalledWith('u1')
  })

  it('with paid backup on resolves the heavy tier preference', async () => {
    h.enabled = true
    h.selects = [[], [PREFS], [CRED]]
    const { provider } = await getProviderForTask('u1', { taskType: 'chat' })
    expect(provider.modelId).toBe('tier:heavy')
  })
})
