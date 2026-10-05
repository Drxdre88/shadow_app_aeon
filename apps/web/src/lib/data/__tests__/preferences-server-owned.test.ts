import { beforeEach, describe, expect, it, vi } from 'vitest'

// The private-topic gate and the living-Dominions unattributed list are
// server-owned preferences: a theme save from the client can't set or wipe them.

const h = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  inserts: [] as Array<{ values: unknown; set?: Record<string, unknown> }>,
}))

vi.mock('@/lib/db', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.limit = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(h.selectRows)
    return chain
  }
  const insert = () => ({
    values: (values: unknown) => {
      const entry: (typeof h.inserts)[number] = { values }
      h.inserts.push(entry)
      const done = { returning: async () => [{ userId: 'u1' }] }
      const onConflictDoUpdate = ({ set }: { set: Record<string, unknown> }) => { entry.set = set; return done }
      return { onConflictDoUpdate, onConflictDoNothing: () => done, ...done }
    },
  })
  return { db: { select: vi.fn(selectChain), insert: vi.fn(insert) } }
})

import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { findPreferences, upsertPreferences } from '../preferences'
import { SENSITIVE_GATE_PREF_KEY } from '@/lib/kairos/sensitive/pref-keys'
import { LIVING_UNATTRIBUTED_PREF_KEY } from '@/lib/kairos/living/types'

beforeEach(() => {
  h.selectRows = []
  h.inserts = []
})

describe('server-owned preference keys', () => {
  it.each([SENSITIVE_GATE_PREF_KEY, LIVING_UNATTRIBUTED_PREF_KEY])('a client save cannot write %s', async (key) => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [key]: true })
    const written = (h.inserts[0].values as { preferences: Record<string, unknown> }).preferences
    expect(written).not.toHaveProperty(key)
    expect(written.currentTheme).toBe('nebula')
  })

  it.each([SENSITIVE_GATE_PREF_KEY, LIVING_UNATTRIBUTED_PREF_KEY])('a theme save carries the stored %s over', async (key) => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [key]: true })
    const set = h.inserts[0].set!
    const params = new PgDialect().sqlToQuery(set.preferences as SQL).params
    expect(params.filter((p) => p === key)).toHaveLength(3)
  })

  it.each([SENSITIVE_GATE_PREF_KEY, LIVING_UNATTRIBUTED_PREF_KEY])('%s is never handed to the client', async (key) => {
    h.selectRows = [{ preferences: { currentTheme: 'nebula', [key]: true } }]
    expect(await findPreferences('u1')).not.toHaveProperty(key)
  })
})
