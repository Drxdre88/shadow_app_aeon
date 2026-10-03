import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Minimal drizzle stand-in (same shape as kairos-surprise.test.ts).
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
  KAIROS_IDEA_SHELF_PREF_KEY,
  KairosIdeaShelfCorruptError,
  mutateKairosIdeaShelf,
  readKairosIdeaShelf,
} from '../kairos-idea-shelf'
import { findPreferences, upsertPreferences } from '../preferences'
import { applyOffer, emptyShelf } from '@/lib/kairos/incubation/shelf'
import { SHELF_MAX_ITEMS, kairosIdeaShelfSchema, type KairosIdeaShelf } from '../validators/kairos-idea-shelf'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)
const NOW = new Date('2026-10-03T09:30:00.000Z')
const seeded = (): KairosIdeaShelf => applyOffer(emptyShelf(), 'mem-1', 'pulse:2026-10-03:10', NOW)

beforeEach(() => {
  h.selectRows = []
  h.lockedRows = []
  h.locks = []
  h.updates = []
  h.inserts = []
  h.insertReturning = []
  h.transactions = 0
})

describe('kairosIdeaShelf validator', () => {
  it('accepts a policy-written shelf and rejects unknown keys, bad counts and oversize', () => {
    expect(kairosIdeaShelfSchema.safeParse(seeded()).success).toBe(true)
    expect(kairosIdeaShelfSchema.safeParse({ ...seeded(), extra: 1 }).success).toBe(false)
    const item = seeded().items[0]
    expect(kairosIdeaShelfSchema.safeParse({ ...seeded(), items: [{ ...item, offers: 4 }] }).success).toBe(false)
    expect(kairosIdeaShelfSchema.safeParse({ ...seeded(), lastResurfaceDay: 'today' }).success).toBe(false)
    const many = Array.from({ length: SHELF_MAX_ITEMS + 1 }, (_, i) => ({ ...item, id: `m${i}` }))
    expect(kairosIdeaShelfSchema.safeParse({ ...seeded(), items: many }).success).toBe(false)
  })
})

describe('reads and the single writer', () => {
  it('a missing key is an empty shelf; a malformed one throws', async () => {
    expect(await readKairosIdeaShelf('u1')).toEqual(emptyShelf())
    h.selectRows = [{ value: { v: 1, items: 'nope' } }]
    await expect(readKairosIdeaShelf('u1')).rejects.toBeInstanceOf(KairosIdeaShelfCorruptError)
  })

  it('locks the preferences row FOR UPDATE inside a transaction and merges only its key', async () => {
    h.lockedRows = [[{ value: emptyShelf() }]]
    expect(await mutateKairosIdeaShelf('u1', () => ({ state: seeded(), result: 'ok' }), NOW)).toBe('ok')
    expect(h.transactions).toBe(1)
    expect(h.locks).toEqual(['update'])
    const q = render(h.updates[0].preferences)
    expect(q.sql).toMatch(/"preferences" \|\| jsonb_build_object\(\$1::text, \$2::jsonb\)/)
    expect(q.params[0]).toBe(KAIROS_IDEA_SHELF_PREF_KEY)
    expect(JSON.parse(q.params[1] as string).items[0]).toMatchObject({ id: 'mem-1', offers: 1 })
  })

  it('prunes items untouched for 30 days on every write', async () => {
    h.lockedRows = [[{ value: emptyShelf() }]]
    const stale = applyOffer(emptyShelf(), 'old', 'pulse:2026-08-01:10', new Date('2026-08-01T10:00:00Z')).items[0]
    await mutateKairosIdeaShelf('u1', () => ({ state: { ...seeded(), items: [stale, ...seeded().items] }, result: null }), NOW)
    expect(JSON.parse(render(h.updates[0].preferences).params[1] as string).items.map((i: { id: string }) => i.id)).toEqual(['mem-1'])
  })

  it('writes nothing when the mutation returns no state; inserts when no row exists', async () => {
    h.lockedRows = [[{ value: emptyShelf() }]]
    expect(await mutateKairosIdeaShelf('u1', () => ({ state: null, result: 0 }))).toBe(0)
    expect(h.updates).toHaveLength(0)
    h.lockedRows = [[]]
    await mutateKairosIdeaShelf('u1', () => ({ state: seeded(), result: 1 }), NOW)
    expect(h.inserts[0]).toMatchObject({ conflict: 'nothing', values: { userId: 'u1' } })
  })

  it('refuses a corrupt stored blob rather than clobbering it', async () => {
    h.lockedRows = [[{ value: { v: 2 } }]]
    await expect(mutateKairosIdeaShelf('u1', () => ({ state: emptyShelf(), result: null }))).rejects.toBeInstanceOf(KairosIdeaShelfCorruptError)
    expect(h.updates).toHaveLength(0)
  })
})

describe('theme sync keeps the shelf server-owned', () => {
  it('upsertPreferences strips kairosIdeaShelf from the client payload and carries the stored value over', async () => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [KAIROS_IDEA_SHELF_PREF_KEY]: { v: 1, forged: true } })
    const [entry] = h.inserts
    expect((entry.values as { preferences: Record<string, unknown> }).preferences).toEqual({ currentTheme: 'nebula' })
    expect(render(entry.set!.preferences).params.filter((p) => p === KAIROS_IDEA_SHELF_PREF_KEY)).toHaveLength(3)
  })

  it('findPreferences never hands the shelf to the client', async () => {
    h.selectRows = [{ preferences: { currentTheme: 'nebula', [KAIROS_IDEA_SHELF_PREF_KEY]: seeded() } }]
    expect(await findPreferences('u1')).not.toHaveProperty(KAIROS_IDEA_SHELF_PREF_KEY)
  })
})
