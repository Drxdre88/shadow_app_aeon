import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectQueue: unknown[][] = []
const insertedValues: Array<Record<string, unknown>> = []

vi.mock('@/lib/db', () => {
  function selectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  function insertChain() {
    const chain: Record<string, unknown> = {}
    chain.values = (values: Record<string, unknown>) => {
      insertedValues.push(values)
      return chain
    }
    chain.returning = () => Promise.resolve([{ id: 'ask-new' }])
    return chain
  }
  return {
    db: {
      select: vi.fn(() => selectChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => insertChain()),
    },
  }
})

import { createKairosAskMemory, getPendingKairosAsk, listRecentKairosAsks } from '../ask'

const USER_ID = 'user-1'
const ASKED_AT = '2026-07-19T04:30:00.000Z'
const EXPIRES_AT = '2026-07-22T04:30:00.000Z'

function storedAsk(expiresAt = EXPIRES_AT) {
  return {
    id: 'ask-1',
    title: 'Should Atlas ship this week?',
    summary: null,
    dominionId: 'dominion-1',
    createdAt: new Date(ASKED_AT),
    sourceMetadata: {
      kairosAsk: {
        status: 'pending',
        aetherMemoryId: 'aether-1',
        sourceThoughtId: null,
        sourceMemoryIds: ['memory-1'],
        dominionId: 'dominion-1',
        askedAt: ASKED_AT,
        expiresAt,
      },
      kairosAskStatus: 'pending',
      askMine: {
        date: '2026-07-19',
        kind: 'decision',
        sourceMemoryIds: ['memory-1'],
        leverage: 0.91,
      },
      expiresAt,
      externalId: 'ask-mine:2026-07-19:1',
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  insertedValues.length = 0
})

describe('ask-mine ask storage', () => {
  it('stamps provenance, expiry, and external id through the existing ask writer', async () => {
    selectQueue.push([])

    await createKairosAskMemory(USER_ID, {
      question: 'Should Atlas ship this week?',
      dominionId: 'dominion-1',
      aetherMemoryId: 'aether-1',
      sourceThoughtId: null,
      sourceMemoryIds: ['memory-1'],
      askedAt: ASKED_AT,
      expiresAt: EXPIRES_AT,
      externalId: 'ask-mine:2026-07-19:1',
      askMine: {
        date: '2026-07-19',
        kind: 'decision',
        sourceMemoryIds: ['memory-1'],
        leverage: 0.91,
      },
    })

    expect(insertedValues[0].sourceMetadata).toMatchObject({
      kairosAsk: { expiresAt: EXPIRES_AT },
      askMine: {
        date: '2026-07-19',
        kind: 'decision',
        sourceMemoryIds: ['memory-1'],
        leverage: 0.91,
      },
      expiresAt: EXPIRES_AT,
      externalId: 'ask-mine:2026-07-19:1',
    })
  })

  it('returns the existing daily ask id without inserting again', async () => {
    selectQueue.push([{ id: 'ask-existing' }])

    const id = await createKairosAskMemory(USER_ID, {
      question: 'Should Atlas ship this week?',
      dominionId: null,
      aetherMemoryId: 'aether-1',
      sourceThoughtId: null,
      sourceMemoryIds: ['memory-1'],
      askedAt: ASKED_AT,
      externalId: 'ask-mine:2026-07-19:1',
    })

    expect(id).toBe('ask-existing')
    expect(insertedValues).toEqual([])
  })

  it('keeps expired asks in recent history but out of the pending slot', async () => {
    const expired = storedAsk('2026-07-18T04:30:00.000Z')
    selectQueue.push([expired], [expired])

    const pending = await getPendingKairosAsk(USER_ID)
    const recent = await listRecentKairosAsks(USER_ID, 14, new Date('2026-07-19T04:30:00.000Z'))

    expect(pending).toBeNull()
    expect(recent[0]).toMatchObject({
      id: 'ask-1',
      kairosAsk: { status: 'expired' },
      askMine: { kind: 'decision' },
    })
  })
})
