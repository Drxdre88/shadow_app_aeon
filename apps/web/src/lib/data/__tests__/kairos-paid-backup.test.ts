import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Minimal drizzle stand-in: select() resolves the queued rows; insert()
// captures values + the onConflictDoUpdate set clause.
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
  return {
    db: {
      select: vi.fn(selectChain),
      insert: vi.fn(() => ({
        values: (values: unknown) => {
          const entry: { values: unknown; set?: Record<string, unknown> } = { values }
          h.inserts.push(entry)
          return {
            onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => { entry.set = set },
          }
        },
      })),
    },
  }
})

import { getPaidBackupSetting, setPaidBackupSetting, PAID_BACKUP_PREF_KEY } from '../kairos-paid-backup'
import { upsertPreferences } from '../preferences'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)

beforeEach(() => {
  h.selectRows = []
  h.inserts = []
})

describe('getPaidBackupSetting', () => {
  it('defaults ON with no preferences row', async () => {
    expect(await getPaidBackupSetting('u1')).toBe(true)
  })

  it('defaults ON when the key is absent or not a boolean', async () => {
    h.selectRows = [{ preferences: { currentTheme: 'x' } }]
    expect(await getPaidBackupSetting('u1')).toBe(true)
    h.selectRows = [{ preferences: { [PAID_BACKUP_PREF_KEY]: 'false' } }]
    expect(await getPaidBackupSetting('u1')).toBe(true)
  })

  it('reads a stored false', async () => {
    h.selectRows = [{ preferences: { [PAID_BACKUP_PREF_KEY]: false } }]
    expect(await getPaidBackupSetting('u1')).toBe(false)
  })
})

describe('setPaidBackupSetting', () => {
  it('inserts just the key for a new row and merges it into an existing blob', async () => {
    expect(await setPaidBackupSetting('u1', false)).toBe(false)
    const [entry] = h.inserts
    expect(entry.values).toMatchObject({ userId: 'u1', preferences: { [PAID_BACKUP_PREF_KEY]: false } })
    const q = render(entry.set!.preferences)
    // jsonb merge (||), never a blob replacement.
    expect(q.sql).toMatch(/"preferences" \|\| jsonb_build_object\(\$1::text, \$2::boolean\)/)
    expect(q.params).toEqual([PAID_BACKUP_PREF_KEY, false])
  })
})

describe('upsertPreferences (theme sync) keeps the switch server-owned', () => {
  it('strips the key from the client payload and carries the stored value over', async () => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [PAID_BACKUP_PREF_KEY]: true })
    const [entry] = h.inserts
    expect(entry.values).toMatchObject({ preferences: { currentTheme: 'nebula' } })
    expect((entry.values as { preferences: Record<string, unknown> }).preferences).not.toHaveProperty(PAID_BACKUP_PREF_KEY)
    const q = render(entry.set!.preferences)
    expect(q.sql).toContain('jsonb_strip_nulls(jsonb_build_object(')
    expect(q.sql).toContain('"preferences" -> ')
    expect(q.params[0]).toBe(JSON.stringify({ currentTheme: 'nebula' }))
    expect(q.params).toContain(PAID_BACKUP_PREF_KEY)
  })
})
