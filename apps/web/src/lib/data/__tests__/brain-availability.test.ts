import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// Brain availability: one cheap exists query — did this user's brain routine
// claim any brain-scoped job in the last 26 h?

const h = vi.hoisted(() => ({ rows: [] as unknown[], where: null as unknown, limit: 0 }))

vi.mock('@/lib/db', () => {
  const c: Record<string, unknown> = {}
  c.from = () => c
  c.where = (w: unknown) => { h.where = w; return c }
  c.limit = (n: number) => { h.limit = n; return Promise.resolve(h.rows) }
  return { db: { select: () => c } }
})

import { brainRoutineClaimedRecently } from '../brain-availability'
import { getRoutine } from '@/lib/kairos/routines/catalog'

const NOW = new Date('2026-10-07T06:00:00.000Z')

beforeEach(() => {
  h.rows = []
  h.where = null
  h.limit = 0
})

describe('brainRoutineClaimedRecently', () => {
  it('is true when a routine claim exists in the window', async () => {
    h.rows = [{ id: 'job-1' }]
    expect(await brainRoutineClaimedRecently('user-1', NOW)).toBe(true)
    expect(h.limit).toBe(1)
  })

  it('is false when nothing was claimed', async () => {
    expect(await brainRoutineClaimedRecently('user-1', NOW)).toBe(false)
  })

  it("scopes to the user, the last 26 h, routine claimants and the brain's kinds", async () => {
    await brainRoutineClaimedRecently('user-1', NOW)
    const { sql, params } = new PgDialect().sqlToQuery(h.where as SQL)
    expect(sql).toMatch(/"user_id" = \$1/)
    expect(sql).toMatch(/"claimed_at" >= \$2/)
    expect(sql).toMatch(/"claimed_by" like \$3/)
    expect(params.slice(0, 3)).toEqual(['user-1', '2026-10-06T04:00:00.000Z', 'routine%'])
    expect(params.slice(3)).toEqual([...getRoutine('brain').allowedKinds])
    expect(params).toContain('card_tree')
  })
})
