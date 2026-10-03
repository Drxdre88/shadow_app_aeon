import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Minimal drizzle stand-in (same shape as kairos-stage.test.ts).
const h = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  lockedRows: [] as unknown[][],
  locks: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as unknown[],
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
      h.inserts.push(values)
      return { onConflictDoNothing: () => ({ returning: async () => h.insertReturning.shift() ?? [{ userId: 'u1' }] }) }
    },
  })
  const update = () => ({ set: (set: Record<string, unknown>) => ({ where: async () => { h.updates.push(set) } }) })
  const tx = { select: vi.fn(() => selectChain(() => [])), insert: vi.fn(insert), update: vi.fn(update) }
  return {
    db: {
      select: vi.fn(() => selectChain(() => h.selectRows)),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => { h.transactions++; return fn(tx) }),
    },
  }
})

import { KAIROS_IDEA_ATLAS_PREF_KEY, KairosIdeaAtlasCorruptError, mutateKairosIdeaAtlas, readKairosIdeaAtlas } from '../kairos-idea-atlas'
import { emptyIdeaAtlasState, getKairosIdeaAtlasSchema, type KairosIdeaAtlasState } from '../validators/kairos-idea-atlas'
import { findPreferences } from '../preferences'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)

function seeded(): KairosIdeaAtlasState {
  return {
    v: 1,
    lastNight: '2026-10-01',
    cells: { 'dom-1|make|near': { area: 'dom-1', kind: 'make', leap: 'near', tries: 1, targetedOn: null, lastChallengeOn: null, holder: { memoryId: 'm1', title: 'T', claim: 'c', since: '2026-10-01', elo: 1010, defended: 0 } } },
    history: [],
  }
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

describe('kairosIdeaAtlas preference', () => {
  it('is a server-owned key (never returned to the client)', async () => {
    expect(KAIROS_IDEA_ATLAS_PREF_KEY).toBe('kairosIdeaAtlas')
    h.selectRows = [{ preferences: { [KAIROS_IDEA_ATLAS_PREF_KEY]: seeded(), sidebarOpen: true } }]
    const prefs = await findPreferences('u1')
    expect(prefs).not.toHaveProperty(KAIROS_IDEA_ATLAS_PREF_KEY)
    expect(prefs).toHaveProperty('sidebarOpen', true)
  })

  it('a missing key is an empty atlas; a malformed one throws instead of being overwritten', async () => {
    expect(await readKairosIdeaAtlas('u1')).toEqual(emptyIdeaAtlasState())
    h.selectRows = [{ value: seeded() }]
    expect(await readKairosIdeaAtlas('u1')).toEqual(seeded())
    h.selectRows = [{ value: { v: 1, cells: 'nope' } }]
    await expect(readKairosIdeaAtlas('u1')).rejects.toBeInstanceOf(KairosIdeaAtlasCorruptError)
  })

  it('mutate locks FOR UPDATE inside a transaction and merges only its key', async () => {
    h.lockedRows = [[{ value: emptyIdeaAtlasState() }]]
    expect(await mutateKairosIdeaAtlas('u1', () => ({ state: seeded(), result: 'ok' }))).toBe('ok')
    expect(h.transactions).toBe(1)
    expect(h.locks).toEqual(['update'])
    const q = render(h.updates[0].preferences)
    expect(q.sql).toMatch(/"preferences" \|\| jsonb_build_object\(\$1::text, \$2::jsonb\)/)
    expect(q.params[0]).toBe(KAIROS_IDEA_ATLAS_PREF_KEY)
    expect(JSON.parse(q.params[1] as string).cells['dom-1|make|near'].holder.memoryId).toBe('m1')
  })

  it('writes nothing for a null state, inserts the row when missing, refuses corrupt state', async () => {
    h.lockedRows = [[{ value: null }]]
    expect(await mutateKairosIdeaAtlas('u1', () => ({ state: null, result: 0 }))).toBe(0)
    expect(h.updates).toHaveLength(0)
    h.lockedRows = [[]]
    await mutateKairosIdeaAtlas('u1', () => ({ state: seeded(), result: 1 }))
    expect(h.inserts[0]).toMatchObject({ userId: 'u1', preferences: { kairosIdeaAtlas: { lastNight: '2026-10-01' } } })
    h.lockedRows = [[{ value: { v: 2 } }]]
    await expect(mutateKairosIdeaAtlas('u1', () => ({ state: seeded(), result: 1 }))).rejects.toBeInstanceOf(KairosIdeaAtlasCorruptError)
  })

  it('read surfaces default to json and reject other formats', () => {
    expect(getKairosIdeaAtlasSchema.parse({})).toEqual({ format: 'json' })
    expect(getKairosIdeaAtlasSchema.safeParse({ format: 'xml' }).success).toBe(false)
  })
})
