import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const captured = vi.hoisted(() => ({ where: null as unknown, order: [] as unknown[], limit: 0, rows: [] as unknown[] }))

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = (w: unknown) => { captured.where = w; return chain }
  chain.orderBy = (...o: unknown[]) => { captured.order = o; return chain }
  chain.limit = (n: number) => { captured.limit = n; return Promise.resolve(captured.rows) }
  return { db: { select: vi.fn(() => chain) } }
})
vi.mock('@/lib/data/constitution', () => ({ findLiveConstitutionRow: vi.fn() }))

import { findLiveConstitutionRow } from '@/lib/data/constitution'
import { getConsciencePrinciples, listConscienceBeliefs } from '../conscience'

const USER = 'user-1'
const DOM = 'd0000000-0000-4000-8000-000000000001'
const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)

function beliefMeta(over: Record<string, unknown> = {}) {
  return {
    belief: {
      v: 1, mind: 'aligned', domain: 'Aeon', dominionId: DOM, claim: 'Ship small', reasons: [], falsifier: 'x',
      sourceType: 'operator', provenance: [], status: 'held', confidence: 0.8, ...over,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.where = null
  captured.order = []
  captured.rows = []
})

describe('listConscienceBeliefs', () => {
  it('Dominion filter: that Dominion or global only, Dominion rows first, then standing', async () => {
    captured.rows = [{ sourceMetadata: beliefMeta() }, { sourceMetadata: beliefMeta({ domain: 'general', dominionId: null, mind: 'own' }) }]
    const out = await listConscienceBeliefs(USER, { dominionId: DOM, limit: 12 })
    const where = render(captured.where)
    expect(where.sql).toMatch(/"dominion_id" = \$\d+ OR "memories"\."dominion_id" IS NULL/)
    expect(where.params).toContain(DOM)
    expect(where.sql).toContain("'held'")
    expect(where.sql).toMatch(/"superseded_at" is null/)
    const order = captured.order.map((o) => render(o).sql)
    expect(order[0]).toMatch(/CASE WHEN "memories"\."dominion_id" = \$\d+ THEN 0 ELSE 1 END/)
    expect(order[1]).toMatch(/"standing" DESC NULLS LAST/)
    expect(captured.limit).toBe(12)
    expect(out).toEqual([
      { mind: 'aligned', domain: 'Aeon', dominionId: DOM, claim: 'Ship small', confidence: 0.8 },
      { mind: 'own', domain: 'general', dominionId: null, claim: 'Ship small', confidence: 0.8 },
    ])
  })

  it('whole-brain: no Dominion predicate, standing first', async () => {
    await listConscienceBeliefs(USER)
    expect(render(captured.where).sql).not.toMatch(/dominion_id/)
    expect(render(captured.order[0]).sql).toMatch(/"standing" DESC NULLS LAST/)
  })

  it('drops rows whose belief payload does not parse or is not held', async () => {
    captured.rows = [{ sourceMetadata: { belief: { v: 2 } } }, { sourceMetadata: beliefMeta({ status: 'retired' }) }]
    expect(await listConscienceBeliefs(USER)).toEqual([])
  })
})

describe('getConsciencePrinciples', () => {
  it('null when no live constitution', async () => {
    vi.mocked(findLiveConstitutionRow).mockResolvedValue(null)
    expect(await getConsciencePrinciples(USER)).toBeNull()
  })

  it('reads version + principles from the live row', async () => {
    vi.mocked(findLiveConstitutionRow).mockResolvedValue({
      id: 'c1', title: 't', bodyMd: '', createdAt: new Date(), supersededAt: null,
      sourceMetadata: { constitution: { version: 2, acceptedFrom: 'p1', principles: [{ n: 1, text: 'Be honest', reason: 'Trust' }] } },
    })
    expect(await getConsciencePrinciples(USER)).toEqual({ version: 2, principles: [{ n: 1, text: 'Be honest', reason: 'Trust' }] })
  })
})
