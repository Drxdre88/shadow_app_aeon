import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL } from 'drizzle-orm'

// The card-sorting switch is owner-only: its own writer is scoped to the
// board's creator, and the generic settings merge can never flip it.

const state = vi.hoisted(() => ({
  set: null as Record<string, unknown> | null,
  where: null as unknown,
  returning: [] as unknown[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    update: () => ({
      set: (arg: Record<string, unknown>) => {
        state.set = arg
        return {
          where: (w: unknown) => {
            state.where = w
            return { returning: async () => state.returning }
          },
        }
      },
    }),
  },
}))

import { setProjectCardTriage, writeCardTriages } from '../card-triage'
import { updateProject } from '../projects'

const dialect = new PgDialect()
const PROJECT = '40000000-0000-4000-8000-000000000001'
const OWNER = '50000000-0000-4000-8000-000000000002'

const query = (s: unknown) => dialect.sqlToQuery(s as SQL)

beforeEach(() => {
  state.set = null
  state.where = null
  state.returning = [{ id: PROJECT, settings: {} }]
})

describe('setProjectCardTriage', () => {
  it('merges kairosTriage: on and scopes the update to the board creator', async () => {
    await setProjectCardTriage(PROJECT, OWNER, true)
    expect(state.set?.settings).toBeInstanceOf(SQL)
    const s = query(state.set?.settings)
    expect(s.sql).toContain('coalesce("projects"."settings", \'{}\'::jsonb) ||')
    expect(s.params).toEqual([JSON.stringify({ kairosTriage: 'on' })])
    const w = query(state.where)
    expect(w.sql).toContain('"projects"."user_id" = $')
    expect(w.params).toEqual([PROJECT, OWNER])
  })

  it('removes only the key when switched off', async () => {
    await setProjectCardTriage(PROJECT, OWNER, false)
    const s = query(state.set?.settings)
    expect(s.sql).toContain('- $')
    expect(s.params).toEqual(['kairosTriage'])
  })

  it('returns null when the caller did not create the board', async () => {
    state.returning = []
    expect(await setProjectCardTriage(PROJECT, OWNER, true)).toBeNull()
  })
})

describe('generic settings patches', () => {
  it('cannot switch card sorting on (owner-only switch)', async () => {
    await updateProject(PROJECT, OWNER, { settings: { kairosTriage: 'on', boardMode: 'hangar' } })
    expect(query(state.set?.settings).params).toEqual([JSON.stringify({ boardMode: 'hangar' })])
  })
})

describe('writeCardTriages', () => {
  it('only writes cards without a triage (or this job’s own) and skips the board bump when nothing changed', async () => {
    state.returning = []
    const triage = { v: 1 as const, jobId: 'job-1', at: 'now', labels: [], priority: null, duplicates: [] }
    expect(await writeCardTriages(PROJECT, 'job-1', [{ taskId: 't-1', triage }])).toBe(0)
    const w = query(state.where)
    expect(w.sql).toContain(`-> 'triage') is null`)
    expect(w.sql).toContain(`-> 'triage' ->> 'jobId') = $`)
    const s = query(state.set?.metadata)
    expect(s.sql).toContain(`jsonb_set(coalesce("board_tasks"."metadata", '{}'::jsonb), '{triage}'`)
  })
})
