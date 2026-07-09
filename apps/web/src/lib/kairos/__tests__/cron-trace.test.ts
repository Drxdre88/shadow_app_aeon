import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

import { writeCronFailureTrace } from '../cron-trace'
import { captureMemory } from '@/lib/data/memories'

const USER_ID = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('writeCronFailureTrace', () => {
  it('writes a streamClass:trace memory carrying cronName + reason', async () => {
    await writeCronFailureTrace(USER_ID, { cronName: 'cortex-regen', reason: 'empty_response' })

    expect(captureMemory).toHaveBeenCalledTimes(1)
    const [userId, input] = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(userId).toBe(USER_ID)
    expect(input.streamClass).toBe('trace')
    expect(input.source).toBe('system')
    expect(input.dominionId).toBeNull()
    expect(input.sourceMetadata).toMatchObject({ cronName: 'cortex-regen', reason: 'empty_response' })
  })

  it('serialises an Error into message + stack on the trace body', async () => {
    const err = new Error('boom')
    await writeCronFailureTrace(USER_ID, { cronName: 'aether-regen', reason: 'parse_failed', error: err })

    const input = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(input.sourceMetadata.error).toBe('boom')
    expect(typeof input.sourceMetadata.stack).toBe('string')
  })

  it('carries dominionId + durationMs through when provided', async () => {
    await writeCronFailureTrace(USER_ID, {
      cronName: 'archetype-synthesis',
      dominionId: 'dom-1',
      reason: 'persist_failed',
      durationMs: 42,
    })

    const input = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(input.dominionId).toBe('dom-1')
    expect(input.sourceMetadata.durationMs).toBe(42)
  })

  it('never throws when captureMemory itself fails', async () => {
    ;(captureMemory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'))
    await expect(
      writeCronFailureTrace(USER_ID, { cronName: 'cortex-regen', reason: 'empty_response' }),
    ).resolves.toBeUndefined()
  })
})
