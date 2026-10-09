import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-verdict-deck', () => ({ readVerdictDeck: vi.fn() }))
vi.mock('../apply', () => ({
  applyDeckTokens: vi.fn(async (_u: string, _items: unknown, tokens: Array<{ n: number; verdict: string }>) =>
    tokens.map((t) => (t.verdict === 'skip' ? { n: t.n, status: 'skipped' } : { n: t.n, status: 'done', word: t.verdict === 'yes' ? 'kept' : 'dropped' }))),
}))

import { readVerdictDeck } from '@/lib/data/kairos-verdict-deck'
import { applyDeckTokens } from '../apply'
import { routeVerdictDeckReply } from '../telegram'
import type { VerdictDeck } from '../types'

const USER = 'u1'
const OWNER = '4242'
const SUNDAY = new Date('2026-10-11T09:00:00.000Z')
const MONDAY = new Date('2026-10-12T09:00:00.000Z')
const DECK: VerdictDeck = {
  v: 1, date: '2026-10-11', messageIds: [777],
  items: [{ n: 1, kind: 'idea', id: 'idea-1', label: null, title: 'Idea' }, { n: 2, kind: 'idea', id: 'idea-2', label: null, title: 'Other' }],
}
const send = vi.fn(async () => undefined)
const input = (body: string, replyTo: number | null = null, fromId: string | null = OWNER) => ({ body, replyToMessageId: replyTo, fromId, ownerId: OWNER })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readVerdictDeck).mockResolvedValue(DECK)
})

describe('routeVerdictDeckReply', () => {
  it('a reply to the deck message applies the verdicts and acks in one line', async () => {
    expect(await routeVerdictDeckReply(USER, input('1y 2n 3 skip', 777), send, MONDAY)).toBe(true)
    expect(applyDeckTokens).toHaveBeenCalledWith(USER, DECK.items, [
      { n: 1, verdict: 'yes' }, { n: 2, verdict: 'no' }, { n: 3, verdict: 'skip' },
    ], MONDAY)
    expect(send).toHaveBeenCalledWith('✓ 1 kept · ✓ 2 dropped · 3 skipped')
  })

  it('a bare deck message counts on the deck day only', async () => {
    expect(await routeVerdictDeckReply(USER, input('1y'), send, SUNDAY)).toBe(true)
    expect(await routeVerdictDeckReply(USER, input('1y'), send, MONDAY)).toBe(false)
  })

  it('without a reply to the deck, a "no" changes nothing and says so', async () => {
    expect(await routeVerdictDeckReply(USER, input('1y 2n'), send, SUNDAY)).toBe(true)
    expect(applyDeckTokens).toHaveBeenCalledWith(USER, DECK.items, [{ n: 1, verdict: 'yes' }], SUNDAY)
    expect(send).toHaveBeenCalledWith('✓ 1 kept · 2 not changed — reply to the deck to say no')
  })

  it('a failed ack after applying still keeps the text out of chat', async () => {
    send.mockRejectedValueOnce(new Error('telegram down'))
    expect(await routeVerdictDeckReply(USER, input('1y', 777), send, SUNDAY)).toBe(true)
  })

  it('a reply to some other message is not a deck reply', async () => {
    expect(await routeVerdictDeckReply(USER, input('1y', 555), send, SUNDAY)).toBe(false)
    expect(applyDeckTokens).not.toHaveBeenCalled()
  })

  it('non-deck text never reads the deck', async () => {
    for (const body of ['R3 right', 'Q4: yes', '3', 'see you at 10']) {
      expect(await routeVerdictDeckReply(USER, input(body, 777), send, SUNDAY)).toBe(false)
    }
    expect(readVerdictDeck).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('owner only; no stored deck or a failed read hands the text on', async () => {
    expect(await routeVerdictDeckReply(USER, input('1y', 777, '9999'), send, SUNDAY)).toBe(false)
    vi.mocked(readVerdictDeck).mockResolvedValueOnce(null)
    expect(await routeVerdictDeckReply(USER, input('1y', 777), send, SUNDAY)).toBe(false)
    vi.mocked(readVerdictDeck).mockRejectedValueOnce(new Error('db down'))
    expect(await routeVerdictDeckReply(USER, input('1y', 777), send, SUNDAY)).toBe(false)
    expect(applyDeckTokens).not.toHaveBeenCalled()
  })
})
