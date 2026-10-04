import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Wave 4 shared registry edits: the moment preference keys stay server-owned,
// life_chapter is a registered (stub) kind with month helpers, and no payload
// can forge a life chapter row.

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

import { findPreferences, upsertPreferences } from '@/lib/data/preferences'
import { INTERNAL_KIND_REFUSAL, createMemorySchema } from '@/lib/data/validators/memory'
import { thinkingJobKindSchema } from '@/lib/data/validators/thinking'
import { BRAIN_JOBS } from '@/lib/kairos/routines/catalog'
import { PLANNED_THINKING_KINDS, SWEEP_FALLBACK_KINDS } from '@/lib/kairos/thinking/queue'
import {
  LIFE_CHAPTER_DEADLINE_MINUTES,
  isLifeChapterDue,
  monthKey,
  previousMonthWindow,
} from '@/lib/kairos/thinking/deadlines'
import { lifeChapterHandler, lifeChapterJobKey } from '@/lib/kairos/thinking/handlers/life-chapter'
import { KAIROS_GATE_PREF_KEY, KAIROS_OWNER_MODEL_PREF_KEY, KAIROS_RAPPORT_PREF_KEY } from '../pref-keys'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)
const KEYS = [KAIROS_GATE_PREF_KEY, KAIROS_OWNER_MODEL_PREF_KEY, KAIROS_RAPPORT_PREF_KEY]

beforeEach(() => {
  h.selectRows = []
  h.inserts = []
})

describe('moment preference keys stay server-owned', () => {
  it('are the agreed names', () => {
    expect(KEYS).toEqual(['kairosGate', 'kairosOwnerModel', 'kairosRapport'])
  })

  it.each(KEYS)('theme sync strips and carries %s', async (key) => {
    await upsertPreferences('u1', { currentTheme: 'nebula', [key]: { v: 1, forged: true } })
    const [entry] = h.inserts
    expect((entry.values as { preferences: Record<string, unknown> }).preferences).toEqual({ currentTheme: 'nebula' })
    expect(render(entry.set!.preferences).params.filter((p) => p === key)).toHaveLength(3)
  })

  it('findPreferences never hands them to the client', async () => {
    h.selectRows = [{ preferences: { currentTheme: 'nebula', ...Object.fromEntries(KEYS.map((k) => [k, { v: 1 }])) } }]
    const prefs = await findPreferences('u1')
    for (const key of KEYS) expect(prefs).not.toHaveProperty(key)
  })
})

describe('life_chapter registry', () => {
  it('is claimable, planned after weekly_review, monthly in the catalog, and has no paid fallback', () => {
    expect(thinkingJobKindSchema.safeParse('life_chapter').success).toBe(true)
    expect(PLANNED_THINKING_KINDS.indexOf('life_chapter')).toBe(PLANNED_THINKING_KINDS.indexOf('weekly_review') + 1)
    expect(SWEEP_FALLBACK_KINDS).not.toContain('life_chapter')
    expect(BRAIN_JOBS.find((j) => j.kind === 'life_chapter')).toMatchObject({ area: 'Self-model', tier: 'deep', cadence: 'monthly' })
  })

  it('the stub handler plans nothing and has no fallback', async () => {
    expect(await lifeChapterHandler.plan('u', new Date('2026-10-01T13:00:00Z'))).toEqual([])
    expect(await lifeChapterHandler.fallback({} as never)).toEqual({ ok: false, reason: 'no fallback — a missed month is fine' })
    expect(lifeChapterJobKey('2026-09')).toBe('life_chapter:2026-09')
    expect(LIFE_CHAPTER_DEADLINE_MINUTES).toBe(36 * 60)
  })

  it('month helpers: key, previous month (January wrap), due window', () => {
    expect(monthKey(new Date('2026-10-04T10:00:00Z'))).toBe('2026-10')
    expect(previousMonthWindow(new Date('2026-10-02T13:00:00Z'))).toEqual({
      month: '2026-09', start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z'),
    })
    expect(previousMonthWindow(new Date('2027-01-01T12:00:00Z')).month).toBe('2026-12')
    expect(isLifeChapterDue(new Date('2026-10-01T11:59:00Z'))).toBe(false)
    expect(isLifeChapterDue(new Date('2026-10-01T12:00:00Z'))).toBe(true)
    expect(isLifeChapterDue(new Date('2026-10-03T23:00:00Z'))).toBe(true)
    expect(isLifeChapterDue(new Date('2026-10-04T13:00:00Z'))).toBe(false)
  })

  it('no create/capture payload may describe a life chapter', () => {
    const parsed = createMemorySchema.safeParse({ title: 't', bodyMd: 'b', sourceMetadata: { kind: 'life_chapter' } })
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain(INTERNAL_KIND_REFUSAL)
  })
})
