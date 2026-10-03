import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Minimal drizzle stand-in (same shape as kairos-promises.test.ts).
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
  KAIROS_STAGE_PREF_KEY,
  KairosStageCorruptError,
  mutateKairosStage,
  readKairosStage,
  toKairosStageView,
} from '../kairos-stage'
import { findPreferences, upsertPreferences } from '../preferences'
import { applyStagePost, emptyStageState } from '@/lib/kairos/stage/select'
import type { KairosStageState } from '../validators/kairos-stage'
import { getKairosStageSchema } from '../validators/kairos-stage'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)
const NOW = new Date('2026-10-03T09:30:00.000Z')

function seeded(): KairosStageState {
  return applyStagePost(emptyStageState(), {
    post: { kind: 'reflect', source: 'job', tier: 'deep', jobId: 'j1', items: [{ text: 'Billing migration is slipping', importance: 0.9, surprise: 0.5, goalRelevance: 0.5, need: 0.5 }] },
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

describe('reads', () => {
  it('a missing key is an empty stage; a malformed one throws instead of being overwritten', async () => {
    expect(await readKairosStage('u1')).toEqual(emptyStageState())
    h.selectRows = [{ value: { v: 1, coalitions: 'nope' } }]
    await expect(readKairosStage('u1')).rejects.toBeInstanceOf(KairosStageCorruptError)
  })
})

describe('mutateKairosStage (the only writer)', () => {
  it('locks the preferences row FOR UPDATE inside a transaction and merges only its key', async () => {
    h.lockedRows = [[{ value: emptyStageState() }]]
    const result = await mutateKairosStage('u1', () => ({ state: seeded(), result: 'done' }))
    expect(result).toBe('done')
    expect(h.transactions).toBe(1)
    expect(h.locks).toEqual(['update'])
    const q = render(h.updates[0].preferences)
    expect(q.sql).toMatch(/"preferences" \|\| jsonb_build_object\(\$1::text, \$2::jsonb\)/)
    expect(q.params[0]).toBe(KAIROS_STAGE_PREF_KEY)
    expect(JSON.parse(q.params[1] as string).coalitions[0].text).toBe('Billing migration is slipping')
  })

  it('writes nothing when the mutation returns no state', async () => {
    h.lockedRows = [[{ value: emptyStageState() }]]
    expect(await mutateKairosStage('u1', () => ({ state: null, result: 0 }))).toBe(0)
    expect(h.updates).toHaveLength(0)
    expect(h.inserts).toHaveLength(0)
  })

  it('inserts the row when none exists, and re-locks if a concurrent insert won', async () => {
    h.lockedRows = [[], [{ value: emptyStageState() }]]
    h.insertReturning = [[]]
    const mutate = vi.fn(() => ({ state: seeded(), result: 1 }))
    expect(await mutateKairosStage('u1', mutate)).toBe(1)
    expect(h.inserts[0]).toMatchObject({ conflict: 'nothing', values: { userId: 'u1' } })
    expect(h.locks).toEqual(['update', 'update'])
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it('refuses to write a state that breaks the schema (17 coalitions)', async () => {
    h.lockedRows = [[{ value: emptyStageState() }]]
    const one = seeded().coalitions[0]
    const coalitions = Array.from({ length: 17 }, (_, i) => ({ ...one, id: `c_${String(i).padStart(8, '0')}` }))
    await expect(mutateKairosStage('u1', (s) => ({ state: { ...s, coalitions }, result: null }))).rejects.toThrow()
    expect(h.updates).toHaveLength(0)
  })

  it('refuses a corrupt stored blob rather than clobbering it', async () => {
    h.lockedRows = [[{ value: { v: 2 } }]]
    await expect(mutateKairosStage('u1', () => ({ state: emptyStageState(), result: null }))).rejects.toBeInstanceOf(KairosStageCorruptError)
    expect(h.updates).toHaveLength(0)
  })
})

describe('theme sync keeps the stage server-owned', () => {
  it('upsertPreferences strips kairosStage from the client payload and carries the stored value over', async () => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [KAIROS_STAGE_PREF_KEY]: { v: 1, forged: true } })
    const [entry] = h.inserts
    expect((entry.values as { preferences: Record<string, unknown> }).preferences).toEqual({ currentTheme: 'nebula' })
    const q = render(entry.set!.preferences)
    expect(q.params.filter((p) => p === KAIROS_STAGE_PREF_KEY)).toHaveLength(3)
  })

  it('findPreferences never hands the stage to the client', async () => {
    h.selectRows = [{ preferences: { currentTheme: 'nebula', [KAIROS_STAGE_PREF_KEY]: seeded() } }]
    const prefs = await findPreferences('u1')
    expect(prefs).not.toHaveProperty(KAIROS_STAGE_PREF_KEY)
  })
})

describe('toKairosStageView', () => {
  it('shows top coalitions with strength, focus and recent cycle winners; pool only on request', () => {
    const s = seeded()
    const view = toKairosStageView(s, { now: NOW })
    expect(view).toMatchObject({ cycle: '2026-10-03T10', focus: null, poolSize: 1, surpriseLast24h: 0.5 })
    expect(view.top[0]).toMatchObject({ text: 'Billing migration is slipping', deepBacked: true, members: 1, kinds: ['reflect'] })
    expect(view.pool).toBeUndefined()
    expect(toKairosStageView(s, { now: NOW, pool: true }).pool).toHaveLength(1)
  })
})

describe('getKairosStageSchema', () => {
  it('defaults to json / no pool and reads pool "0" as false (not a coerced boolean)', () => {
    expect(getKairosStageSchema.parse({})).toEqual({ format: 'json', pool: '0' })
    expect(getKairosStageSchema.parse({ pool: '0' }).pool).toBe('0')
    expect(getKairosStageSchema.safeParse({ pool: 'true' }).success).toBe(false)
    expect(getKairosStageSchema.safeParse({ format: 'xml' }).success).toBe(false)
  })
})
