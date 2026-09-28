import { describe, it, expect, vi, beforeEach } from 'vitest'

const results: unknown[][] = []

vi.mock('@/lib/db', () => {
  const chain = () => {
    const q = {
      from: () => q,
      where: () => Promise.resolve(results.shift() ?? []),
    }
    return q
  }
  return { db: { select: vi.fn(chain) } }
})

import { checkStorageLimit } from '../storage'
import { STORAGE_LIMITS } from '../storage-limits'

beforeEach(() => {
  results.length = 0
})

describe('checkStorageLimit', () => {
  it('never blocks admins', async () => {
    results.push([{ id: 'p1' }], [{ role: 'admin' }])
    const r = await checkStorageLimit('u1', 'tasks')
    expect(r.allowed).toBe(true)
  })

  it('blocks regular users at the task cap', async () => {
    results.push([{ id: 'p1' }], [{ role: 'user' }], [{ value: STORAGE_LIMITS.tasks }])
    const r = await checkStorageLimit('u1', 'tasks')
    expect(r).toMatchObject({ allowed: false, current: STORAGE_LIMITS.tasks, limit: 2000, remaining: 0 })
  })

  it('allows regular users under the cap', async () => {
    results.push([{ id: 'p1' }], [{ role: 'user' }], [{ value: 635 }])
    const r = await checkStorageLimit('u1', 'tasks')
    expect(r).toMatchObject({ allowed: true, current: 635, remaining: 1365 })
  })
})
