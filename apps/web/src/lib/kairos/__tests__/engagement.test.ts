import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const selectQueue: unknown[][] = []
const sqlCalls: TemplateStringsArray[] = []

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  const sqlSpy = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    sqlCalls.push(strings)
    return actual.sql(strings, ...values)
  }) as typeof actual.sql
  Object.assign(sqlSpy, actual.sql)
  return { ...actual, sql: sqlSpy }
})

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

function outbound(hours: number, status = 'pending', repliedAfterHours?: number, kind = 'question') {
  const createdAt = hoursAgo(hours)
  const sourceMetadata: Record<string, unknown> = { kairosSpeak: true, status, kind }
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
  sqlCalls.length = 0
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

  it('gates only on questions: the lastOutbound query filters kind=question, the cadence query does not', async () => {
    selectQueue.push([])
    selectQueue.push([])

    await getConversationState(USER)

    const predicates = sqlCalls.map((strings) => Array.from(strings).join(' '))
    const kindQuestion = predicates.filter((text) => text.includes("->>'kind' = 'question'"))
    const opsAlertExclusions = predicates.filter((text) => text.includes("->>'opsAlert'") && text.includes('IS DISTINCT FROM'))
    const digestExclusions = predicates.filter((text) => text.includes("->>'digest'") && text.includes('IS DISTINCT FROM'))

    // Gate query carries the kind predicate (which subsumes opsAlert/digest);
    // the cadence query keeps its opsAlert/digest exclusions and no kind filter.
    expect(kindQuestion.length).toBe(1)
    expect(opsAlertExclusions.length).toBe(1)
    expect(digestExclusions.length).toBe(1)
  })

  it('does not arm the gate on notify-only history while still counting it for cadence', async () => {
    // The gate query filters to kind=question at the DB, so notify-only history
    // yields no lastOutbound row; the cadence query still returns the notifies.
    const notifies = [outbound(2, 'pending', undefined, 'notify'), outbound(10, 'pending', undefined, 'notify')]
    selectQueue.push([])
    selectQueue.push(notifies)
    selectQueue.push([])

    const state = await getConversationState(USER)

    expect(state.lastOutbound).toBeNull()
    expect(state.awaitingReply).toBe(false)
    expect(state.replyRate7d).toBe(0)
  })

  it('arms the gate on an unanswered recent question behind newer notifies', async () => {
    const question = outbound(20)
    selectQueue.push([question])
    selectQueue.push([outbound(2, 'pending', undefined, 'notify'), question])
    selectQueue.push([])
    selectQueue.push([])

    const state = await getConversationState(USER)

    expect(state.lastOutbound?.id).toBe(question.id)
    expect(state.awaitingReply).toBe(true)
  })
})
