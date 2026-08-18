import { describe, it, expect } from 'vitest'
import { updateTaskSchema } from '../validators'

describe('updateTaskSchema progress', () => {
  it('accepts the 0-100 range', () => {
    expect(updateTaskSchema.parse({ progress: 0 }).progress).toBe(0)
    expect(updateTaskSchema.parse({ progress: 55 }).progress).toBe(55)
    expect(updateTaskSchema.parse({ progress: 100 }).progress).toBe(100)
  })

  it('accepts null to clear tracking and omission to leave it alone', () => {
    expect(updateTaskSchema.parse({ progress: null }).progress).toBeNull()
    expect(updateTaskSchema.parse({ name: 'x' }).progress).toBeUndefined()
  })

  it('rejects out-of-range and fractional values', () => {
    expect(updateTaskSchema.safeParse({ progress: -1 }).success).toBe(false)
    expect(updateTaskSchema.safeParse({ progress: 101 }).success).toBe(false)
    expect(updateTaskSchema.safeParse({ progress: 12.5 }).success).toBe(false)
    expect(updateTaskSchema.safeParse({ progress: '50' }).success).toBe(false)
  })
})
