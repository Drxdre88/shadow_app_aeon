import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Pins the gate's SQL: the single-flight claim, the held-row listing and the
// FOR UPDATE preference write (same drizzle stand-in as kairos-rapport.test.ts).

const h = vi.hoisted(() => ({
  wheres: [] as unknown[],
  orders: [] as unknown[][],
  limits: [] as number[],
  locks: [] as Array<{ mode: string; inTx: boolean }>,
  inTx: false,
  lockedRows: [] as unknown[][],
  updates: [] as Array<{ set: Record<string, unknown>; where?: unknown; inTx: boolean }>,
  returning: [] as unknown[][],
}))

vi.mock('@/lib/db', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: unknown) => { h.wheres.push(w); return chain }
    chain.orderBy = (...o: unknown[]) => { h.orders.push(o); return chain }
    chain.limit = (n: number) => { h.limits.push(n); return chain }
    chain.for = (mode: string) => {
      h.locks.push({ mode, inTx: h.inTx })
      return Promise.resolve(h.lockedRows.shift() ?? [])
    }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  const update = () => ({
    set: (set: Record<string, unknown>) => {
      const entry: (typeof h.updates)[number] = { set, inTx: h.inTx }
      h.updates.push(entry)
      const whereStep = (w: unknown) => {
        entry.where = w
        const done = Promise.resolve(undefined) as Promise<undefined> & { returning?: () => Promise<unknown[]> }
        done.returning = async () => h.returning.shift() ?? []
        return done
      }
      return { where: whereStep }
    },
  })
  const insert = () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ userId: 'u1' }] }) }) })
  const tx = { select: vi.fn(selectChain), update: vi.fn(update), insert: vi.fn(insert) }
  return {
    db: {
      select: vi.fn(selectChain),
      update: vi.fn(update),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        h.inTx = true
        try { return await fn(tx) } finally { h.inTx = false }
      }),
    },
  }
})

import { appendKairosGateLog, claimHeldSpeak, listHeldSpeaks, mutateKairosGate } from '../kairos-gate'
import { KAIROS_GATE_PREF_KEY } from '@/lib/kairos/moment/pref-keys'
import { emptyGateState } from '@/lib/kairos/moment/gate/receptivity'

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL)
const NOW = new Date('2026-10-04T12:00:00.000Z')
const SPEAK_SCOPE = [
  '"memories"."user_id" = $',
  '"memories"."type" = $',
  '"memories"."source" = $',
  `"memories"."source_metadata"->>'kairosSpeak' = 'true'`,
]

beforeEach(() => {
  h.wheres = []
  h.orders = []
  h.limits = []
  h.locks = []
  h.lockedRows = []
  h.updates = []
  h.returning = []
})

describe('claimHeldSpeak', () => {
  it('only flips a row of this owner that is still held, stamping the release', async () => {
    h.returning = [[{ id: 'm1', title: 't', bodyMd: 'b', createdAt: NOW, sourceMetadata: {} }]]
    const row = await claimHeldSpeak('u1', 'm1', NOW, 'deadline')
    expect(row?.id).toBe('m1')

    const where = render(h.updates[0].where)
    for (const part of SPEAK_SCOPE) expect(where.sql).toContain(part)
    expect(where.sql).toContain('"memories"."id" = $')
    expect(where.sql).toContain(`"memories"."source_metadata"->>'status' = 'held'`)
    expect(where.params).toEqual(expect.arrayContaining(['u1', 'inbound', 'system', 'm1']))

    const set = render(h.updates[0].set.sourceMetadata)
    expect(set.sql).toContain(`"memories"."source_metadata" || jsonb_build_object(`)
    expect(set.sql).toContain(`'status', 'pending'`)
    expect(set.sql).toContain(`'gate', coalesce("memories"."source_metadata"->'gate', '{}'::jsonb) ||`)
    expect(set.params.map((p) => (typeof p === 'string' && p.startsWith('{') ? JSON.parse(p) : p)))
      .toContainEqual({ releasedAt: NOW.toISOString(), releaseReason: 'deadline' })
    expect(h.updates[0].set.updatedAt).toBe(NOW)
  })

  it('a lost race returns null', async () => {
    h.returning = [[]]
    expect(await claimHeldSpeak('u1', 'm1', NOW, 'deadline')).toBeNull()
  })
})

describe('listHeldSpeaks', () => {
  it('filters this owner\'s held speaks, oldest first, with a clamped limit', async () => {
    await listHeldSpeaks('u1', 500)
    const where = render(h.wheres[0])
    for (const part of SPEAK_SCOPE) expect(where.sql).toContain(part)
    expect(where.sql).toContain(`"memories"."source_metadata"->>'status' = 'held'`)
    expect(render(h.orders[0][0]).sql).toBe('"memories"."created_at" asc')
    expect(h.limits).toEqual([100])
  })
})

describe('mutateKairosGate', () => {
  it('locks the preferences row FOR UPDATE inside a transaction and merges only its own key', async () => {
    h.lockedRows = [[{ value: emptyGateState() }]]
    await appendKairosGateLog('u1', [{ at: NOW.toISOString(), memoryId: 'm1', mode: 'on', decision: 'release', reason: 'deadline' }])
    expect(h.locks).toEqual([{ mode: 'update', inTx: true }])
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0].inTx).toBe(true)
    const q = render(h.updates[0].set.preferences)
    expect(q.sql).toContain('"user_preferences"."preferences" || jsonb_build_object(')
    expect(q.params).toContain(KAIROS_GATE_PREF_KEY)
    const written = JSON.parse(q.params.find((p) => typeof p === 'string' && p.startsWith('{')) as string)
    expect(written.log).toEqual([expect.objectContaining({ memoryId: 'm1', decision: 'release' })])
  })

  it('a null mutation writes nothing', async () => {
    h.lockedRows = [[{ value: null }]]
    expect(await mutateKairosGate('u1', () => ({ state: null, result: 'kept' }))).toBe('kept')
    expect(h.locks).toEqual([{ mode: 'update', inTx: true }])
    expect(h.updates).toHaveLength(0)
  })
})
