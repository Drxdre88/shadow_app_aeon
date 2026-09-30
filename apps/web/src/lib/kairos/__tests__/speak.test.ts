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
import { capSpeakMessage, deliverKairosSpeak, SPEAK_MESSAGE_MAX_CHARS } from '../speak'

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

describe('deliverKairosSpeak — cadence backoff without a question outstanding', () => {
  it('backs off to one-per-72h after three unanswered notifies even when lastOutbound is null', async () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000)
    // Notify-only history: the reply gate tracks questions only, so lastOutbound is null.
    vi.mocked(getConversationState).mockResolvedValue(idleState({ lastOutbound: null, replyRate7d: 0 }) as never)
    vi.mocked(listRecentKairosSpeaks)
      .mockResolvedValueOnce([
        { id: 'n1', title: 'a', createdAt: hoursAgo(30) },
        { id: 'n2', title: 'b', createdAt: hoursAgo(80) },
        { id: 'n3', title: 'c', createdAt: hoursAgo(120) },
      ] as never)
      .mockResolvedValueOnce([{ id: 'n1', title: 'a', createdAt: hoursAgo(30) }] as never)

    const outcome = await deliverKairosSpeak(OPERATOR, {
      title: 't', message: 'm', kind: 'notify', urgency: 'normal',
      force: false, opsAlert: false, digest: false,
    })

    expect(outcome.status).toBe(429)
    expect(listRecentKairosSpeaks).toHaveBeenNthCalledWith(1, OPERATOR, { hours: 168, limit: 3 })
    expect(listRecentKairosSpeaks).toHaveBeenNthCalledWith(2, OPERATOR, { hours: 72, limit: 10 })
    expect(captureMemory).not.toHaveBeenCalled()
  })
})

describe('deliverKairosSpeak — message length cap (A1 defence)', () => {
  it('passes messages at or under the cap through unchanged', async () => {
    const message = 'x'.repeat(SPEAK_MESSAGE_MAX_CHARS)
    await deliverKairosSpeak(OPERATOR, {
      title: 't', message, kind: 'notify', urgency: 'normal',
      force: false, opsAlert: false, digest: false,
    })

    const [, input] = vi.mocked(captureMemory).mock.calls[0]
    expect(input.bodyMd).toBe(message)
    expect(vi.mocked(sendKairosSpeak).mock.calls[0][0].message).toBe(message)
  })

  it('truncates an oversized message at a word boundary with an ellipsis before storing and sending', async () => {
    const message = 'word '.repeat(2000) // 10,000 chars
    const outcome = await deliverKairosSpeak(OPERATOR, {
      title: 't', message, kind: 'notify', urgency: 'normal',
      force: false, opsAlert: false, digest: true,
    })

    expect(outcome.status).toBe(200)
    const [, input] = vi.mocked(captureMemory).mock.calls[0]
    const stored = input.bodyMd as string
    expect(stored.length).toBeLessThanOrEqual(SPEAK_MESSAGE_MAX_CHARS)
    expect(stored.endsWith('word…')).toBe(true)
    expect(vi.mocked(sendKairosSpeak).mock.calls[0][0].message).toBe(stored)
  })
})

describe('capSpeakMessage', () => {
  it('hard-cuts when no boundary exists in the tail of the budget', () => {
    const capped = capSpeakMessage('a'.repeat(50), 20)
    expect(capped).toBe(`${'a'.repeat(19)}…`)
  })

  it('prefers a paragraph/line boundary near the cut', () => {
    const capped = capSpeakMessage(`${'a'.repeat(16)}\n${'b'.repeat(40)}`, 20)
    expect(capped).toBe(`${'a'.repeat(16)}…`)
  })
})
