import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Minimal drizzle stand-in (same shape as kairos-stage.test.ts).
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
  KAIROS_SURPRISE_PREF_KEY,
  KairosSurpriseCorruptError,
  mutateKairosSurprise,
  readKairosSurprise,
  toKairosSurpriseView,
} from '../kairos-surprise'
import { findPreferences, upsertPreferences } from '../preferences'
import { applySurpriseEvent, emptySurpriseLedger } from '@/lib/kairos/surprise/ledger'
import {
  SURPRISE_MAX_EVENTS,
  getKairosSurpriseSchema,
  kairosSurpriseLedgerSchema,
  kairosSurpriseViewSchema,
  surpriseMarkSchema,
  type KairosSurpriseLedger,
} from '../validators/kairos-surprise'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)
const NOW = new Date('2026-10-03T09:30:00.000Z')

function seeded(): KairosSurpriseLedger {
  return applySurpriseEvent(emptySurpriseLedger(), {
    key: 'prediction:p1:wrong', kind: 'prediction_wrong', s: 0.8, dominionId: 'd1',
    refs: { predictionId: 'p1', beliefIds: ['b1', 'b2'] }, opened: ['b1'],
  }, NOW).state!
}

beforeEach(() => {
  h.selectRows = []
  h.lockedRows = []
  h.locks = []
  h.updates = []
  h.inserts = []
  h.insertReturning = []
  h.transactions = 0
})

describe('validators', () => {
  it('accepts a ledger written by the policy and rejects unknown keys / kinds / bad ids', () => {
    expect(kairosSurpriseLedgerSchema.safeParse(seeded()).success).toBe(true)
    expect(kairosSurpriseLedgerSchema.safeParse({ ...seeded(), extra: 1 }).success).toBe(false)
    const ev = seeded().events[0]
    expect(kairosSurpriseLedgerSchema.safeParse({ ...seeded(), events: [{ ...ev, kind: 'vibes' }] }).success).toBe(false)
    expect(kairosSurpriseLedgerSchema.safeParse({ ...seeded(), events: [{ ...ev, id: 'x_1' }] }).success).toBe(false)
    expect(kairosSurpriseLedgerSchema.safeParse({ ...seeded(), events: [{ ...ev, s: 1.2 }] }).success).toBe(false)
  })

  it('caps events at 64 and the blob at 16KB', () => {
    const ev = seeded().events[0]
    const events = Array.from({ length: SURPRISE_MAX_EVENTS + 1 }, (_, i) => ({ ...ev, id: `s_${String(i).padStart(8, '0')}` }))
    expect(kairosSurpriseLedgerSchema.safeParse({ ...emptySurpriseLedger(), events }).success).toBe(false)
    const seen = Array.from({ length: 100 }, (_, i) => `${'k'.repeat(190)}${i}`)
    expect(kairosSurpriseLedgerSchema.safeParse({ ...emptySurpriseLedger(), seen }).success).toBe(false)
  })

  it('mark: ≤5 signals, pressure optional, unknown keys tolerated', () => {
    const signal = { kind: 'pressure', ref: 'b1', at: NOW.toISOString(), s: 0.4 }
    expect(surpriseMarkSchema.safeParse({ openUntil: NOW.toISOString(), signals: [signal], pressure: { n: 2, since: NOW.toISOString() }, x: 1 }).success).toBe(true)
    expect(surpriseMarkSchema.safeParse({ openUntil: NOW.toISOString(), signals: Array(6).fill(signal) }).success).toBe(false)
  })

  it('getKairosSurpriseSchema defaults format to json', () => {
    expect(getKairosSurpriseSchema.parse({})).toEqual({ format: 'json' })
    expect(getKairosSurpriseSchema.safeParse({ format: 'xml' }).success).toBe(false)
  })
})

describe('reads', () => {
  it('a missing key is an empty ledger; a malformed one throws instead of being overwritten', async () => {
    expect(await readKairosSurprise('u1')).toEqual(emptySurpriseLedger())
    h.selectRows = [{ value: { v: 1, events: 'nope' } }]
    await expect(readKairosSurprise('u1')).rejects.toBeInstanceOf(KairosSurpriseCorruptError)
  })
})

describe('mutateKairosSurprise (the only writer)', () => {
  it('locks the preferences row FOR UPDATE inside a transaction and merges only its key', async () => {
    h.lockedRows = [[{ value: emptySurpriseLedger() }]]
    const result = await mutateKairosSurprise('u1', () => ({ state: seeded(), result: 'done' }), NOW)
    expect(result).toBe('done')
    expect(h.transactions).toBe(1)
    expect(h.locks).toEqual(['update'])
    const q = render(h.updates[0].preferences)
    expect(q.sql).toMatch(/"preferences" \|\| jsonb_build_object\(\$1::text, \$2::jsonb\)/)
    expect(q.params[0]).toBe(KAIROS_SURPRISE_PREF_KEY)
    expect(JSON.parse(q.params[1] as string).events[0].kind).toBe('prediction_wrong')
  })

  it('applies retention + caps on every write', async () => {
    h.lockedRows = [[{ value: emptySurpriseLedger() }]]
    const old = { ...seeded().events[0], at: '2026-09-20T00:00:00.000Z' }
    await mutateKairosSurprise('u1', (l) => ({ state: { ...l, events: [old, ...seeded().events] }, result: null }), NOW)
    const written = JSON.parse(render(h.updates[0].preferences).params[1] as string)
    expect(written.events).toHaveLength(1)
    expect(written.events[0].at).toBe(NOW.toISOString())
  })

  it('writes nothing when the mutation returns no state', async () => {
    h.lockedRows = [[{ value: emptySurpriseLedger() }]]
    expect(await mutateKairosSurprise('u1', () => ({ state: null, result: 0 }))).toBe(0)
    expect(h.updates).toHaveLength(0)
    expect(h.inserts).toHaveLength(0)
  })

  it('inserts the row when none exists, and re-locks if a concurrent insert won', async () => {
    h.lockedRows = [[], [{ value: emptySurpriseLedger() }]]
    h.insertReturning = [[]]
    const mutate = vi.fn(() => ({ state: seeded(), result: 1 }))
    expect(await mutateKairosSurprise('u1', mutate, NOW)).toBe(1)
    expect(h.inserts[0]).toMatchObject({ conflict: 'nothing', values: { userId: 'u1' } })
    expect(h.locks).toEqual(['update', 'update'])
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it('refuses a corrupt stored blob rather than clobbering it', async () => {
    h.lockedRows = [[{ value: { v: 2 } }]]
    await expect(mutateKairosSurprise('u1', () => ({ state: emptySurpriseLedger(), result: null }))).rejects.toBeInstanceOf(KairosSurpriseCorruptError)
    expect(h.updates).toHaveLength(0)
  })
})

describe('theme sync keeps the ledger server-owned', () => {
  it('upsertPreferences strips kairosSurprise from the client payload and carries the stored value over', async () => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [KAIROS_SURPRISE_PREF_KEY]: { v: 1, forged: true } })
    const [entry] = h.inserts
    expect((entry.values as { preferences: Record<string, unknown> }).preferences).toEqual({ currentTheme: 'nebula' })
    const q = render(entry.set!.preferences)
    expect(q.params.filter((p) => p === KAIROS_SURPRISE_PREF_KEY)).toHaveLength(3)
  })

  it('findPreferences never hands the ledger to the client', async () => {
    h.selectRows = [{ preferences: { currentTheme: 'nebula', [KAIROS_SURPRISE_PREF_KEY]: seeded() } }]
    const prefs = await findPreferences('u1')
    expect(prefs).not.toHaveProperty(KAIROS_SURPRISE_PREF_KEY)
  })
})

describe('toKairosSurpriseView', () => {
  it('summarises newest first with a 7-day tally and no keys or ref ids', () => {
    let l = seeded()
    l = applySurpriseEvent(l, { key: 'promise:x:lapsed', kind: 'promise_lapsed', s: 0.6, at: '2026-10-03T10:00:00.000Z' }, NOW).state!
    const view = toKairosSurpriseView(l, { now: new Date('2026-10-03T12:00:00.000Z') })
    expect(kairosSurpriseViewSchema.safeParse(view).success).toBe(true)
    expect(view.events.map((e) => e.kind)).toEqual(['promise_lapsed', 'prediction_wrong'])
    expect(view.events[1]).toMatchObject({ beliefs: 2, opened: 1, dominionId: 'd1', credited: null })
    expect(view.last7d).toEqual({ count: 2, sumS: 1.4, byKind: { prediction_wrong: 1, promise_lapsed: 1 } })
    expect(JSON.stringify(view)).not.toContain('prediction:p1:wrong')
  })
})
