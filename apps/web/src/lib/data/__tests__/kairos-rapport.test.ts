import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const h = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  lockedRows: [] as unknown[][],
  locks: [] as string[],
  wheres: [] as unknown[],
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ values: unknown; set?: Record<string, unknown> }>,
}))

vi.mock('@/lib/db', () => {
  const selectChain = (rows: () => unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: unknown) => {
      h.wheres.push(w)
      return chain
    }
    chain.orderBy = () => chain
    chain.limit = () => chain
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
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => { entry.set = set },
        onConflictDoNothing: () => ({ returning: async () => [{ userId: 'u1' }] }),
      }
    },
  })
  const update = () => ({ set: (set: Record<string, unknown>) => ({ where: async () => { h.updates.push(set) } }) })
  const tx = { select: vi.fn(() => selectChain(() => [])), insert: vi.fn(insert), update: vi.fn(update) }
  return {
    db: {
      select: vi.fn(() => selectChain(() => h.selectRows)),
      insert: vi.fn(insert),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  }
})

import { KAIROS_RAPPORT_PREF_KEY, KairosRapportCorruptError, listIgnoredKairosSpeakIds, mutateKairosRapport, readKairosRapport, toKairosRapportView } from '../kairos-rapport'
import { findPreferences, upsertPreferences } from '../preferences'
import { kairosRapportSchema, kairosRapportViewSchema, getKairosRapportSchema } from '../validators/kairos-rapport'
import { applyOwnerTurn, emptyRapport } from '@/lib/kairos/rapport/state'
import { renderRapportMarkdown } from '@/lib/kairos/rapport/render'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)
const NOW = new Date('2026-10-04T08:00:00.000Z')
const MODES = { readiness: 'on', bids: 'on', repair: 'on' } as const

function seeded() {
  let s = emptyRapport(NOW)
  s = applyOwnerTurn(s, { ref: 'chat:t:1', body: "I'll sign up for the marathon", at: NOW, modes: MODES, objectives: [{ id: 'o1', title: 'Run a marathon' }] }).state
  return applyOwnerTurn(s, { ref: 'chat:t:2', body: 'hahaha', at: NOW, modes: MODES, objectives: [] }).state
}

beforeEach(() => {
  h.selectRows = []
  h.lockedRows = []
  h.locks = []
  h.wheres = []
  h.updates = []
  h.inserts = []
})

describe('kairosRapport storage', () => {
  it('a missing key reads as an empty state; a malformed one throws', async () => {
    expect(await readKairosRapport('u1', NOW)).toEqual(emptyRapport(NOW))
    h.selectRows = [{ value: { v: 2 } }]
    await expect(readKairosRapport('u1', NOW)).rejects.toBeInstanceOf(KairosRapportCorruptError)
  })

  it('mutates under FOR UPDATE and merges only its own key', async () => {
    h.lockedRows = [[{ value: emptyRapport(NOW) }]]
    const out = await mutateKairosRapport('u1', (s) => ({ state: { ...s, bids: [{ at: NOW.toISOString(), kind: 'laugh', ref: 'r' }] }, result: 'ok' }), NOW)
    expect(out).toBe('ok')
    expect(h.locks).toEqual(['update'])
    const q = render(h.updates[0].preferences)
    expect(q.sql).toContain('||')
    expect(q.params).toContain(KAIROS_RAPPORT_PREF_KEY)
    expect(JSON.parse(q.params.find((p) => typeof p === 'string' && p.startsWith('{')) as string).bids).toHaveLength(1)
  })

  it('a null mutation writes nothing; a first write inserts the row', async () => {
    h.lockedRows = [[{ value: null }]]
    expect(await mutateKairosRapport('u1', () => ({ state: null, result: 1 }), NOW)).toBe(1)
    expect(h.updates).toHaveLength(0)
    h.lockedRows = [[]]
    await mutateKairosRapport('u1', (s) => ({ state: s, result: undefined }), NOW)
    expect((h.inserts[0].values as { preferences: Record<string, unknown> }).preferences).toHaveProperty(KAIROS_RAPPORT_PREF_KEY)
  })

  it('is server-owned: theme sync strips and carries it, the client never sees it', async () => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [KAIROS_RAPPORT_PREF_KEY]: { v: 1, forged: true } })
    const entry = h.inserts.at(-1)!
    expect((entry.values as { preferences: Record<string, unknown> }).preferences).toEqual({ currentTheme: 'nebula' })
    h.selectRows = [{ preferences: { currentTheme: 'nebula', [KAIROS_RAPPORT_PREF_KEY]: { v: 1 } } }]
    expect(await findPreferences('u1')).not.toHaveProperty(KAIROS_RAPPORT_PREF_KEY)
  })
})

describe('ignored speaks', () => {
  it('only pending (never held) rows, measured from the gate release time when released', async () => {
    h.selectRows = [{ id: 'm1' }]
    expect(await listIgnoredKairosSpeakIds('u1', NOW)).toEqual(['m1'])
    const q = render(h.wheres.at(-1))
    expect(q.sql).toContain("->>'status' = 'pending'")
    expect(q.sql).toContain("coalesce((\"memories\".\"source_metadata\"->'gate'->>'releasedAt')::timestamptz, \"memories\".\"created_at\") <= $")
    expect(q.params).toContain(new Date(NOW.getTime() - 24 * 3_600_000).toISOString())
  })
})

describe('read view', () => {
  it('matches the shared view schema and renders markdown', () => {
    const state = seeded()
    expect(kairosRapportSchema.safeParse(state).success).toBe(true)
    const view = toKairosRapportView(state, { now: NOW, modes: { ...MODES } })
    expect(kairosRapportViewSchema.safeParse(view).success).toBe(true)
    expect(view.goals[0]).toMatchObject({ objectiveId: 'o1', band: 'committed', lastTip: { kind: 'commit' } })
    expect(view.bids30d).toEqual({ count: 1, byKind: { laugh: 1 } })
    const md = renderRapportMarkdown(view)
    expect(md).toContain('# Kairos rapport')
    expect(md).toContain('- Run a marathon: committed')
    expect(getKairosRapportSchema.parse({})).toEqual({ format: 'json' })
  })
})
