import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL } from 'drizzle-orm'

// projects.settings holds unrelated keys (board theme, sizing, Auto AI,
// kairosFeed). Every writer merges in SQL so one surface can't wipe another's.

const state = vi.hoisted(() => ({ set: null as Record<string, unknown> | null, returning: [] as unknown[] }))

vi.mock('@/lib/db', () => ({
  db: {
    update: () => ({
      set: (arg: Record<string, unknown>) => {
        state.set = arg
        return { where: () => ({ returning: async () => state.returning }) }
      },
    }),
  },
}))

import { setProjectKairosFeed, updateProject } from '../projects'

const dialect = new PgDialect()
const PROJECT = '40000000-0000-4000-8000-000000000001'

function settingsQuery() {
  const settings = state.set?.settings
  expect(settings).toBeInstanceOf(SQL)
  return dialect.sqlToQuery(settings as SQL)
}

beforeEach(() => {
  state.set = null
  state.returning = [{ id: PROJECT, settings: {} }]
})

describe('setProjectKairosFeed', () => {
  it('merges kairosFeed into the stored settings instead of replacing them', async () => {
    await setProjectKairosFeed(PROJECT, 'daily')
    const q = settingsQuery()
    expect(q.sql).toContain('coalesce("projects"."settings", \'{}\'::jsonb) ||')
    expect(q.params).toEqual([JSON.stringify({ kairosFeed: 'daily' })])
    expect(state.set?.updatedAt).toBeInstanceOf(Date)
  })

  it('removes only the kairosFeed key when watching stops', async () => {
    await setProjectKairosFeed(PROJECT, null)
    const q = settingsQuery()
    expect(q.sql).toContain("- 'kairosFeed'")
    expect(q.sql).not.toContain('||')
  })

  it('returns null for an unknown project', async () => {
    state.returning = []
    expect(await setProjectKairosFeed(PROJECT, 'weekly')).toBeNull()
  })
})

describe('updateProject settings', () => {
  it('merges a settings patch (MCP update_project / REST PUT) rather than replacing', async () => {
    await updateProject(PROJECT, 'user-1', { name: 'AS Sprint', settings: { boardMode: 'hangar' } })
    const q = settingsQuery()
    expect(q.sql).toContain('coalesce("projects"."settings", \'{}\'::jsonb) ||')
    expect(q.params).toEqual([JSON.stringify({ boardMode: 'hangar' })])
    expect(state.set?.name).toBe('AS Sprint')
  })

  it('never lets a generic settings patch change what Kairos watches (owner-only switch)', async () => {
    await updateProject(PROJECT, 'user-1', { settings: { kairosFeed: 'weekly', boardMode: 'hangar' } })
    expect(settingsQuery().params).toEqual([JSON.stringify({ boardMode: 'hangar' })])
  })

  it('leaves settings untouched when the patch has none', async () => {
    await updateProject(PROJECT, 'user-1', { name: 'Renamed' })
    expect(state.set).not.toHaveProperty('settings')
    expect(state.set?.name).toBe('Renamed')
  })
})
