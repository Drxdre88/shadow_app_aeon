import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql, type SQL } from 'drizzle-orm'

// Idea archive data layer (P3): SQL shape of each reader, the tournament write
// (one transaction, advisory lock + probe idempotency, survivor/other row
// shapes with origin), and the atomic outcome jsonb update. No real DB.

type Via = 'db' | 'tx'
interface Call {
  via: Via
  kind: 'execute' | 'select' | 'insert' | 'update'
  arg?: unknown
  where?: unknown
  orderBy?: unknown[]
  limit?: number
}

const state = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  selectQueue: [] as unknown[][],
  insertQueue: [] as unknown[][],
  updateQueue: [] as unknown[][],
  txCount: 0,
}))

vi.mock('@/lib/db', () => {
  function handle(via: 'db' | 'tx') {
    return {
      execute: async (arg: unknown) => {
        state.calls.push({ via, kind: 'execute', arg })
      },
      select: () => {
        const call: Record<string, unknown> = { via, kind: 'select' }
        state.calls.push(call)
        const chain: Record<string, unknown> = {}
        chain.from = () => chain
        chain.where = (w: unknown) => {
          call.where = w
          return chain
        }
        chain.orderBy = (...args: unknown[]) => {
          call.orderBy = args
          return chain
        }
        chain.limit = (n: number) => {
          call.limit = n
          return chain
        }
        chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(state.selectQueue.shift() ?? []).then(res, rej)
        return chain
      },
      insert: () => ({
        values: (arg: unknown) => {
          state.calls.push({ via, kind: 'insert', arg })
          return { returning: async () => state.insertQueue.shift() ?? [] }
        },
      }),
      update: () => ({
        set: (arg: unknown) => {
          const call: Record<string, unknown> = { via, kind: 'update', arg }
          state.calls.push(call)
          return {
            where: (w: unknown) => {
              call.where = w
              return { returning: async () => state.updateQueue.shift() ?? [] }
            },
          }
        },
      }),
    }
  }
  const db = {
    ...handle('db'),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      state.txCount++
      return fn(handle('tx'))
    }),
  }
  return { db }
})

vi.mock('@/lib/data/memories', async () => {
  const { sql } = await import('drizzle-orm')
  return { validAsOfNow: sql`true` }
})
vi.mock('@/lib/data/memory-ops', () => ({ insertMemoryOps: vi.fn() }))
vi.mock('@/lib/kairos/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kairos/embeddings')>()
  return { ...actual, activeEmbeddingModel: () => 'voyage-3.5' }
})

import { db } from '@/lib/db'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'
import {
  IDEA_ORIGIN,
  findNearestIdeaNeighbours,
  inferIdeaOutcome,
  listDirectionStats,
  listIdeaOutcomes,
  listSurvivorEmbeddingsBetween,
  listSurvivorsSince,
  recordIdeaOutcome,
  writeTournament,
} from '../ideas'

const USER = 'user-1'
const DATE = '2026-10-01'
const GEN = 'gen-job-1'
const JUDGE = 'judge-job-1'
const dialect = new PgDialect()
const calls = () => state.calls as unknown as Call[]
const render = (s: unknown) => dialect.sqlToQuery(sql`${s as SQL}`)
const text = (s: unknown) => render(s).sql.replace(/\s+/g, ' ')
const vec = (fill = 0.01) => Array.from({ length: 1024 }, () => fill)

function meta(over: Partial<IdeaMeta> = {}): IdeaMeta {
  return {
    v: 1, tournamentDate: 'WRONG', generateJobId: 'x', judgeJobId: null, key: 'c1', direction: 'focus',
    claim: 'Ship smaller', why: 'less risk', nextStep: 'try it', status: 'survivor', eliminatedReason: null,
    elo: 1040, rank: 1, novelty: { class: 'novel', maxCosine: 0.3, nearestId: null, nearestKind: null },
    critique: null, refined: false, survivedBecause: 'Grounded in three sessions', outcome: null, outcomeAt: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.calls.length = 0
  state.selectQueue.length = 0
  state.insertQueue.length = 0
  state.updateQueue.length = 0
  state.txCount = 0
})

describe('findNearestIdeaNeighbours', () => {
  it('returns [] without a transaction for an empty embedding', async () => {
    expect(await findNearestIdeaNeighbours(USER, [])).toEqual([])
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('queries the three pools in one ef_search transaction with flat <=> KNN', async () => {
    state.selectQueue.push(
      [{ id: 'idea-1', distance: 0.05 }, { id: 'both', distance: 0.2 }],
      [{ id: 'prop-1', distance: 0.1 }],
      [{ id: 'bel-1', distance: '0.4' }],
    )
    const out = await findNearestIdeaNeighbours(USER, [0.1, 0.2], 3)

    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(text(calls()[0].arg)).toBe('SET LOCAL hnsw.ef_search = 100')
    const selects = calls().filter((c) => c.kind === 'select')
    expect(selects).toHaveLength(3)
    expect(selects.every((c) => c.via === 'tx' && c.limit === 3)).toBe(true)
    for (const s of selects) expect(text(s.orderBy![0])).toContain('<=>')

    const [archive, proposals, beliefs] = selects.map((s) => text(s.where))
    expect(archive).toContain(`jsonb_typeof("memories"."source_metadata"->'idea') = 'object'`)
    expect(archive).not.toContain('archived_at')
    expect(proposals).toContain('"memories"."type" = $')
    expect(proposals).toContain(`->>'status' = 'pending'`)
    expect(proposals).toContain('"memories"."archived_at" is null')
    expect(proposals).toContain(`NOT coalesce(jsonb_typeof("memories"."source_metadata"->'idea') = 'object', false)`)
    expect(render(selects[1].where).params).toContain('inbound')
    expect(beliefs).toContain(`->'belief'->>`)
    expect(beliefs).toContain('"memories"."superseded_at" is null')
    for (const w of [archive, proposals, beliefs]) expect(w).toContain('"memories"."embedding" is not null')

    expect(out).toEqual([
      { id: 'idea-1', kind: 'idea', similarity: 0.95 },
      { id: 'prop-1', kind: 'proposal', similarity: 0.9 },
      { id: 'both', kind: 'idea', similarity: 0.8 },
    ])
  })

  it('tags a row found in both the archive and another pool as idea', async () => {
    state.selectQueue.push([{ id: 'dup', distance: 0.3 }], [{ id: 'dup', distance: 0.1 }], [])
    const out = await findNearestIdeaNeighbours(USER, [1, 0])
    expect(out).toEqual([{ id: 'dup', kind: 'idea', similarity: 0.7 }])
  })
})

describe('writeTournament', () => {
  const input = () => ({
    tournamentDate: DATE,
    generateJobId: GEN,
    judgeJobId: JUDGE,
    survivors: [
      { title: 'Idea A', bodyMd: 'body a', embedding: vec(), citedIds: ['m-1', 'm-2', 'm-1'], dominionId: 'dom-1', meta: meta({ survivedBecause: 'x'.repeat(400) }) },
    ],
    others: [
      { title: 'Idea B', bodyMd: 'body b', embedding: vec(0.02), dominionId: null, meta: meta({ key: 'c2', status: 'repeat', elo: null, survivedBecause: null }) },
      { title: 'Idea C', bodyMd: 'body c', embedding: [1, 2, 3], dominionId: null, meta: meta({ key: 'c3', status: 'survivor' }) },
    ],
  })

  it('locks, probes, and writes survivors + archived others on the tx handle', async () => {
    state.selectQueue.push([]) // probe: nothing yet
    state.insertQueue.push([{ id: 's-1' }], [{ id: 'o-1' }], [{ id: 'o-2' }])
    const res = await writeTournament(USER, input())

    expect(res).toEqual({ written: true, survivorIds: ['s-1'], archivedIds: ['o-1', 'o-2'] })
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(calls().every((c) => c.via === 'tx')).toBe(true)

    const lock = render(calls()[0].arg)
    expect(lock.sql).toContain('pg_advisory_xact_lock(hashtext($1), hashtext($2))')
    expect(lock.params).toEqual([USER, `idea_tournament:${DATE}`])
    const probe = render(calls()[1].where)
    expect(probe.sql).toContain(`->'idea'->>`)
    expect(probe.params).toEqual(expect.arrayContaining([USER, 'tournamentDate', DATE]))

    const inserts = calls().filter((c) => c.kind === 'insert').map((c) => c.arg as Record<string, unknown>)
    const [survivor, repeat, coerced] = inserts
    expect(survivor).toMatchObject({
      userId: USER,
      dominionId: 'dom-1',
      title: 'Idea A',
      type: 'inbound',
      streamClass: 'agentic',
      source: 'cron',
      tags: ['proposal', 'idea'],
      embeddingModel: 'voyage-3.5',
      links: [
        { type: 'refers_to', target: 'm-1', target_kind: 'memory' },
        { type: 'refers_to', target: 'm-2', target_kind: 'memory' },
      ],
    })
    expect(survivor).not.toHaveProperty('archivedAt')
    expect((survivor.summary as string).length).toBe(240)
    expect(survivor.embedding).toHaveLength(1024)
    expect(survivor.sourceMetadata).toEqual({
      introspection: true,
      kind: 'idea',
      status: 'pending',
      citations: ['m-1', 'm-2'],
      idea: { ...meta({ survivedBecause: 'x'.repeat(400) }), tournamentDate: DATE, generateJobId: GEN, judgeJobId: JUDGE },
      origin: { kind: 'kairos', via: 'cron:idea-tournament' },
    })

    expect(repeat).toMatchObject({ type: 'idea_candidate', streamClass: 'trace', source: 'cron', embeddingModel: 'voyage-3.5' })
    expect(repeat.archivedAt).toBeInstanceOf(Date)
    expect(repeat.sourceMetadata).toEqual({
      idea: { ...meta({ key: 'c2', status: 'repeat', elo: null, survivedBecause: null }), tournamentDate: DATE, generateJobId: GEN, judgeJobId: JUDGE },
      origin: IDEA_ORIGIN,
    })
    // a short (non-1024) vector is not stored; an "other" can never be a survivor
    expect(coerced).not.toHaveProperty('embedding')
    expect(coerced).not.toHaveProperty('embeddingModel')
    expect((coerced.sourceMetadata as { idea: IdeaMeta }).idea.status).toBe('eliminated')
  })

  it('is idempotent: a repeat returns written:false with the stored ids and inserts nothing', async () => {
    state.selectQueue.push([
      { id: 'o-2', status: 'eliminated', key: 'c3' },
      { id: 's-1', status: 'survivor', key: 'c1' },
      { id: 'o-1', status: 'repeat', key: 'c2' },
    ])
    const res = await writeTournament(USER, input())
    // returned in the caller's candidate order, not the probe's row order
    expect(res).toEqual({ written: false, survivorIds: ['s-1'], archivedIds: ['o-1', 'o-2'] })
    expect(calls().filter((c) => c.kind === 'insert')).toHaveLength(0)
    expect(text(calls()[0].arg)).toContain('pg_advisory_xact_lock')
  })

  it('omits the embedding when none is supplied', async () => {
    state.selectQueue.push([])
    state.insertQueue.push([{ id: 's-1' }])
    await writeTournament(USER, { ...input(), survivors: [{ ...input().survivors[0], embedding: null }], others: [] })
    const [row] = calls().filter((c) => c.kind === 'insert').map((c) => c.arg as Record<string, unknown>)
    expect(row).not.toHaveProperty('embedding')
  })
})

describe('recordIdeaOutcome', () => {
  it('sets idea.outcome + outcomeAt atomically, found by id and idea meta (not type)', async () => {
    state.updateQueue.push([{ id: 'mem-1' }])
    const now = new Date('2026-10-02T08:00:00Z')
    expect(await recordIdeaOutcome(USER, 'mem-1', 'accepted', now)).toBe(true)

    const [upd] = calls().filter((c) => c.kind === 'update')
    expect(upd.via).toBe('db')
    const set = upd.arg as { sourceMetadata: SQL; updatedAt: Date }
    const q = render(set.sourceMetadata)
    expect(q.sql).toContain(`jsonb_set(jsonb_set("memories"."source_metadata", '{idea,outcome}', to_jsonb($1::text)), '{idea,outcomeAt}', to_jsonb($2::text))`)
    expect(q.params).toEqual(['accepted', '2026-10-02T08:00:00.000Z'])
    expect(set.updatedAt).toBe(now)
    const where = render(upd.where)
    expect(where.sql).toContain(`jsonb_typeof("memories"."source_metadata"->'idea') = 'object'`)
    expect(where.sql).not.toContain('"memories"."type"')
    expect(where.params).toEqual(expect.arrayContaining(['mem-1', USER]))
  })

  it('returns false when the row has no idea meta', async () => {
    state.updateQueue.push([])
    expect(await recordIdeaOutcome(USER, 'mem-x', 'dismissed')).toBe(false)
  })
})

describe('outcomes', () => {
  const at = new Date('2026-09-30T00:00:00Z')
  const row = (id: string, sm: Record<string, unknown>, archivedAt: Date | null = null, direction = 'focus') => ({
    id, title: id, archivedAt, createdAt: at,
    sourceMetadata: { ...sm, idea: { status: 'survivor', direction, claim: `claim ${id}`, outcome: null, ...(sm.idea as object) } },
  })

  it('infers outcomes for legacy rows and ignores engine statuses', () => {
    expect(inferIdeaOutcome({ sourceMetadata: { status: 'pending', idea: { outcome: 'dismissed' } }, archivedAt: null })).toBe('dismissed')
    expect(inferIdeaOutcome({ sourceMetadata: { status: 'accepted', idea: {} }, archivedAt: null })).toBe('accepted')
    expect(inferIdeaOutcome({ sourceMetadata: { status: 'pending', idea: {} }, archivedAt: at })).toBe('dismissed')
    expect(inferIdeaOutcome({ sourceMetadata: { status: 'dismissed', idea: {} }, archivedAt: at })).toBe('dismissed')
    expect(inferIdeaOutcome({ sourceMetadata: { status: 'decayed', idea: {} }, archivedAt: at })).toBeNull()
    expect(inferIdeaOutcome({ sourceMetadata: { status: 'promoted', idea: {} }, archivedAt: null })).toBeNull()
    expect(inferIdeaOutcome({ sourceMetadata: { status: 'pending', idea: {} }, archivedAt: null })).toBeNull()
  })

  it('listIdeaOutcomes reads survivors since the window and keeps only decided ones', async () => {
    state.selectQueue.push([
      row('a', { status: 'accepted' }),
      row('b', { status: 'pending' }, at),
      row('c', { status: 'pending' }),
      row('d', { status: 'decayed' }, at),
      row('e', { status: 'pending', idea: { outcome: 'accepted', direction: 'craft', claim: 'claim e' } }),
    ])
    const out = await listIdeaOutcomes(USER, 30)
    expect(out).toEqual([
      { id: 'a', title: 'a', direction: 'focus', claim: 'claim a', outcome: 'accepted' },
      { id: 'b', title: 'b', direction: 'focus', claim: 'claim b', outcome: 'dismissed' },
      { id: 'e', title: 'e', direction: 'craft', claim: 'claim e', outcome: 'accepted' },
    ])
    const [sel] = calls().filter((c) => c.kind === 'select')
    const w = render(sel.where)
    expect(w.sql).toContain(`jsonb_typeof("memories"."source_metadata"->'idea') = 'object'`)
    expect(w.sql).toContain('"memories"."created_at" >= $')
    expect(w.sql).toContain("->>$2 = 'survivor'")
    expect(w.params).toEqual(expect.arrayContaining([USER, 'status']))
    const since = w.params.find((p) => p instanceof Date || (typeof p === 'string' && /^\d{4}-/.test(p)))
    expect(since).toBeDefined()
  })

  it('listDirectionStats groups survivors and outcomes by direction', async () => {
    state.selectQueue.push([
      row('a', { status: 'accepted' }, null, 'focus'),
      row('b', { status: 'pending' }, at, 'focus'),
      row('c', { status: 'pending' }, null, 'focus'),
      row('d', { status: 'accepted' }, null, 'craft'),
    ])
    expect(await listDirectionStats(USER)).toEqual([
      { direction: 'focus', survivors: 3, accepted: 1, dismissed: 1 },
      { direction: 'craft', survivors: 1, accepted: 1, dismissed: 0 },
    ])
  })
})

describe('survivor reads', () => {
  it('listSurvivorsSince orders by elo desc nulls last, then newest, and maps status', async () => {
    const since = new Date('2026-09-25T00:00:00Z')
    const created = new Date('2026-09-30T03:00:00Z')
    state.selectQueue.push([
      { id: 's1', title: 'A', archivedAt: null, createdAt: created, sourceMetadata: { status: 'accepted', idea: { claim: 'c', survivedBecause: 'why', elo: 1050, direction: 'd', tournamentDate: '2026-09-30' } } },
      { id: 's2', title: 'B', archivedAt: created, createdAt: created, sourceMetadata: { status: 'pending', idea: { claim: 'c2', elo: null } } },
    ])
    const out = await listSurvivorsSince(USER, since, 2)
    expect(out).toEqual([
      { id: 's1', title: 'A', claim: 'c', survivedBecause: 'why', elo: 1050, direction: 'd', tournamentDate: '2026-09-30', status: 'accepted', createdAt: created },
      { id: 's2', title: 'B', claim: 'c2', survivedBecause: null, elo: null, direction: '', tournamentDate: '', status: 'dismissed', createdAt: created },
    ])
    const [sel] = calls().filter((c) => c.kind === 'select')
    expect(sel.limit).toBe(2)
    expect(text(sel.orderBy![0])).toContain(`::float8 END) DESC NULLS LAST`)
    expect(text(sel.orderBy![1])).toBe('"memories"."created_at" desc')
    expect(render(sel.where).sql).toContain("= 'survivor'")
  })

  it('listSurvivorEmbeddingsBetween bounds created_at to [from, to) and skips empty vectors', async () => {
    state.selectQueue.push([{ id: 'a', embedding: [1, 0] }, { id: 'b', embedding: null }, { id: 'c', embedding: [0, 1] }])
    const out = await listSurvivorEmbeddingsBetween(USER, new Date('2026-09-24'), new Date('2026-10-01'))
    expect(out.map((r) => r.id)).toEqual(['a', 'c'])
    const [sel] = calls().filter((c) => c.kind === 'select')
    const w = text(sel.where)
    expect(w).toContain('"memories"."created_at" >= $')
    expect(w).toContain('"memories"."created_at" < $')
    expect(w).toContain('"memories"."embedding" is not null')
  })
})
