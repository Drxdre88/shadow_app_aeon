import { describe, it, expect, vi } from 'vitest'
import { isTransientError, withRetry } from '../persistMutation'

describe('isTransientError', () => {
  it('flags retryable connection failures', () => {
    for (const m of ['fetch failed', 'Connection terminated', 'ETIMEDOUT', 'upstream 503', 'socket hang up']) {
      expect(isTransientError(new Error(m))).toBe(true)
    }
  })

  it('does NOT retry real rejections', () => {
    for (const m of ['Viewers cannot modify this project', 'User is not a member of this project', 'invalid input']) {
      expect(isTransientError(new Error(m))).toBe(false)
    }
  })

  it('treats non-Error throwables as non-transient', () => {
    expect(isTransientError('boom')).toBe(false)
    expect(isTransientError(null)).toBe(false)
  })
})

describe('withRetry', () => {
  it('returns immediately on success without retrying', async () => {
    const run = vi.fn().mockResolvedValue('ok')
    await expect(withRetry(run)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('fails fast on a non-transient error (no retry)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('Viewers cannot modify this project'))
    await expect(withRetry(run)).rejects.toThrow('Viewers cannot modify')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('retries a transient error then succeeds', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce('recovered')
    const onRetry = vi.fn()
    await expect(withRetry(run, onRetry)).resolves.toBe('recovered')
    expect(run).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
