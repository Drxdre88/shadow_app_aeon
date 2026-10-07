import { describe, expect, it, vi } from 'vitest'

// Lifecycle column matching: the exact name wins, else the first column by
// order whose name is "<target> …" — "Landing Zone" counts, "Landingpad" does not.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('../columns', () => ({ findColumns: vi.fn() }))
vi.mock('../projects', () => ({ findProjectSettings: vi.fn() }))
vi.mock('../bridge', () => ({ syncChecklistToGanttProgress: vi.fn() }))

import { matchLifecycleColumn } from '../hangar-plan'

const col = (id: string, name: string, orderIndex: number) => ({ id, name, orderIndex })

describe('matchLifecycleColumn', () => {
  it('prefers an exact case-insensitive name over an earlier prefixed column', () => {
    const columns = [col('zone', 'Landing Zone', 0), col('exact', ' landing ', 3)]
    expect(matchLifecycleColumn(columns, 'Landing')?.id).toBe('exact')
  })

  it('falls back to the first prefixed column by order', () => {
    const columns = [col('pad', 'Landing Pad', 5), col('zone', 'LANDING ZONE', 2), col('other', 'Done', 0)]
    expect(matchLifecycleColumn(columns, 'Landing')?.id).toBe('zone')
  })

  it('applies the same rule to Tower', () => {
    expect(matchLifecycleColumn([col('t', 'Tower Control', 1)], 'Tower')?.id).toBe('t')
  })

  it('needs a word break after the name', () => {
    expect(matchLifecycleColumn([col('a', 'Landingpad', 0), col('b', 'Pre-Landing', 1)], 'Landing')).toBeNull()
  })

  it('returns null with no columns', () => {
    expect(matchLifecycleColumn([], 'Tower')).toBeNull()
  })
})
