import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// The persisted ask expiry (docs/kairos/34 §6): the status write is guarded on
// still-pending AND past the stored expiry, never archives, never bumps
// updatedAt, and reports whether this caller won.

const captured: { set?: Record<string, unknown>; where?: unknown } = {}
let returning: unknown[] = []

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  chain.set = (patch: Record<string, unknown>) => {
    captured.set = patch
    return chain
  }
  chain.where = (w: unknown) => {
    captured.where = w
    return chain
  }
  chain.returning = () => Promise.resolve(returning)
  return { db: { update: vi.fn(() => chain) } }
})

import { markKairosAskDismissed, markKairosAskExpired } from '../ask'

const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)
const NOW = new Date('2026-09-30T04:30:00.000Z')

beforeEach(() => {
  captured.set = undefined
  captured.where = undefined
  returning = []
})

describe('markKairosAskExpired', () => {
  it('writes expired status in SQL, guarded on pending + past expiry, without archiving', async () => {
    returning = [{ id: 'ask-1' }]

    await expect(markKairosAskExpired('user-1', 'ask-1', NOW)).resolves.toBe(true)

    expect(Object.keys(captured.set ?? {})).toEqual(['sourceMetadata'])
    const set = render(captured.set!.sourceMetadata)
    expect(set.sql).toContain(`'{kairosAskStatus}', '"expired"'`)
    expect(set.params.join(' ')).toContain('"status":"expired"')
    const where = render(captured.where)
    expect(where.sql).toContain(`->>'kairosAskStatus' = 'pending'`)
    expect(where.sql).toContain(`->>'expiresAt'`)
    expect(where.params).toContain(NOW.toISOString())
  })

  it('returns false when the guard matched nothing (already expired/answered)', async () => {
    returning = []
    await expect(markKairosAskExpired('user-1', 'ask-1', NOW)).resolves.toBe(false)
  })
})

describe('markKairosAskDismissed', () => {
  it('writes dismissed status + archives, guarded on still-pending and NOT yet expired', async () => {
    returning = [{ id: 'ask-1' }]

    await expect(markKairosAskDismissed('user-1', 'ask-1', NOW)).resolves.toBe(true)

    expect(captured.set?.archivedAt).toEqual(NOW)
    const set = render(captured.set!.sourceMetadata)
    expect(set.sql).toContain(`'{kairosAskStatus}', '"dismissed"'`)
    expect(set.params.join(' ')).toContain('"status":"dismissed"')
    const where = render(captured.where)
    expect(where.sql).toContain(`->>'kairosAskStatus' = 'pending'`)
    expect(where.sql).toContain('"archived_at" is null')
    expect(where.sql).toMatch(/IS NULL OR .* > \$\d+::timestamptz/)
  })

  it('returns false when the ask is no longer open', async () => {
    returning = []
    await expect(markKairosAskDismissed('user-1', 'ask-1', NOW)).resolves.toBe(false)
  })
})
