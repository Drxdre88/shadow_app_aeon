import { beforeEach, describe, expect, it, vi } from 'vitest'

const drizzleMocks = vi.hoisted(() => ({
  and: vi.fn(),
  eq: vi.fn(),
  sql: vi.fn(),
}))
const selectQueue: unknown[][] = []
const whereCalls: unknown[] = []

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  drizzleMocks.eq.mockImplementation((column, value) => ({ kind: 'eq', column, value }))
  drizzleMocks.and.mockImplementation((...conditions) => ({ kind: 'and', conditions }))
  drizzleMocks.sql.mockImplementation((strings, ...values) => ({
    kind: 'sql',
    strings: Array.from(strings as TemplateStringsArray),
    values,
  }))
  Object.assign(drizzleMocks.sql, actual.sql)
  return {
    ...actual,
    and: drizzleMocks.and,
    eq: drizzleMocks.eq,
    sql: drizzleMocks.sql,
  }
})

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.where = (condition: unknown) => { whereCalls.push(condition); return chain }
      chain.orderBy = () => chain
      chain.limit = () => chain
      chain.then = (resolve: (v: unknown[]) => unknown) => resolve(selectQueue.shift() ?? [])
      return chain
    }),
  },
}))

import { memories } from '@/lib/db/schema'
import { listRecentKairosSpeaks } from '../memories'

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  whereCalls.length = 0
})

describe('listRecentKairosSpeaks (docs/kairos/31 B5 — opsAlert exclusion)', () => {
  it('filters on the standard kairosSpeak/user/type/source predicates', async () => {
    selectQueue.push([])
    await listRecentKairosSpeaks(USER)

    expect(drizzleMocks.eq).toHaveBeenCalledWith(memories.userId, USER)
    expect(drizzleMocks.eq).toHaveBeenCalledWith(memories.type, 'inbound')
    expect(drizzleMocks.eq).toHaveBeenCalledWith(memories.source, 'system')
  })

  it('excludes rows where sourceMetadata.opsAlert is true', async () => {
    selectQueue.push([])
    await listRecentKairosSpeaks(USER)

    const predicates = drizzleMocks.sql.mock.calls.map(([strings]) => (
      Array.from(strings as TemplateStringsArray).join(' ')
    ))
    expect(predicates.some((text) => text.includes("->>'kairosSpeak' = 'true'"))).toBe(true)
    expect(predicates.some((text) => (
      text.includes("->>'opsAlert'") && text.includes('IS DISTINCT FROM')
    ))).toBe(true)
  })

  it('excludes rows where sourceMetadata.digest is true (Evening Digest register)', async () => {
    selectQueue.push([])
    await listRecentKairosSpeaks(USER)

    const predicates = drizzleMocks.sql.mock.calls.map(([strings]) => (
      Array.from(strings as TemplateStringsArray).join(' ')
    ))
    expect(predicates.some((text) => (
      text.includes("->>'digest'") && text.includes('IS DISTINCT FROM')
    ))).toBe(true)
  })

  it('builds exactly one where clause combining every predicate', async () => {
    selectQueue.push([])
    await listRecentKairosSpeaks(USER, { hours: 48, limit: 5 })

    expect(whereCalls).toHaveLength(1)
    expect(drizzleMocks.and).toHaveBeenCalledTimes(1)
  })
})
