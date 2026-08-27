import { describe, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  createDefaultFilters,
  hasActiveFilters,
  activeFilterCount,
  applyBoardFilters,
  type BoardFilters,
} from './boardFilters'

const taskArbitrary = fc.record({
  name: fc.string({ minLength: 1 }),
  description: fc.option(fc.string()).map((v) => v ?? undefined),
  priority: fc.constantFrom('low', 'medium', 'high', 'urgent'),
  labels: fc.array(fc.string()),
  startDate: fc.option(fc.date().map((d) => d.toISOString())).map((v) => v ?? undefined),
  endDate: fc.option(fc.date().map((d) => d.toISOString())).map((v) => v ?? undefined),
})

describe('boardFilters property-based invariants', () => {
  it('applyBoardFilters with default filters returns the full input (identity)', () => {
    fc.assert(
      fc.property(fc.array(taskArbitrary), (tasks) => {
        const result = applyBoardFilters(tasks, createDefaultFilters())
        return result.length === tasks.length
      })
    )
  })

  it('applyBoardFilters result length is always <= input length (non-expansion)', () => {
    const filtersArbitrary: fc.Arbitrary<BoardFilters> = fc.record({
      search: fc.string(),
      priorities: fc.array(fc.constantFrom('low', 'medium', 'high', 'urgent')).map((arr) => new Set(arr)),
      labels: fc.array(fc.string()).map((arr) => new Set(arr)),
      assignees: fc.array(fc.string()).map((arr) => new Set(arr)),
      dateFilter: fc.constantFrom<'all' | 'has-dates' | 'no-dates' | 'overdue'>('all', 'has-dates', 'no-dates', 'overdue'),
    })

    fc.assert(
      fc.property(fc.array(taskArbitrary), filtersArbitrary, (tasks, filters) => {
        const result = applyBoardFilters(tasks, filters)
        return result.length <= tasks.length
      })
    )
  })

  it('activeFilterCount is always between 0 and 5 inclusive', () => {
    const filtersArbitrary: fc.Arbitrary<BoardFilters> = fc.record({
      search: fc.string(),
      priorities: fc.array(fc.string()).map((arr) => new Set(arr)),
      labels: fc.array(fc.string()).map((arr) => new Set(arr)),
      assignees: fc.array(fc.string()).map((arr) => new Set(arr)),
      dateFilter: fc.constantFrom<'all' | 'has-dates' | 'no-dates' | 'overdue'>('all', 'has-dates', 'no-dates', 'overdue'),
    })

    fc.assert(
      fc.property(filtersArbitrary, (filters) => {
        const count = activeFilterCount(filters)
        return count >= 0 && count <= 5
      })
    )
  })

  it('hasActiveFilters returns false for createDefaultFilters (empty filter property)', () => {
    fc.assert(
      fc.property(fc.constant(createDefaultFilters()), (filters) => {
        return hasActiveFilters(filters) === false
      })
    )
  })

  it('filtering by a search term that matches no task names returns empty array', () => {
    const sentinelSearch = '\x00NOMATCH\x00'

    const nonMatchingTaskArbitrary = fc.record({
      name: fc.string({ minLength: 1 }).filter((s) => !s.includes(sentinelSearch.toLowerCase())),
      description: fc.constant(undefined),
      priority: fc.constantFrom('low', 'medium', 'high', 'urgent'),
      labels: fc.array(fc.string()),
      startDate: fc.constant(undefined),
      endDate: fc.constant(undefined),
    })

    fc.assert(
      fc.property(fc.array(nonMatchingTaskArbitrary, { minLength: 1 }), (tasks) => {
        const filters: BoardFilters = {
          ...createDefaultFilters(),
          search: sentinelSearch,
        }
        const result = applyBoardFilters(tasks, filters)
        return result.length === 0
      })
    )
  })
})
