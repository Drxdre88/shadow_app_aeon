import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectQueue: unknown[][] = []
const insertedValues: Array<Record<string, unknown>> = []
const updates: Array<{ set: Record<string, unknown> }> = []
const executed: unknown[] = []

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
  function updateChain() {
    const chain: Record<string, unknown> = {}
    chain.set = (set: Record<string, unknown>) => {
      updates.push({ set })
      return chain
    }
    chain.where = () => chain
    chain.then = (resolve: (value: unknown) => unknown) => resolve(undefined)
    return chain
  }
  const db: Record<string, unknown> = {
    select: vi.fn(() => selectChain(selectQueue.shift() ?? [])),
    insert: vi.fn(() => insertChain()),
    update: vi.fn(() => updateChain()),
    execute: vi.fn(async (q: unknown) => {
      executed.push(q)
      return { rows: [] }
    }),
  }
  db.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db))
  return { db }
})

import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  createKairosAskMemory,
  getOpenKairosAskById,
  getPendingKairosAsk,
  listOpenKairosAsks,
  listRecentKairosAsks,
} from '../ask'

const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)

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
  updates.length = 0
  executed.length = 0
})

describe('ask-mine ask storage', () => {
  it('stamps provenance, expiry, and external id through the existing ask writer', async () => {
    selectQueue.push([], [{ max: 11 }])

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

  it('numbers the new ask max + 1 inside one transaction under the per-user seq lock', async () => {
    selectQueue.push([{ max: 11 }])

    await createKairosAskMemory(USER_ID, {
      question: 'Q?',
      dominionId: null,
      aetherMemoryId: '',
      sourceThoughtId: null,
      sourceMemoryIds: [],
      askedAt: ASKED_AT,
    })

    expect(db.transaction).toHaveBeenCalledTimes(1)
    const lock = render(executed[0])
    expect(lock.sql).toContain('pg_advisory_xact_lock(hashtext($1), hashtext($2))')
    expect(lock.params).toEqual([USER_ID, 'kairos-ask-seq'])
    expect((insertedValues[0].sourceMetadata as { kairosAsk: { seq: number } }).kairosAsk.seq).toBe(12)
  })

  it('starts numbering at Q10 for a user with no asks (Q1–Q4 read like quarters)', async () => {
    selectQueue.push([{ max: 0 }])
    await createKairosAskMemory(USER_ID, {
      question: 'Q?', dominionId: null, aetherMemoryId: '', sourceThoughtId: null, sourceMemoryIds: [], askedAt: ASKED_AT,
    })
    expect((insertedValues[0].sourceMetadata as { kairosAsk: { seq: number } }).kairosAsk.seq).toBe(10)
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

describe('open-ask backlog', () => {
  const NOW = new Date('2026-07-20T04:30:00.000Z')

  function openRow(id: string, seq: number | undefined, createdAt: string, expiresAt = '2026-08-02T04:30:00.000Z') {
    const row = storedAsk(expiresAt)
    return {
      ...row,
      id,
      createdAt: new Date(createdAt),
      sourceMetadata: { ...row.sourceMetadata, kairosAsk: { ...row.sourceMetadata.kairosAsk, ...(seq ? { seq } : {}) } },
    }
  }

  it('lists open asks oldest first, drops time-expired ones, and numbers a legacy ask lazily', async () => {
    selectQueue.push(
      [
        openRow('ask-legacy', undefined, '2026-07-10T04:30:00.000Z'),
        openRow('ask-12', 12, '2026-07-18T04:30:00.000Z'),
        openRow('ask-stale', 3, '2026-07-01T04:30:00.000Z', '2026-07-15T04:30:00.000Z'),
      ],
      // assignMissingAskSeqs: re-read under the lock, then max seq.
      [{ id: 'ask-legacy', seq: null }],
      [{ max: 12 }],
    )

    const open = await listOpenKairosAsks(USER_ID, NOW)

    expect(open.map((a) => [a.id, a.seq])).toEqual([['ask-legacy', 13], ['ask-12', 12]])
    expect(open[0].kairosAsk.seq).toBe(13)
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(updates).toHaveLength(1)
    expect(render(updates[0].set.sourceMetadata).sql).toContain("'{kairosAsk,seq}'")
  })

  it('does not write when every open ask already has a number', async () => {
    selectQueue.push([openRow('ask-12', 12, '2026-07-18T04:30:00.000Z')])
    const open = await listOpenKairosAsks(USER_ID, NOW)
    expect(open.map((a) => a.seq)).toEqual([12])
    expect(db.transaction).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('getOpenKairosAskById returns an open ask by id, null once it is past expiry', async () => {
    selectQueue.push([openRow('ask-12', 12, '2026-07-18T04:30:00.000Z')])
    await expect(getOpenKairosAskById(USER_ID, 'ask-12', NOW)).resolves.toMatchObject({ id: 'ask-12' })
    selectQueue.push([openRow('ask-3', 3, '2026-07-01T04:30:00.000Z', '2026-07-15T04:30:00.000Z')])
    await expect(getOpenKairosAskById(USER_ID, 'ask-3', NOW)).resolves.toBeNull()
    selectQueue.push([])
    await expect(getOpenKairosAskById(USER_ID, 'missing', NOW)).resolves.toBeNull()
  })
})
