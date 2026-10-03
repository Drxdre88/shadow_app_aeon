import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const h = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  inserts: [] as Array<{ values: unknown; set?: Record<string, unknown> }>,
}))

vi.mock('@/lib/db', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(h.selectRows)
    return chain
  }
  const insert = () => ({
    values: (values: unknown) => {
      const entry: (typeof h.inserts)[number] = { values }
      h.inserts.push(entry)
      return { onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => { entry.set = set } }
    },
  })
  return { db: { select: vi.fn(selectChain), insert: vi.fn(insert) } }
})

import { findPreferences, upsertPreferences } from '../preferences'
import { KAIROS_IDEA_ATLAS_PREF_KEY, KAIROS_IDEA_SHELF_PREF_KEY } from '@/lib/kairos/ideas/pref-keys'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)

beforeEach(() => {
  h.selectRows = []
  h.inserts = []
})

describe('wave 3 idea state stays server-owned', () => {
  it.each([KAIROS_IDEA_ATLAS_PREF_KEY, KAIROS_IDEA_SHELF_PREF_KEY])('theme sync strips and carries %s', async (key) => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [key]: { v: 1, forged: true } })
    const [entry] = h.inserts
    expect((entry.values as { preferences: Record<string, unknown> }).preferences).toEqual({ currentTheme: 'nebula' })
    expect(render(entry.set!.preferences).params.filter((p) => p === key)).toHaveLength(3)
  })

  it('findPreferences never hands either key to the client', async () => {
    h.selectRows = [{ preferences: { currentTheme: 'nebula', [KAIROS_IDEA_ATLAS_PREF_KEY]: { v: 1 }, [KAIROS_IDEA_SHELF_PREF_KEY]: { v: 1 } } }]
    const prefs = await findPreferences('u1')
    expect(prefs).not.toHaveProperty(KAIROS_IDEA_ATLAS_PREF_KEY)
    expect(prefs).not.toHaveProperty(KAIROS_IDEA_SHELF_PREF_KEY)
  })
})
