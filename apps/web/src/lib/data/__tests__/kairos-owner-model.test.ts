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

vi.mock('@/lib/data/memory-candidates', () => ({}))
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
  KAIROS_OWNER_MODEL_PREF_KEY,
  KairosOwnerModelCorruptError,
  mutateKairosOwnerModel,
  readKairosOwnerModel,
  toKairosOwnerModelView,
} from '../kairos-owner-model'
import { findPreferences, upsertPreferences } from '../preferences'
import { getKairosOwnerModelSchema, kairosOwnerModelSchema, type KairosOwnerModel, type OwnerItem } from '../validators/kairos-owner-model'
import { emptyOwnerModel } from '@/lib/kairos/owner-model/status'
import { renderOwnerModelMarkdown } from '@/lib/kairos/owner-model/render'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)
const NOW = new Date('2026-10-04T12:00:00.000Z')

function item(seq: number, kind: OwnerItem['kind'], extra: Partial<OwnerItem> = {}): OwnerItem {
  return {
    id: `i${seq}`, seq, kind, text: `item ${seq}`, domain: 'general', status: 'held',
    firstSeenAt: '2026-09-30T08:00:00.000Z', lastConfirmedAt: '2026-09-30T08:00:00.000Z',
    ...(kind === 'state' ? { expiresAt: '2026-10-10T08:00:00.000Z' } : {}),
    supportDays: [], confirmations: [], ...extra,
  }
}

const seeded = (): KairosOwnerModel => ({
  ...emptyOwnerModel(),
  nextSeq: 5,
  items: [
    item(1, 'state'),
    item(2, 'trait'),
    item(3, 'trait', { status: 'candidate' }),
    item(4, 'state', { expiresAt: '2026-10-02T08:00:00.000Z' }),
  ],
  vetoes: [{ norm: 'secret veto text', kind: 'state', until: '2026-10-20T00:00:00.000Z' }],
  cards: [{ isoWeek: '2026-W40', at: '2026-09-27T17:00:00.000Z', status: 'sent', memoryId: 'm1', seqs: [1, 2] }],
  corrections: [{ at: '2026-10-01T09:00:00.000Z', seq: 1, action: 'still', via: 'telegram' }],
})

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
  it('accepts a seeded model, rejects unknown kinds, caps the lists', () => {
    expect(kairosOwnerModelSchema.safeParse(seeded()).success).toBe(true)
    expect(kairosOwnerModelSchema.safeParse({ ...seeded(), items: [{ ...item(1, 'state'), kind: 'mood' }] }).success).toBe(false)
    expect(kairosOwnerModelSchema.safeParse({ ...seeded(), items: Array.from({ length: 41 }, (_, i) => item(i + 1, 'trait')) }).success).toBe(false)
    expect(getKairosOwnerModelSchema.parse({})).toEqual({ format: 'json' })
  })
})

describe('reads', () => {
  it('a missing key is an empty model; a malformed one throws', async () => {
    expect(await readKairosOwnerModel('u1')).toEqual(emptyOwnerModel())
    h.selectRows = [{ value: { v: 1, items: 'nope' } }]
    await expect(readKairosOwnerModel('u1')).rejects.toBeInstanceOf(KairosOwnerModelCorruptError)
  })
})

describe('mutateKairosOwnerModel (the only writer)', () => {
  it('locks FOR UPDATE in a transaction, merges only its key, saves lapsed states as expired', async () => {
    h.lockedRows = [[{ value: emptyOwnerModel() }]]
    expect(await mutateKairosOwnerModel('u1', () => ({ state: seeded(), result: 'done' }), NOW)).toBe('done')
    expect(h.transactions).toBe(1)
    expect(h.locks).toEqual(['update'])
    const q = render(h.updates[0].preferences)
    expect(q.sql).toMatch(/"preferences" \|\| jsonb_build_object\(\$1::text, \$2::jsonb\)/)
    expect(q.params[0]).toBe(KAIROS_OWNER_MODEL_PREF_KEY)
    const written = JSON.parse(q.params[1] as string) as KairosOwnerModel
    expect(written.items.find((i) => i.seq === 4)!.status).toBe('expired')
  })

  it('writes nothing when the mutation returns no state; refuses a corrupt blob', async () => {
    h.lockedRows = [[{ value: emptyOwnerModel() }]]
    expect(await mutateKairosOwnerModel('u1', () => ({ state: null, result: 0 }))).toBe(0)
    h.lockedRows = [[{ value: { v: 2 } }]]
    await expect(mutateKairosOwnerModel('u1', () => ({ state: emptyOwnerModel(), result: null }))).rejects.toBeInstanceOf(KairosOwnerModelCorruptError)
    expect(h.updates).toHaveLength(0)
  })

  it('inserts the row when none exists', async () => {
    h.lockedRows = [[]]
    expect(await mutateKairosOwnerModel('u1', () => ({ state: seeded(), result: 1 }), NOW)).toBe(1)
    expect(h.inserts[0]).toMatchObject({ conflict: 'nothing', values: { userId: 'u1' } })
  })
})

describe('theme sync keeps the owner model server-owned', () => {
  it('upsertPreferences strips kairosOwnerModel from the client payload', async () => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [KAIROS_OWNER_MODEL_PREF_KEY]: { v: 1, forged: true } })
    expect((h.inserts[0].values as { preferences: Record<string, unknown> }).preferences).toEqual({ currentTheme: 'nebula' })
  })

  it('findPreferences never hands the model to the client', async () => {
    h.selectRows = [{ preferences: { currentTheme: 'nebula', [KAIROS_OWNER_MODEL_PREF_KEY]: seeded() } }]
    expect(await findPreferences('u1')).not.toHaveProperty(KAIROS_OWNER_MODEL_PREF_KEY)
  })
})

describe('toKairosOwnerModelView + markdown', () => {
  it('splits live / candidates / expired with dates, no veto text or memory ids', () => {
    const view = toKairosOwnerModelView(seeded(), { now: NOW })
    expect(view.live.map((v) => v.seq)).toEqual([1, 2])
    expect(view.candidates.map((v) => v.seq)).toEqual([3])
    expect(view.expired.map((v) => v.seq)).toEqual([4])
    expect(view.lastCard).toEqual({ isoWeek: '2026-W40', at: '2026-09-27T17:00:00.000Z', status: 'sent', items: 2 })
    expect(view.corrections).toEqual({ last30d: 1, byAction: { still: 1 } })
    expect(view.vetoes).toBe(1)
    expect(JSON.stringify(view)).not.toContain('secret veto text')
    const md = renderOwnerModelMarkdown(view)
    expect(md).toContain('## Live\n- C1 state: item 1 (since 2026-09-30, lapses 2026-10-10; 0 confirmations)')
    expect(md).toContain('## Expired states\n- C4 state: item 4 (since 2026-09-30, lapsed 2026-10-02')
  })
})
