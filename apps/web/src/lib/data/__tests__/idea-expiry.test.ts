import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// 7-day idea expiry: one UPDATE that archives undecided idea survivors as
// outcome 'ignored'. Never a DELETE — the rows stay in the archive.

const captured = vi.hoisted(() => ({ set: null as Record<string, unknown> | null, where: null as unknown, ops: [] as string[] }))

vi.mock('@/lib/db', () => {
  const chain = {
    set: (v: Record<string, unknown>) => { captured.set = v; return chain },
    where: (w: unknown) => { captured.where = w; return chain },
    returning: async () => [{ id: 'idea-1' }, { id: 'idea-2' }],
  }
  return {
    db: {
      update: vi.fn(() => { captured.ops.push('update'); return chain }),
      delete: vi.fn(() => { captured.ops.push('delete'); return chain }),
    },
  }
})

import { IDEA_EXPIRY_DAYS, expireStaleIdeaProposals } from '../idea-expiry'

const NOW = new Date('2026-10-09T05:00:00.000Z')
const dialect = new PgDialect()

beforeEach(() => {
  captured.set = null
  captured.where = null
  captured.ops.length = 0
})

describe('expireStaleIdeaProposals', () => {
  it('archives pending, undecided idea survivors older than 7 days as ignored — never deletes', async () => {
    expect(IDEA_EXPIRY_DAYS).toBe(7)
    expect(await expireStaleIdeaProposals('u1', NOW)).toEqual(['idea-1', 'idea-2'])
    expect(captured.ops).toEqual(['update'])

    expect(captured.set?.archivedAt).toEqual(NOW)
    const meta = dialect.sqlToQuery(captured.set?.sourceMetadata as SQL)
    expect(meta.sql).toContain(`'{status}'`)
    expect(meta.sql).toContain(`'{idea,outcome}'`)
    expect(meta.params).toEqual(expect.arrayContaining(['ignored', NOW.toISOString()]))

    const where = dialect.sqlToQuery(captured.where as SQL)
    expect(where.sql).toMatch(/"archived_at" is null/)
    expect(where.sql).toContain(`->'idea'->>'outcome' is null`)
    expect(where.sql).toContain(`coalesce("memories"."source_metadata"->>'status', 'pending') = 'pending'`)
    expect(where.sql).toContain(`->'idea'->>'status' = 'survivor'`)
    expect(where.params).toEqual(expect.arrayContaining(['u1', 'inbound', 'idea', new Date(NOW.getTime() - 7 * 86_400_000).toISOString()]))
  })
})
