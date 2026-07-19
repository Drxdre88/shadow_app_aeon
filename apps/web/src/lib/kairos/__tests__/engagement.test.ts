import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeSelectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.innerJoin = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows)
    return chain
  }

  return {
    db: {
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
    },
  }
})

import { getConversationState } from '../engagement'

const USER = 'user-1'
const NOW = new Date('2026-07-19T12:00:00.000Z')

function hoursAgo(hours: number) {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000)
}

function outbound(hours: number, status = 'pending', repliedAfterHours?: number) {
  const createdAt = hoursAgo(hours)
  const sourceMetadata: Record<string, unknown> = { kairosSpeak: true, status }
  if (repliedAfterHours !== undefined) {
    sourceMetadata.repliedAt = new Date(
      createdAt.getTime() + repliedAfterHours * 60 * 60 * 1000,
    ).toISOString()
  }
  return {
    id: `outbound-${hours}`,
    title: `Speak ${hours}`,
    createdAt,
    sourceMetadata,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  selectQueue.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getConversationState', () => {
  it('returns an idle state when there is no outbound history', async () => {
    selectQueue.push([])
    selectQueue.push([])

    await expect(getConversationState(USER)).resolves.toEqual({
      lastOutbound: null,
      replied: false,
      awaitingReply: false,
      replyRate7d: 0,
    })
  })

  it('recognises a user chat turn after the latest outbound as a reply', async () => {
    const latest = outbound(2)
    selectQueue.push([latest])
    selectQueue.push([latest])
    selectQueue.push([{ createdAt: hoursAgo(1) }])
    selectQueue.push([{ createdAt: hoursAgo(1) }])

    const state = await getConversationState(USER)

    expect(state.replied).toBe(true)
    expect(state.awaitingReply).toBe(false)
    expect(state.replyRate7d).toBe(1)
  })

  it('recognises the outbound memory status as a reply signal', async () => {
    const latest = outbound(2, 'dismissed')
    selectQueue.push([latest])
    selectQueue.push([latest])

    const state = await getConversationState(USER)

    expect(state.lastOutbound?.status).toBe('dismissed')
    expect(state.replied).toBe(true)
    expect(state.awaitingReply).toBe(false)
  })

  it('waits when the latest outbound is unreplied and less than 48 hours old', async () => {
    const latest = outbound(47)
    selectQueue.push([latest])
    selectQueue.push([latest])
    selectQueue.push([])
    selectQueue.push([])

    const state = await getConversationState(USER)

    expect(state.replied).toBe(false)
    expect(state.awaitingReply).toBe(true)
  })

  it('expires the wait window once an unreplied outbound is 48 hours old', async () => {
    const latest = outbound(48)
    selectQueue.push([latest])
    selectQueue.push([latest])
    selectQueue.push([])
    selectQueue.push([])

    const state = await getConversationState(USER)

    expect(state.replied).toBe(false)
    expect(state.awaitingReply).toBe(false)
  })

  it('computes the seven-day rate from mixed status and chat outcomes', async () => {
    const recent = [
      outbound(24, 'replied', 2), // timely stamped reply — status credit
      outbound(48), // pending, but a chat turn lands 12h later — chat credit
      outbound(96, 'replied', 40), // stamped 40h late — resolves, no rate credit
      outbound(144, 'accepted'), // inbox action, no timing evidence — no credit
    ]
    selectQueue.push([recent[0]])
    selectQueue.push(recent)
    selectQueue.push([{ createdAt: hoursAgo(36) }])

    const state = await getConversationState(USER)

    expect(state.replyRate7d).toBe(0.5)
  })
})
