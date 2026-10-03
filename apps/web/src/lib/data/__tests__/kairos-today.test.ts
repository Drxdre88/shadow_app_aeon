import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// The today writer is a security + integrity boundary: one locked tx per
// write, dedupe on payload.key (upsert / coalesce), MAX(seq)+1 inserts and a
// 500-entry purge backstop. Reads stay user + engine scoped.

type Op = { op: string; arg?: unknown; where?: unknown; table?: unknown }

const ops: Op[] = []
const selectQueue: unknown[][] = []
let insertReturning: unknown[] = []

vi.mock('@/lib/db', () => {
  function chain(op: Op, rows: () => unknown[]) {
    const c: Record<string, unknown> = {}
    const pass = () => c
    c.from = pass
    c.innerJoin = pass
    c.orderBy = pass
    c.limit = pass
    c.values = (arg: unknown) => { op.arg = arg; return c }
    c.set = (arg: unknown) => { op.arg = arg; return c }
    c.where = (arg: unknown) => { op.where = arg; return c }
    c.returning = () => Promise.resolve(rows())
    c.then = (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows()).then(resolve, reject)
    return c
  }
  function makeDb() {
    const record = (name: string, rows: () => unknown[]) => (table?: unknown) => {
      const op: Op = { op: name, table }
      ops.push(op)
      return chain(op, rows)
    }
    return {
      execute: vi.fn(async (q: unknown) => { ops.push({ op: 'execute', arg: q }); return { rows: [] } }),
      select: vi.fn(() => record('select', () => selectQueue.shift() ?? [])()),
      insert: vi.fn(record('insert', () => insertReturning)),
      update: vi.fn(record('update', () => [])),
      delete: vi.fn(record('delete', () => [])),
    }
  }
  const base = makeDb()
  return { db: { ...base, transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeDb())) } }
})

import { db } from '@/lib/db'
import {
  writeTodayEntry,
  coalesceTodayPayload,
  listTodayEntries,
  toKairosTodayView,
  todayWindow,
  TODAY_ENGINE,
  type TodayEntryPayload,
} from '../kairos-today'

const dialect = new PgDialect()
const compile = (v: unknown) => dialect.sqlToQuery(v as SQL)
const USER = '10000000-0000-4000-8000-000000000001'
const PARENT = '20000000-0000-4000-8000-000000000001'

function payload(over: Partial<TodayEntryPayload> = {}): TodayEntryPayload {
  return {
    v: 1, key: 'chat:t1:3', channel: 'telegram', type: 'said', origin: { kind: 'operator', via: 'telegram' },
    speaker: 'owner', text: 'ship the gantt fix', covered: 'chat-distill', ...over,
  }
}

const opsNamed = (name: string) => ops.filter((o) => o.op === name)

beforeEach(() => {
  vi.clearAllMocks()
  ops.length = 0
  selectQueue.length = 0
  insertReturning = [{ id: PARENT }]
})

describe('writeTodayEntry', () => {
  it('takes the per-user advisory lock first, creates the parent and inserts at seq 1', async () => {
    selectQueue.push([], [], [])
    await writeTodayEntry(USER, payload())

    expect(db.transaction).toHaveBeenCalledTimes(1)
    const lock = compile(ops[0].arg)
    expect(ops[0].op).toBe('execute')
    expect(lock.sql).toContain('pg_advisory_xact_lock(hashtext($1), hashtext($2))')
    expect(lock.params).toEqual(['kairos-today', USER])

    const [parentInsert, eventInsert] = opsNamed('insert')
    expect(parentInsert.arg).toMatchObject({ userId: USER, engine: TODAY_ENGINE, goal: 'Kairos · today', prompt: '', status: 'running' })
    expect(eventInsert.arg).toMatchObject({ sessionId: PARENT, seq: 1, kind: 'kairos_today', toolName: 'telegram' })
    expect((eventInsert.arg as { payload: TodayEntryPayload }).payload.speaker).toBe('owner')
    expect(opsNamed('execute')).toHaveLength(1)
  })

  it('upserts an existing key in place instead of inserting a duplicate', async () => {
    selectQueue.push([{ id: PARENT }], [{ id: 'ev-1', payload: payload() }])
    await writeTodayEntry(USER, payload({ text: 'ship the gantt fix today' }))

    expect(opsNamed('insert')).toHaveLength(0)
    const [upd] = opsNamed('update')
    expect((upd.arg as { payload: TodayEntryPayload }).payload.text).toBe('ship the gantt fix today')
    const keyFilter = compile(opsNamed('select')[1].where)
    expect(keyFilter.sql).toContain("->>'key' =")
    expect(keyFilter.params).toContain('chat:t1:3')
  })

  it('coalesces counts and samples onto the existing key', async () => {
    const prev = payload({ key: 'mcp:abcd1234:search_memories:b', channel: 'mcp', type: 'used', speaker: 'agent', count: 49, samples: ['a', 'b'] })
    selectQueue.push([{ id: PARENT }], [{ id: 'ev-1', payload: prev }])
    await writeTodayEntry(USER, { ...prev, count: 1, samples: ['b', 'c', 'd'] }, 'coalesce')

    const next = (opsNamed('update')[0].arg as { payload: TodayEntryPayload }).payload
    expect(next.count).toBe(50)
    expect(next.samples).toEqual(['a', 'b', 'c'])
  })

  it('purges past the 500-entry cap only once seq exceeds it', async () => {
    selectQueue.push([{ id: PARENT }], [], [{ seq: 500 }])
    await writeTodayEntry(USER, payload())
    const purge = opsNamed('execute').slice(1)
    expect(purge).toHaveLength(1)
    const q = compile(purge[0].arg)
    expect(q.sql).toMatch(/delete from "session_events"/i)
    expect(q.sql).toMatch(/offset \$2/i)
    expect(q.params).toEqual([PARENT, 500])

    ops.length = 0
    selectQueue.push([{ id: PARENT }], [], [{ seq: 10 }])
    await writeTodayEntry(USER, payload())
    expect(opsNamed('execute')).toHaveLength(1)
  })
})

describe('coalesceTodayPayload', () => {
  it('treats a legacy entry without count as one prior use', () => {
    expect(coalesceTodayPayload({}, payload({ count: 1 })).count).toBe(2)
  })
})

describe('listTodayEntries', () => {
  it('scopes to the user + today engine, filters the window and returns oldest first', async () => {
    const now = new Date('2026-10-03T10:05:00Z')
    const rows = [
      { createdAt: new Date('2026-10-03T10:02:00Z'), toolName: 'web', payload: {} },
      { createdAt: new Date('2026-10-03T10:00:00Z'), toolName: 'telegram', payload: {} },
    ]
    selectQueue.push([...rows])
    const out = await listTodayEntries(USER, { hours: 24, limit: 50, now, excludeTypes: ['captured'], excludeThreadId: 'thread-9' })
    expect(out.map((r) => r.toolName)).toEqual(['telegram', 'web'])
    const q = compile(opsNamed('select')[0].where)
    expect(q.sql).toContain('"agent_sessions"."user_id" = $1')
    expect(q.params.slice(0, 3)).toEqual([USER, TODAY_ENGINE, 'kairos_today'])
    expect(q.params).toContain('captured')
    expect(q.params).toContain('thread-9')
  })

  it('clamps the window to 36h', () => {
    const now = new Date('2026-10-03T12:00:00Z')
    expect(todayWindow(500, now).from.toISOString()).toBe('2026-10-02T00:00:00.000Z')
    expect(todayWindow(0, now).from.toISOString()).toBe('2026-10-03T11:00:00.000Z')
  })
})

describe('toKairosTodayView', () => {
  const at = new Date('2026-10-03T10:00:00Z')

  it('maps a stored entry to the public view', () => {
    const view = toKairosTodayView({ createdAt: at, toolName: 'telegram', payload: { ...payload(), ref: { threadId: 't1', seq: 3, junk: 1 } } })
    expect(view).toEqual({ at: at.toISOString(), channel: 'telegram', type: 'said', speaker: 'owner', relayed: false, text: 'ship the gantt fix', ref: { threadId: 't1', seq: 3 } })
  })

  it('never upgrades an unknown speaker to owner and flags relays', () => {
    const view = toKairosTodayView({ createdAt: at, toolName: 'triad', payload: { channel: 'triad', type: 'said', speaker: 'boss', relayedRole: 'operator', text: 'x' } })
    expect(view.speaker).toBe('agent')
    expect(view.relayed).toBe(true)
  })
})
