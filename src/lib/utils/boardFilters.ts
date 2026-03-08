export interface BoardFilters {
  search: string
  priorities: Set<string>
  labels: Set<string>
  dateFilter: 'all' | 'has-dates' | 'no-dates' | 'overdue'
}

export const DEFAULT_FILTERS: BoardFilters = {
  search: '',
  priorities: new Set(),
  labels: new Set(),
  dateFilter: 'all',
}

export function hasActiveFilters(filters: BoardFilters): boolean {
  return (
    filters.search.length > 0 ||
    filters.priorities.size > 0 ||
    filters.labels.size > 0 ||
    filters.dateFilter !== 'all'
  )
}

export function activeFilterCount(filters: BoardFilters): number {
  let count = 0
  if (filters.search.length > 0) count++
  if (filters.priorities.size > 0) count++
  if (filters.labels.size > 0) count++
  if (filters.dateFilter !== 'all') count++
  return count
}

interface FilterableTask {
  name: string
  description?: string
  priority: string
  labels: string[]
  startDate?: string
  endDate?: string
}

export function applyBoardFilters<T extends FilterableTask>(
  tasks: T[],
  filters: BoardFilters
): T[] {
  if (!hasActiveFilters(filters)) return tasks

  const searchLower = filters.search.toLowerCase()

  return tasks.filter((task) => {
    if (searchLower) {
      const nameMatch = task.name.toLowerCase().includes(searchLower)
      const descMatch = task.description?.toLowerCase().includes(searchLower)
      if (!nameMatch && !descMatch) return false
    }

    if (filters.priorities.size > 0 && !filters.priorities.has(task.priority)) {
      return false
    }

    if (filters.labels.size > 0) {
      const hasMatchingLabel = task.labels.some((l) => filters.labels.has(l))
      if (!hasMatchingLabel) return false
    }

    if (filters.dateFilter !== 'all') {
      const hasDates = !!task.startDate || !!task.endDate
      if (filters.dateFilter === 'has-dates' && !hasDates) return false
      if (filters.dateFilter === 'no-dates' && hasDates) return false
      if (filters.dateFilter === 'overdue') {
        if (!task.endDate) return false
        if (new Date(task.endDate) >= new Date()) return false
      }
    }

    return true
  })
}
