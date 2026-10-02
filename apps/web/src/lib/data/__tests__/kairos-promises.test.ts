import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Minimal drizzle stand-in. db.select resolves `selectRows`; inside a
// transaction tx.select(...).for('update') records the lock and resolves
// `lockedRows`; update/insert capture what was written.
const h = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  lockedRows: [] as unknown[][],
  locks: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ values: unknown; set?: Record<string, unknown>; conflict?: 'nothing' | 'update' }>,
  insertReturning: [] as unknown[][],
  transactions: 0,
}))

vi.mock('@/lib/db', () => {
  const selectChain = (rows: () => unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.for = (mode: string) => {
      h.locks.push(mode)
      return Promise.resolve(h.lockedRows.shift() ?? [])
    }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
    return chain
  }
  const insert = () => ({
    values: (values: unknown) => {
      const entry: (typeof h.inserts)[number] = { values }
      h.inserts.push(entry)
      return {
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => { entry.set = set; entry.conflict = 'update' },
        onConflictDoNothing: () => {
          entry.conflict = 'nothing'
          return { returning: async () => h.insertReturning.shift() ?? [{ userId: 'u1' }] }
        },
      }
    },
  })
  const update = () => ({
    set: (set: Record<string, unknown>) => ({ where: async () => { h.updates.push(set) } }),
  })
  const tx = { select: vi.fn(() => selectChain(() => [])), insert: vi.fn(insert), update: vi.fn(update) }
  return {
    db: {
      select: vi.fn(() => selectChain(() => h.selectRows)),
      insert: vi.fn(insert),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => { h.transactions++; return fn(tx) }),
    },
  }
})

import {
  KAIROS_PROMISES_PREF_KEY,
  KairosPromisesCorruptError,
  emptyPromisesState,
  findOpenKairosPromiseBySeq,
  listKairosPromises,
  mutateKairosPromises,
  readKairosPromises,
} from '../kairos-promises'
import { findPreferences, upsertPreferences } from '../preferences'
import { PAID_BACKUP_PREF_KEY } from '../kairos-paid-backup'
import type { KairosPromise, KairosPromisesState } from '../validators/kairos-promises'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)

function promise(seq: number, over: Partial<KairosPromise> = {}): KairosPromise {
  return {
    id: `00000000-0000-4000-8000-00000000000${seq}`,
    seq,
    outcome: `Outcome number ${seq} shipped`,
    dueDate: '2026-10-10',
    createdAt: '2026-10-01T05:00:00.000Z',
    source: { kind: 'weekly_review', jobId: 'job-1' },
    check: { kind: 'owner_confirm' },
    status: 'open',
    renegotiations: 0,
    dueHistory: [],
    ...over,
  }
}

const state = (over: Partial<KairosPromisesState> = {}): KairosPromisesState => ({ ...emptyPromisesState(), ...over })

beforeEach(() => {
  h.selectRows = []
  h.lockedRows = []
  h.locks = []
  h.updates = []
  h.inserts = []
  h.insertReturning = []
  h.transactions = 0
})

describe('reads', () => {
  it('a missing key is an empty state; a malformed one throws instead of being overwritten', async () => {
    expect(await readKairosPromises('u1')).toEqual(emptyPromisesState())
    h.selectRows = [{ value: { v: 1, nextSeq: 'x', open: [], closed: [] } }]
    await expect(readKairosPromises('u1')).rejects.toBeInstanceOf(KairosPromisesCorruptError)
  })

  it('lists open by P-number, scope all appends closed; looks up an open promise by number', async () => {
    const closed = promise(1, { status: 'kept', closedAt: '2026-10-02T00:00:00.000Z', closedBy: { kind: 'owner', via: 'session' } })
    h.selectRows = [{ value: state({ nextSeq: 4, open: [promise(3), promise(2)], closed: [closed] }) }]
    expect((await listKairosPromises('u1', { scope: 'open' })).map((p) => p.seq)).toEqual([2, 3])
    expect((await listKairosPromises('u1', { scope: 'all' })).map((p) => p.seq)).toEqual([2, 3, 1])
    expect((await findOpenKairosPromiseBySeq('u1', 3))?.seq).toBe(3)
    expect(await findOpenKairosPromiseBySeq('u1', 1)).toBeNull()
  })
})

describe('mutateKairosPromises (the only writer)', () => {
  it('locks the preferences row FOR UPDATE inside a transaction and merges only its key', async () => {
    h.lockedRows = [[{ value: state() }]]
    const result = await mutateKairosPromises('u1', (s) => ({ state: { ...s, nextSeq: 2, open: [promise(1)] }, result: 'done' }))
    expect(result).toBe('done')
    expect(h.transactions).toBe(1)
    expect(h.locks).toEqual(['update'])
    const q = render(h.updates[0].preferences)
    expect(q.sql).toMatch(/"preferences" \|\| jsonb_build_object\(\$1::text, \$2::jsonb\)/)
    expect(q.params[0]).toBe(KAIROS_PROMISES_PREF_KEY)
    expect(JSON.parse(q.params[1] as string).open[0].seq).toBe(1)
  })

  it('writes nothing when the mutation returns no state', async () => {
    h.lockedRows = [[{ value: state() }]]
    expect(await mutateKairosPromises('u1', () => ({ state: null, result: 0 }))).toBe(0)
    expect(h.updates).toHaveLength(0)
    expect(h.inserts).toHaveLength(0)
  })

  it('inserts the row when none exists, and re-locks if a concurrent insert won', async () => {
    h.lockedRows = [[], [{ value: state() }]]
    h.insertReturning = [[]]
    const mutate = vi.fn((s: KairosPromisesState) => ({ state: { ...s, nextSeq: s.nextSeq + 1 }, result: s.nextSeq }))
    expect(await mutateKairosPromises('u1', mutate)).toBe(1)
    expect(h.inserts[0]).toMatchObject({ conflict: 'nothing', values: { userId: 'u1', preferences: { [KAIROS_PROMISES_PREF_KEY]: { nextSeq: 2 } } } })
    expect(h.locks).toEqual(['update', 'update'])
    expect(h.updates).toHaveLength(1)
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it('refuses to write a state that breaks the schema (e.g. 13 open)', async () => {
    h.lockedRows = [[{ value: state() }]]
    const open = Array.from({ length: 13 }, (_, i) => promise(1, { id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, seq: i + 1 }))
    await expect(mutateKairosPromises('u1', (s) => ({ state: { ...s, open }, result: null }))).rejects.toThrow()
    expect(h.updates).toHaveLength(0)
  })
})

describe('theme sync keeps promises server-owned', () => {
  it('upsertPreferences strips kairosPromises from the client payload and carries the stored value over', async () => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [KAIROS_PROMISES_PREF_KEY]: { v: 1 }, [PAID_BACKUP_PREF_KEY]: false })
    const [entry] = h.inserts
    expect((entry.values as { preferences: Record<string, unknown> }).preferences).toEqual({ currentTheme: 'nebula' })
    const q = render(entry.set!.preferences)
    expect(q.params[0]).toBe(JSON.stringify({ currentTheme: 'nebula' }))
    expect(q.sql).toMatch(/case when ("user_preferences"\.)?"preferences" \? \$\d+::text then jsonb_build_object\(\$\d+::text, ("user_preferences"\.)?"preferences" -> \$\d+::text\) else '\{\}'::jsonb end/)
    expect(q.params.filter((p) => p === KAIROS_PROMISES_PREF_KEY)).toHaveLength(3)
    expect(q.params).toContain(PAID_BACKUP_PREF_KEY)
  })

  it('findPreferences never hands promises to the client', async () => {
    h.selectRows = [{ preferences: { currentTheme: 'nebula', [KAIROS_PROMISES_PREF_KEY]: state() } }]
    const prefs = await findPreferences('u1')
    expect(prefs).not.toHaveProperty(KAIROS_PROMISES_PREF_KEY)
    expect(prefs).toMatchObject({ currentTheme: 'nebula' })
  })
})
