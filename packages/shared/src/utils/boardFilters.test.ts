import { describe, it, expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  createDefaultFilters,
  hasActiveFilters,
  activeFilterCount,
  applyBoardFilters,
  DEFAULT_FILTERS,
  type BoardFilters,
} from './boardFilters'

const makeTask = (overrides: Partial<{
  name: string
  description: string
  priority: string
  labels: string[]
  assigneeIds: string[]
  startDate: string
  endDate: string
}> = {}) => ({
  name: 'Task Alpha',
  description: 'Some description',
  priority: 'medium',
  labels: [],
  ...overrides,
})

describe('createDefaultFilters', () => {
  it('returns empty search string', () => {
    expect(createDefaultFilters().search).toBe('')
  })

  it('returns empty priorities set', () => {
    expect(createDefaultFilters().priorities.size).toBe(0)
  })

  it('returns empty labels set', () => {
    expect(createDefaultFilters().labels.size).toBe(0)
  })

  it('returns dateFilter as all', () => {
    expect(createDefaultFilters().dateFilter).toBe('all')
  })

  it('returns independent instances on each call', () => {
    const a = createDefaultFilters()
    const b = createDefaultFilters()
    a.priorities.add('high')
    expect(b.priorities.size).toBe(0)
  })

  it('returns instance independent from DEFAULT_FILTERS', () => {
    const fresh = createDefaultFilters()
    fresh.priorities.add('urgent')
    expect(DEFAULT_FILTERS.priorities.size).toBe(0)
  })
})

describe('hasActiveFilters', () => {
  it('returns false for default filters', () => {
    expect(hasActiveFilters(createDefaultFilters())).toBe(false)
  })

  it('returns true when search is set', () => {
    expect(hasActiveFilters({ ...createDefaultFilters(), search: 'x' })).toBe(true)
  })

  it('returns true when priorities has entries', () => {
    const f = createDefaultFilters()
    f.priorities.add('high')
    expect(hasActiveFilters(f)).toBe(true)
  })

  it('returns true when labels has entries', () => {
    const f = createDefaultFilters()
    f.labels.add('bug')
    expect(hasActiveFilters(f)).toBe(true)
  })

  it('returns true when dateFilter is has-dates', () => {
    expect(hasActiveFilters({ ...createDefaultFilters(), dateFilter: 'has-dates' })).toBe(true)
  })

  it('returns true when dateFilter is no-dates', () => {
    expect(hasActiveFilters({ ...createDefaultFilters(), dateFilter: 'no-dates' })).toBe(true)
  })

  it('returns true when dateFilter is overdue', () => {
    expect(hasActiveFilters({ ...createDefaultFilters(), dateFilter: 'overdue' })).toBe(true)
  })
})

describe('activeFilterCount', () => {
  it('returns 0 for default filters', () => {
    expect(activeFilterCount(createDefaultFilters())).toBe(0)
  })

  it('counts search as 1', () => {
    expect(activeFilterCount({ ...createDefaultFilters(), search: 'foo' })).toBe(1)
  })

  it('counts priorities as 1 regardless of how many are selected', () => {
    const f = createDefaultFilters()
    f.priorities.add('low')
    f.priorities.add('high')
    expect(activeFilterCount(f)).toBe(1)
  })

  it('counts labels as 1 regardless of how many are selected', () => {
    const f = createDefaultFilters()
    f.labels.add('bug')
    f.labels.add('feat')
    expect(activeFilterCount(f)).toBe(1)
  })

  it('counts dateFilter as 1 when not all', () => {
    expect(activeFilterCount({ ...createDefaultFilters(), dateFilter: 'overdue' })).toBe(1)
  })

  it('counts all five active filters as 5', () => {
    const f: BoardFilters = {
      search: 'hello',
      priorities: new Set(['high']),
      labels: new Set(['bug']),
      assignees: new Set(['user-1']),
      dateFilter: 'overdue',
    }
    expect(activeFilterCount(f)).toBe(5)
  })

  it('counts assignees as 1 regardless of set size', () => {
    const f = createDefaultFilters()
    f.assignees.add('user-1')
    f.assignees.add('vm-1')
    expect(activeFilterCount(f)).toBe(1)
  })
})

describe('applyBoardFilters', () => {
  describe('search filter', () => {
    it('matches task name case-insensitively', () => {
      const tasks = [makeTask({ name: 'Deploy Pipeline' })]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), search: 'deploy' })
      expect(result).toHaveLength(1)
    })

    it('matches task description case-insensitively', () => {
      const tasks = [makeTask({ description: 'Fix the AUTH flow' })]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), search: 'auth' })
      expect(result).toHaveLength(1)
    })

    it('excludes tasks that do not match search', () => {
      const tasks = [makeTask({ name: 'Refactor DB', description: 'Database cleanup' })]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), search: 'payment' })
      expect(result).toHaveLength(0)
    })

    it('matches on description when name does not match', () => {
      const tasks = [makeTask({ name: 'Task A', description: 'Contains keyword alpha' })]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), search: 'alpha' })
      expect(result).toHaveLength(1)
    })
  })

  describe('priority filter', () => {
    it('returns only tasks matching selected priority', () => {
      const tasks = [
        makeTask({ name: 'Low task', priority: 'low' }),
        makeTask({ name: 'High task', priority: 'high' }),
      ]
      const f = createDefaultFilters()
      f.priorities.add('high')
      expect(applyBoardFilters(tasks, f)).toHaveLength(1)
      expect(applyBoardFilters(tasks, f)[0].name).toBe('High task')
    })

    it('returns tasks matching any of multiple priorities', () => {
      const tasks = [
        makeTask({ priority: 'low' }),
        makeTask({ priority: 'medium' }),
        makeTask({ priority: 'high' }),
      ]
      const f = createDefaultFilters()
      f.priorities.add('low')
      f.priorities.add('high')
      expect(applyBoardFilters(tasks, f)).toHaveLength(2)
    })
  })

  describe('assignee filter', () => {
    it('defaults to an empty set', () => {
      expect(createDefaultFilters().assignees.size).toBe(0)
    })

    it('activates hasActiveFilters when an assignee is selected', () => {
      const f = createDefaultFilters()
      f.assignees.add('user-1')
      expect(hasActiveFilters(f)).toBe(true)
    })

    it('returns only tasks assigned to the selected person', () => {
      const tasks = [
        makeTask({ name: 'Mine', assigneeIds: ['user-1'] }),
        makeTask({ name: 'Theirs', assigneeIds: ['user-2'] }),
      ]
      const f = createDefaultFilters()
      f.assignees.add('user-1')
      const result = applyBoardFilters(tasks, f)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Mine')
    })

    it('matches virtual member ids the same as real user ids', () => {
      const tasks = [
        makeTask({ name: 'Virtual work', assigneeIds: ['vm-1', 'user-1'] }),
        makeTask({ name: 'Unassigned' }),
      ]
      const f = createDefaultFilters()
      f.assignees.add('vm-1')
      const result = applyBoardFilters(tasks, f)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Virtual work')
    })

    it('excludes tasks without assignee data when the filter is active', () => {
      const tasks = [makeTask({ name: 'No data' })]
      const f = createDefaultFilters()
      f.assignees.add('user-1')
      expect(applyBoardFilters(tasks, f)).toHaveLength(0)
    })

    // Filter objects persisted before `assignees` existed come back without
    // the field at all. Every entry point must treat that as "no assignee
    // filter" rather than throwing on `.size` / `.has`.
    it('survives a persisted filter object that predates the field', () => {
      const legacy = { ...createDefaultFilters(), assignees: undefined }
      expect(hasActiveFilters(legacy)).toBe(false)
      expect(activeFilterCount(legacy)).toBe(0)

      const tasks = [
        makeTask({ name: 'Mine', assigneeIds: ['user-1'] }),
        makeTask({ name: 'Nobody' }),
      ]
      expect(applyBoardFilters(tasks, legacy)).toHaveLength(2)

      // …and still filters on its other fields.
      const searching = { ...legacy, search: 'Mine' }
      expect(hasActiveFilters(searching)).toBe(true)
      expect(activeFilterCount(searching)).toBe(1)
      expect(applyBoardFilters(tasks, searching).map((t) => t.name)).toEqual(['Mine'])
    })

    it('matches any of multiple selected assignees (OR semantics)', () => {
      const tasks = [
        makeTask({ name: 'A', assigneeIds: ['user-1'] }),
        makeTask({ name: 'B', assigneeIds: ['vm-1'] }),
        makeTask({ name: 'C', assigneeIds: ['user-3'] }),
      ]
      const f = createDefaultFilters()
      f.assignees.add('user-1')
      f.assignees.add('vm-1')
      expect(applyBoardFilters(tasks, f)).toHaveLength(2)
    })
  })

  describe('labels filter', () => {
    it('returns tasks that have at least one matching label', () => {
      const tasks = [
        makeTask({ labels: ['bug', 'backend'] }),
        makeTask({ labels: ['feat'] }),
      ]
      const f = createDefaultFilters()
      f.labels.add('bug')
      expect(applyBoardFilters(tasks, f)).toHaveLength(1)
    })

    it('excludes tasks with no matching labels', () => {
      const tasks = [makeTask({ labels: ['design'] })]
      const f = createDefaultFilters()
      f.labels.add('backend')
      expect(applyBoardFilters(tasks, f)).toHaveLength(0)
    })
  })

  describe('dateFilter', () => {
    it('has-dates returns only tasks with at least one date', () => {
      const tasks = [
        makeTask({ startDate: '2026-01-01' }),
        makeTask({}),
      ]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), dateFilter: 'has-dates' })
      expect(result).toHaveLength(1)
    })

    it('no-dates returns only tasks with no dates', () => {
      const tasks = [
        makeTask({ endDate: '2026-06-01' }),
        makeTask({}),
      ]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), dateFilter: 'no-dates' })
      expect(result).toHaveLength(1)
    })

    it('overdue excludes tasks with no endDate', () => {
      const tasks = [makeTask({})]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), dateFilter: 'overdue' })
      expect(result).toHaveLength(0)
    })

    it('overdue excludes tasks whose endDate is in the future', () => {
      const future = new Date(Date.now() + 86400000 * 30).toISOString()
      const tasks = [makeTask({ endDate: future })]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), dateFilter: 'overdue' })
      expect(result).toHaveLength(0)
    })

    it('overdue includes tasks whose endDate is in the past', () => {
      const past = new Date(Date.now() - 86400000 * 30).toISOString()
      const tasks = [makeTask({ endDate: past })]
      const result = applyBoardFilters(tasks, { ...createDefaultFilters(), dateFilter: 'overdue' })
      expect(result).toHaveLength(1)
    })
  })

  describe('edge cases', () => {
    it('returns empty array when input is empty', () => {
      const f = createDefaultFilters()
      f.priorities.add('high')
      expect(applyBoardFilters([], f)).toEqual([])
    })

    it('returns all tasks when no filters are active', () => {
      const tasks = [makeTask(), makeTask({ name: 'Other' })]
      expect(applyBoardFilters(tasks, createDefaultFilters())).toHaveLength(2)
    })

    it('returns same array reference when no filters are active', () => {
      const tasks = [makeTask()]
      const result = applyBoardFilters(tasks, createDefaultFilters())
      expect(result).toBe(tasks)
    })
  })
})

describe('applyBoardFilters property tests', () => {
  it('createDefaultFilters always produces empty/inactive filters', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const f = createDefaultFilters()
        expect(hasActiveFilters(f)).toBe(false)
        expect(activeFilterCount(f)).toBe(0)
      })
    )
  })

  it('filtering empty array always returns empty array', () => {
    fc.assert(
      fc.property(
        fc.record({
          search: fc.string(),
          priorities: fc.array(fc.constantFrom('low', 'medium', 'high', 'urgent')),
          labels: fc.array(fc.string()),
          dateFilter: fc.constantFrom<'all' | 'has-dates' | 'no-dates' | 'overdue'>('all', 'has-dates', 'no-dates', 'overdue'),
        }),
        ({ search, priorities, labels, dateFilter }) => {
          const f: BoardFilters = {
            search,
            priorities: new Set(priorities),
            labels: new Set(labels),
            assignees: new Set<string>(),
            dateFilter,
          }
          expect(applyBoardFilters([], f)).toEqual([])
        }
      )
    )
  })

  it('filtering with DEFAULT_FILTERS returns all tasks unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1 }),
            description: fc.option(fc.string(), { nil: undefined }),
            priority: fc.constantFrom('low', 'medium', 'high', 'urgent'),
            labels: fc.array(fc.string()),
            startDate: fc.option(fc.string(), { nil: undefined }),
            endDate: fc.option(fc.string(), { nil: undefined }),
          })
        ),
        (tasks) => {
          const result = applyBoardFilters(tasks, createDefaultFilters())
          expect(result).toHaveLength(tasks.length)
        }
      )
    )
  })
})
