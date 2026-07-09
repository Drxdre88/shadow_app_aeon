import { describe, it, expect, vi } from 'vitest'

// router.ts (source of the credential-error classes) imports '@/lib/db' at
// module scope, which throws outside a real DB env — stub it, unused here.
vi.mock('@/lib/db', () => ({ db: {} }))

import { withRetry } from '../retry'
import { AiCredentialMissingError, AiCredentialDecryptError } from '../router'

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { baseDelayMs: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries once on a transient failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok')
    const result = await withRetry(fn, { attempts: 2, baseDelayMs: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws the last error after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('still broken'))
    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 0 })).rejects.toThrow('still broken')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry a missing-credential error', async () => {
    const fn = vi.fn().mockRejectedValue(new AiCredentialMissingError('anthropic'))
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toBeInstanceOf(AiCredentialMissingError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not retry an undecryptable-credential error', async () => {
    const fn = vi.fn().mockRejectedValue(new AiCredentialDecryptError('anthropic'))
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toBeInstanceOf(AiCredentialDecryptError)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
