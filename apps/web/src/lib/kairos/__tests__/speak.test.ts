import { beforeEach, describe, expect, it, vi } from 'vitest'

// deliverKairosSpeak — throttle logic (pre-existing) + externalId dedup (F2,
// horsemen review). Mirrors the mocking pattern in synthesis-health.test.ts
// (mocked captureMemory/deliverKairosSpeak collaborators) but exercises
// speak.ts itself rather than mocking it away.

vi.mock('@/lib/kairos/engagement', () => ({
  AWAIT_WINDOW_HOURS: 48,
  getConversationState: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
  listRecentKairosSpeaks: vi.fn(),
}))

vi.mock('@/lib/kairos/telegram', () => ({
  sendKairosSpeak: vi.fn(),
}))

import { getConversationState } from '@/lib/kairos/engagement'
import { captureMemory, listRecentKairosSpeaks } from '@/lib/data/memories'
import { sendKairosSpeak } from '@/lib/kairos/telegram'
import { deliverKairosSpeak } from '../speak'

const OPERATOR = 'operator-1'

function idleState(overrides: Partial<{
  awaitingReply: boolean
  replyRate7d: number
  lastOutbound: { createdAt: Date } | null
}> = {}) {
  return { awaitingReply: false, replyRate7d: 0, lastOutbound: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConversationState).mockResolvedValue(idleState() as never)
  vi.mocked(listRecentKairosSpeaks).mockResolvedValue([])
  vi.mocked(sendKairosSpeak).mockResolvedValue(true)
  vi.mocked(captureMemory).mockImplementation(async (_userId, input) => ({
    memory: { id: 'memory-1', ...input } as never,
    created: true,
  }))
})

describe('deliverKairosSpeak — externalId dedup (F2)', () => {
  it('fans out to Telegram when captureMemory creates a fresh memory', async () => {
    const outcome = await deliverKairosSpeak(OPERATOR, {
      title: 't', message: 'm', kind: 'notify', urgency: 'normal',
      force: false, opsAlert: false, digest: false, externalId: 'x-1',
    })

    expect(outcome).toEqual({ status: 200, body: { id: 'memory-1', delivered: { inbox: true, telegram: true } } })
    expect(sendKairosSpeak).toHaveBeenCalledOnce()
  })

  it('skips Telegram fan-out and returns alreadyDelivered when captureMemory reports a dedup hit', async () => {
    vi.mocked(captureMemory).mockResolvedValue({ memory: { id: 'memory-existing' } as never, created: false })

    const outcome = await deliverKairosSpeak(OPERATOR, {
      title: 't', message: 'm', kind: 'notify', urgency: 'normal',
      force: true, opsAlert: false, digest: true, externalId: 'kairos-digest:2026-07-24',
    })

    expect(outcome).toEqual({
      status: 200,
      body: { id: 'memory-existing', delivered: { inbox: false, telegram: false }, alreadyDelivered: true },
    })
    expect(sendKairosSpeak).not.toHaveBeenCalled()
  })

  it('forwards externalId into captureMemory sourceMetadata', async () => {
    await deliverKairosSpeak(OPERATOR, {
      title: 't', message: 'm', kind: 'notify', urgency: 'normal',
      force: false, opsAlert: false, digest: false, externalId: 'my-id',
    })

    expect(captureMemory).toHaveBeenCalledWith(OPERATOR, expect.objectContaining({
      sourceMetadata: expect.objectContaining({ externalId: 'my-id' }),
    }))
  })

  it('leaves existing callers without externalId byte-identical (no externalId key, always fans out)', async () => {
    const outcome = await deliverKairosSpeak(OPERATOR, {
      title: 't', message: 'm', kind: 'notify', urgency: 'normal',
      force: false, opsAlert: false, digest: false,
    })

    const [, input] = vi.mocked(captureMemory).mock.calls[0]
    expect(input.sourceMetadata).not.toHaveProperty('externalId')
    expect(outcome).toEqual({ status: 200, body: { id: 'memory-1', delivered: { inbox: true, telegram: true } } })
  })
})

describe('deliverKairosSpeak — throttle (unchanged behavior)', () => {
  it('returns 429 without calling captureMemory when awaitingReply blocks a normal-urgency send', async () => {
    vi.mocked(getConversationState).mockResolvedValue(idleState({
      awaitingReply: true,
      lastOutbound: { createdAt: new Date() },
    }) as never)

    const outcome = await deliverKairosSpeak(OPERATOR, {
      title: 't', message: 'm', kind: 'notify', urgency: 'normal',
      force: false, opsAlert: false, digest: false,
    })

    expect(outcome.status).toBe(429)
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('force:true bypasses awaitingReply but still throttles at the FORCE_CEILING of 10 forced-speaks/24h', async () => {
    vi.mocked(getConversationState).mockResolvedValue(idleState({
      awaitingReply: true,
      lastOutbound: { createdAt: new Date() },
    }) as never)
    vi.mocked(listRecentKairosSpeaks).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `s-${i}`, title: 't', createdAt: new Date() })) as never,
    )

    const outcome = await deliverKairosSpeak(OPERATOR, {
      title: 't', message: 'm', kind: 'notify', urgency: 'normal',
      force: true, opsAlert: false, digest: true,
    })

    expect(outcome.status).toBe(429)
    expect(captureMemory).not.toHaveBeenCalled()
  })
})
