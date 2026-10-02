import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

const m = vi.hoisted(() => ({ getProviderForUser: vi.fn() }))

vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: m.getProviderForUser }))
vi.mock('@/lib/ai/router', () => {
  class AiCredentialMissingError extends Error {}
  class AiCredentialDecryptError extends Error {}
  class PaidBackupOffError extends AiCredentialMissingError {
    constructor() { super('paid backup off'); this.name = 'PaidBackupOffError' }
  }
  return { AiCredentialMissingError, AiCredentialDecryptError, PaidBackupOffError }
})

import { AiCredentialMissingError, PaidBackupOffError } from '@/lib/ai/router'
import { askPaidAndParse } from '../paid-fallback'

const job = { userId: 'u1', input: { system: 's', prompt: 'p' } } as unknown as ThinkingJobRow
const opts = { parse: (t: string) => t, label: 'x', maxTokens: 10, repairContext: 'ctx' }

beforeEach(() => vi.clearAllMocks())

describe('askPaidAndParse — paid backup switch', () => {
  it('off: declines with a clear "paid backup off" note', async () => {
    m.getProviderForUser.mockRejectedValue(new (PaidBackupOffError as unknown as new () => Error)())
    expect(await askPaidAndParse(job, opts)).toEqual({ ok: false, reason: 'paid backup off' })
  })

  it('no key still reads as no key', async () => {
    m.getProviderForUser.mockRejectedValue(new (AiCredentialMissingError as unknown as new () => Error)())
    expect(await askPaidAndParse(job, opts)).toEqual({ ok: false, reason: 'no BYOK credential' })
  })

  it('on: the paid call runs and parses', async () => {
    m.getProviderForUser.mockResolvedValue({ ask: vi.fn(async () => ({ text: ' answer ' })) })
    expect(await askPaidAndParse(job, opts)).toEqual({ ok: true, value: 'answer' })
    expect(m.getProviderForUser).toHaveBeenCalledWith('u1', 'heavy')
  })
})
