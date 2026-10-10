import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// The query side of the entity map: n-gram lookup, the same alias rules as
// the scan (capitalised-only stoplist, exact initials), and fail-safe reads.

let aliasRows: Array<Record<string, unknown>> = []
let executeThrows = false
const executed: unknown[] = []

vi.mock('@/lib/db', () => ({
  db: {
    execute: vi.fn(async (q: unknown) => {
      executed.push(q)
      if (executeThrows) throw new Error('alias table missing')
      return { rows: aliasRows }
    }),
  },
}))

import { entityLeg, listWorthyEntities, matchQueryEntities, queryGrams } from '../search-entity'

const ids = async (q: string) => (await matchQueryEntities('u1', q)).map((m) => m.id)

const dialect = new PgDialect()
const SWARM = 'a0000000-0000-4000-8000-000000000001'
const WRAITH = 'a0000000-0000-4000-8000-000000000002'
const MG = 'a0000000-0000-4000-8000-000000000003'
const SURVIVOR = 'a0000000-0000-4000-8000-000000000009'

beforeEach(() => {
  vi.clearAllMocks()
  aliasRows = []
  executeThrows = false
  executed.length = 0
})

describe('queryGrams', () => {
  it('yields 1..n word windows, edge punctuation and possessives stripped', () => {
    const grams = queryGrams("why did Wraith's deploy fail?")
    expect(grams.map((g) => g.raw)).toContain('Wraith')
    expect(grams.map((g) => g.norm)).toContain('wraith deploy')
    expect(grams.map((g) => g.raw)).toContain('fail')
  })

  it('drops generic words', () => {
    expect(queryGrams('the data app').map((g) => g.norm)).not.toContain('data')
  })
})

describe('matchQueryEntities', () => {
  it('a stoplisted alias counts only when capitalised in the query', async () => {
    aliasRows = [{ entity_id: SWARM, alias: 'Swarm', alias_norm: 'swarm', kind: 'repo' }]
    expect(await ids('swarm of bees')).toEqual([])
    expect(await ids('Swarm backtest')).toEqual([SWARM])
  })

  it('initials need an exact case-sensitive match', async () => {
    aliasRows = [{ entity_id: MG, alias: 'MG', alias_norm: 'mg', kind: 'person' }]
    expect(await ids('take 5 mg')).toEqual([])
    expect(await ids('ask MG about it')).toEqual([MG])
  })

  it('ordinary aliases match in any case; the lookup is scoped to the user', async () => {
    aliasRows = [{ entity_id: WRAITH, alias: 'wraith', alias_norm: 'wraith', kind: 'repo' }]
    expect(await ids('wraith outage')).toEqual([WRAITH])
    const q = dialect.sqlToQuery(executed[0] as SQL)
    expect(q.params).toContain('u1')
    expect(q.params).toContain('wraith')
    expect(q.sql).toContain("e.status = 'merged'")
  })

  it('returns the survivor id the SQL resolved for a merged entity', async () => {
    aliasRows = [{ entity_id: SURVIVOR, alias: 'wraith', alias_norm: 'wraith', kind: 'repo' }]
    expect(await ids('wraith')).toEqual([SURVIVOR])
  })
})

describe('match strength', () => {
  it('a capitalised word, exact initials or a slug / multi-word alias is strong', async () => {
    aliasRows = [
      { entity_id: WRAITH, alias: 'wraith', alias_norm: 'wraith', kind: 'repo', mentions: 117 },
      { entity_id: SWARM, alias: 'shadow_app_swarm', alias_norm: 'shadow_app_swarm', kind: 'repo', mentions: 810 },
      { entity_id: MG, alias: 'MG', alias_norm: 'mg', kind: 'person', mentions: 4 },
    ]
    const m = await matchQueryEntities('u1', 'Wraith and shadow_app_swarm, ask MG')
    expect(m).toEqual(expect.arrayContaining([
      { id: WRAITH, strong: true, specific: false, mentions: 117 },
      { id: SWARM, strong: true, specific: true, mentions: 810 },
      { id: MG, strong: true, specific: false, mentions: 4 },
    ]))
  })

  it('a lowercase single word is a weak match', async () => {
    aliasRows = [{ entity_id: WRAITH, alias: 'wraith', alias_norm: 'wraith', kind: 'repo', mentions: 117 }]
    expect(await matchQueryEntities('u1', 'wraith outage')).toEqual([
      { id: WRAITH, strong: false, specific: false, mentions: 117 },
    ])
  })

  it('the lookup counts mentions of the resolved entity', async () => {
    aliasRows = [{ entity_id: WRAITH, alias: 'wraith', alias_norm: 'wraith', kind: 'repo', mentions: 3 }]
    await matchQueryEntities('u1', 'Wraith')
    expect(dialect.sqlToQuery(executed[0] as SQL).sql).toContain('FROM entity_mentions m WHERE m.user_id')
  })
})

describe('listWorthyEntities', () => {
  const m = (id: string, strong: boolean, specific: boolean, mentions: number) => ({ id, strong, specific, mentions })

  it('drops weak matches', () => {
    expect(listWorthyEntities([m(WRAITH, false, false, 117)])).toEqual([])
  })

  it('a strong single word on a rare entity fires; on a very common one it does not', () => {
    expect(listWorthyEntities([m(WRAITH, true, false, 117)])).toEqual([WRAITH])
    expect(listWorthyEntities([m(SWARM, true, false, 871)])).toEqual([])
    expect(listWorthyEntities([m(SWARM, true, false, 300)])).toEqual([SWARM])
  })

  it('a very common entity still fires on a specific alias', () => {
    expect(listWorthyEntities([m(SWARM, true, true, 871)])).toEqual([SWARM])
  })
})

describe('entityLeg', () => {
  it('skips the memory fetch when no entity is named', async () => {
    const fetch = vi.fn(async () => [])
    expect(await entityLeg({ userId: 'u1', query: 'launch plan', fetch })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('skips the fetch on a weak or too-common match', async () => {
    const fetch = vi.fn(async () => [])
    aliasRows = [{ entity_id: WRAITH, alias: 'wraith', alias_norm: 'wraith', kind: 'repo', mentions: 117 }]
    expect(await entityLeg({ userId: 'u1', query: 'wraith outage', fetch })).toEqual([])
    aliasRows = [{ entity_id: SWARM, alias: 'Swarm', alias_norm: 'swarm', kind: 'repo', mentions: 871 }]
    expect(await entityLeg({ userId: 'u1', query: 'history of the leak in Swarm', fetch })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches a capped list with an EXISTS filter over the strong matches', async () => {
    aliasRows = [{ entity_id: WRAITH, alias: 'wraith', alias_norm: 'wraith', kind: 'repo', mentions: 117 }]
    const fetch = vi.fn(async (_m: SQL, _cap: number) => [{ id: 'm1' }])
    expect(await entityLeg({ userId: 'u1', query: 'Wraith outage', fetch })).toEqual([{ id: 'm1' }])
    const mentions = dialect.sqlToQuery(fetch.mock.calls[0][0])
    expect(mentions.sql).toContain('EXISTS (SELECT 1 FROM entity_mentions em')
    expect(mentions.params).toEqual(expect.arrayContaining(['u1', WRAITH]))
    expect(fetch.mock.calls[0][1]).toBe(8)
  })

  it('warns and returns nothing when the lookup fails', async () => {
    executeThrows = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await entityLeg({ userId: 'u1', query: 'wraith', fetch: vi.fn() })).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[search-entity]'), 'alias table missing')
    warn.mockRestore()
  })
})
