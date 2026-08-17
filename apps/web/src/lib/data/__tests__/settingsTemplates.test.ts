import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectQueue: unknown[][] = []
const inserted: Array<{ values: Record<string, unknown>; conflict: string; set?: Record<string, unknown> }> = []

vi.mock('@/lib/db', () => {
  function selectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  function insertChain() {
    const chain: Record<string, unknown> = {}
    let pending: Record<string, unknown> = {}
    chain.values = (values: Record<string, unknown>) => {
      pending = values
      return chain
    }
    chain.onConflictDoUpdate = (cfg: { set: Record<string, unknown> }) => {
      inserted.push({ values: pending, conflict: 'update', set: cfg.set })
      return Promise.resolve()
    }
    chain.onConflictDoNothing = () => {
      inserted.push({ values: pending, conflict: 'nothing' })
      return Promise.resolve()
    }
    return chain
  }
  return {
    db: {
      select: vi.fn(() => selectChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => insertChain()),
    },
  }
})

vi.mock('@/lib/db/schema', () => ({
  settingsTemplates: new Proxy({}, { get: () => ({}) }),
  userPreferences: new Proxy({}, { get: () => ({}) }),
}))

import { DEFAULT_PREFERENCES } from '@aeon/shared'
import {
  BUSINESS_ADMIN_FALLBACK,
  BUSINESS_ADMIN_TEMPLATE,
  applyDefaultTemplateToUser,
  findTemplate,
  listTemplates,
  upsertTemplate,
} from '../settingsTemplates'

const STORED = {
  id: 'tpl-1',
  name: BUSINESS_ADMIN_TEMPLATE,
  preferences: { businessMode: true, glowIntensity: 5 },
  createdBy: 'admin-1',
  updatedAt: new Date('2026-08-17T00:00:00.000Z'),
}

beforeEach(() => {
  selectQueue.length = 0
  inserted.length = 0
})

describe('settingsTemplates data layer', () => {
  it('findTemplate returns the row when present', async () => {
    selectQueue.push([STORED])
    await expect(findTemplate(BUSINESS_ADMIN_TEMPLATE)).resolves.toEqual(STORED)
  })

  it('findTemplate returns null when missing', async () => {
    selectQueue.push([])
    await expect(findTemplate('nope')).resolves.toBeNull()
  })

  it('listTemplates returns every row', async () => {
    selectQueue.push([STORED])
    await expect(listTemplates()).resolves.toEqual([STORED])
  })

  it('upsertTemplate writes name, preferences and author, updating on conflict', async () => {
    await upsertTemplate('business_admin', { glowIntensity: 20 }, 'admin-1')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].conflict).toBe('update')
    expect(inserted[0].values).toMatchObject({
      name: 'business_admin',
      preferences: { glowIntensity: 20 },
      createdBy: 'admin-1',
    })
    expect(inserted[0].set).toMatchObject({ preferences: { glowIntensity: 20 } })
  })
})

describe('applyDefaultTemplateToUser', () => {
  it('stamps the stored template onto the new user', async () => {
    selectQueue.push([STORED])
    await applyDefaultTemplateToUser('user-1')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].values).toMatchObject({ userId: 'user-1', preferences: STORED.preferences })
    expect(inserted[0].conflict).toBe('nothing')
  })

  it('falls back to BUSINESS_ADMIN_FALLBACK when no template row exists', async () => {
    selectQueue.push([])
    await applyDefaultTemplateToUser('user-2')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].values).toMatchObject({ userId: 'user-2', preferences: BUSINESS_ADMIN_FALLBACK })
  })
})

describe('BUSINESS_ADMIN_FALLBACK', () => {
  it('turns business mode on and keeps celebrations sober', () => {
    expect(BUSINESS_ADMIN_FALLBACK.businessMode).toBe(true)
    expect(BUSINESS_ADMIN_FALLBACK.celebrationStyle).toBe('checkmark-pulse')
  })

  it('only uses keys that exist in DEFAULT_PREFERENCES (businessMode aside)', () => {
    const known = new Set(Object.keys(DEFAULT_PREFERENCES))
    const unknown = Object.keys(BUSINESS_ADMIN_FALLBACK).filter((k) => k !== 'businessMode' && !known.has(k))
    expect(unknown).toEqual([])
  })

  it('matches the value types DEFAULT_PREFERENCES declares', () => {
    for (const [key, value] of Object.entries(BUSINESS_ADMIN_FALLBACK)) {
      if (key === 'businessMode') continue
      const expected = (DEFAULT_PREFERENCES as Record<string, unknown>)[key]
      expect(typeof value).toBe(typeof expected)
    }
  })
})
