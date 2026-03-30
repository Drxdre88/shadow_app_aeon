import { describe, it, expect, beforeEach } from 'vitest'
import { useGanttStore } from '../ganttStore'

const INITIAL_STATE = {
  tasks: [],
  rows: [],
  views: [],
  activeViewId: null,
  selectedTaskId: null,
  isDirty: false,
  timeScale: 'week' as const,
}

function makeTask(id: string, projectId = 'proj-1'): Parameters<typeof useGanttStore.getState>['0'] extends infer S ? S extends { tasks: (infer T)[] } ? T : never : never {
  return {
    id,
    projectId,
    rowId: null,
    name: `Task ${id}`,
    startDate: '2025-01-01',
    endDate: '2025-01-07',
    color: '#ffffff',
    progress: 0,
    dependencies: [],
  }
}

function makeRow(id: string, projectId = 'proj-1', orderIndex = 0) {
  return { id, projectId, name: `Row ${id}`, color: '#ffffff', orderIndex }
}

function makeView(id: string, projectId = 'proj-1') {
  return { id, projectId, name: `View ${id}`, groupBy: 'none', filters: {} }
}

beforeEach(() => {
  useGanttStore.setState(INITIAL_STATE)
})

describe('setTasks', () => {
  it('replaces all tasks and marks clean', () => {
    useGanttStore.getState().addTask(makeTask('t1'))
    useGanttStore.getState().setTasks([makeTask('t2'), makeTask('t3')])

    const { tasks, isDirty } = useGanttStore.getState()
    expect(tasks).toHaveLength(2)
    expect(tasks[0].id).toBe('t2')
    expect(isDirty).toBe(false)
  })

  it('replaces with empty array and marks clean', () => {
    useGanttStore.getState().addTask(makeTask('t1'))
    useGanttStore.getState().setTasks([])

    expect(useGanttStore.getState().tasks).toHaveLength(0)
    expect(useGanttStore.getState().isDirty).toBe(false)
  })
})

describe('addTask', () => {
  it('appends the task and marks dirty', () => {
    useGanttStore.getState().addTask(makeTask('t1'))

    const { tasks, isDirty } = useGanttStore.getState()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('t1')
    expect(isDirty).toBe(true)
  })

  it('appends multiple tasks in order', () => {
    useGanttStore.getState().addTask(makeTask('t1'))
    useGanttStore.getState().addTask(makeTask('t2'))

    const { tasks } = useGanttStore.getState()
    expect(tasks[0].id).toBe('t1')
    expect(tasks[1].id).toBe('t2')
  })
})

describe('updateTask', () => {
  it('applies partial updates and marks dirty', () => {
    useGanttStore.getState().setTasks([makeTask('t1')])
    useGanttStore.getState().updateTask('t1', { name: 'Updated', progress: 50 })

    const task = useGanttStore.getState().tasks.find((t) => t.id === 't1')
    expect(task?.name).toBe('Updated')
    expect(task?.progress).toBe(50)
    expect(useGanttStore.getState().isDirty).toBe(true)
  })

  it('does not touch other tasks', () => {
    useGanttStore.getState().setTasks([makeTask('t1'), makeTask('t2')])
    useGanttStore.getState().updateTask('t1', { name: 'Changed' })

    const t2 = useGanttStore.getState().tasks.find((t) => t.id === 't2')
    expect(t2?.name).toBe('Task t2')
  })

  it('is a no-op on unknown id', () => {
    useGanttStore.getState().setTasks([makeTask('t1')])
    useGanttStore.getState().updateTask('ghost', { name: 'Ghost' })

    expect(useGanttStore.getState().tasks[0].name).toBe('Task t1')
  })
})

describe('removeTask', () => {
  it('deletes the matching task and marks dirty', () => {
    useGanttStore.getState().setTasks([makeTask('t1'), makeTask('t2')])
    useGanttStore.getState().removeTask('t1')

    const { tasks, isDirty } = useGanttStore.getState()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('t2')
    expect(isDirty).toBe(true)
  })

  it('is a no-op on unknown id', () => {
    useGanttStore.getState().setTasks([makeTask('t1')])
    useGanttStore.getState().removeTask('ghost')

    expect(useGanttStore.getState().tasks).toHaveLength(1)
  })
})

describe('setRows', () => {
  it('replaces all rows without affecting dirty flag', () => {
    useGanttStore.getState().setRows([makeRow('r1'), makeRow('r2')])

    const { rows, isDirty } = useGanttStore.getState()
    expect(rows).toHaveLength(2)
    expect(isDirty).toBe(false)
  })
})

describe('addRow', () => {
  it('appends the row and marks dirty', () => {
    useGanttStore.getState().addRow(makeRow('r1'))

    const { rows, isDirty } = useGanttStore.getState()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('r1')
    expect(isDirty).toBe(true)
  })
})

describe('updateRow', () => {
  it('applies partial updates and marks dirty', () => {
    useGanttStore.getState().setRows([makeRow('r1')])
    useGanttStore.getState().updateRow('r1', { name: 'Renamed' })

    const row = useGanttStore.getState().rows.find((r) => r.id === 'r1')
    expect(row?.name).toBe('Renamed')
    expect(useGanttStore.getState().isDirty).toBe(true)
  })

  it('does not affect other rows', () => {
    useGanttStore.getState().setRows([makeRow('r1'), makeRow('r2')])
    useGanttStore.getState().updateRow('r1', { name: 'Changed' })

    const r2 = useGanttStore.getState().rows.find((r) => r.id === 'r2')
    expect(r2?.name).toBe('Row r2')
  })
})

describe('removeRow', () => {
  it('deletes the matching row and marks dirty', () => {
    useGanttStore.getState().setRows([makeRow('r1'), makeRow('r2')])
    useGanttStore.getState().removeRow('r1')

    const { rows, isDirty } = useGanttStore.getState()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('r2')
    expect(isDirty).toBe(true)
  })
})

describe('reorderRows', () => {
  it('swaps two rows within the same project', () => {
    useGanttStore.getState().setRows([
      makeRow('r1', 'proj-1', 0),
      makeRow('r2', 'proj-1', 1),
      makeRow('r3', 'proj-1', 2),
    ])

    useGanttStore.getState().reorderRows('proj-1', 0, 2)

    const rows = useGanttStore.getState().rows
      .filter((r) => r.projectId === 'proj-1')
      .sort((a, b) => a.orderIndex - b.orderIndex)

    expect(rows[0].id).toBe('r2')
    expect(rows[1].id).toBe('r3')
    expect(rows[2].id).toBe('r1')
  })

  it('reassigns orderIndex sequentially after reorder', () => {
    useGanttStore.getState().setRows([
      makeRow('r1', 'proj-1', 0),
      makeRow('r2', 'proj-1', 1),
      makeRow('r3', 'proj-1', 2),
    ])

    useGanttStore.getState().reorderRows('proj-1', 0, 1)

    const rows = useGanttStore.getState().rows
      .filter((r) => r.projectId === 'proj-1')
      .sort((a, b) => a.orderIndex - b.orderIndex)

    rows.forEach((r, i) => expect(r.orderIndex).toBe(i))
  })

  it('does not affect rows from a different project', () => {
    useGanttStore.getState().setRows([
      makeRow('r1', 'proj-1', 0),
      makeRow('r2', 'proj-1', 1),
      makeRow('other', 'proj-2', 0),
    ])

    useGanttStore.getState().reorderRows('proj-1', 0, 1)

    const otherRow = useGanttStore.getState().rows.find((r) => r.id === 'other')
    expect(otherRow?.orderIndex).toBe(0)
  })

  it('marks dirty after reorder', () => {
    useGanttStore.getState().setRows([makeRow('r1', 'proj-1', 0), makeRow('r2', 'proj-1', 1)])
    useGanttStore.getState().reorderRows('proj-1', 0, 1)

    expect(useGanttStore.getState().isDirty).toBe(true)
  })

  it('is stable when fromIndex equals toIndex', () => {
    useGanttStore.getState().setRows([
      makeRow('r1', 'proj-1', 0),
      makeRow('r2', 'proj-1', 1),
    ])

    useGanttStore.getState().reorderRows('proj-1', 0, 0)

    const rows = useGanttStore.getState().rows
      .filter((r) => r.projectId === 'proj-1')
      .sort((a, b) => a.orderIndex - b.orderIndex)

    expect(rows[0].id).toBe('r1')
    expect(rows[1].id).toBe('r2')
  })
})

describe('setViews', () => {
  it('replaces all views', () => {
    useGanttStore.getState().addView(makeView('v1'))
    useGanttStore.getState().setViews([makeView('v2')])

    expect(useGanttStore.getState().views).toHaveLength(1)
    expect(useGanttStore.getState().views[0].id).toBe('v2')
  })
})

describe('addView', () => {
  it('appends the view without affecting dirty flag', () => {
    useGanttStore.getState().addView(makeView('v1'))

    expect(useGanttStore.getState().views).toHaveLength(1)
    expect(useGanttStore.getState().isDirty).toBe(false)
  })
})

describe('removeView', () => {
  it('deletes the matching view', () => {
    useGanttStore.getState().setViews([makeView('v1'), makeView('v2')])
    useGanttStore.getState().removeView('v1')

    expect(useGanttStore.getState().views).toHaveLength(1)
    expect(useGanttStore.getState().views[0].id).toBe('v2')
  })

  it('clears rows belonging to the removed view', () => {
    useGanttStore.getState().setViews([makeView('v1')])
    useGanttStore.getState().setRows([
      { ...makeRow('r1'), ganttViewId: 'v1' },
      { ...makeRow('r2'), ganttViewId: 'v2' },
    ])

    useGanttStore.getState().removeView('v1')

    const rows = useGanttStore.getState().rows
    expect(rows.find((r) => r.id === 'r1')).toBeUndefined()
    expect(rows.find((r) => r.id === 'r2')).toBeDefined()
  })

  it('falls back activeViewId to first remaining view when active view is removed', () => {
    useGanttStore.getState().setViews([makeView('v1'), makeView('v2'), makeView('v3')])
    useGanttStore.getState().setActiveViewId('v1')

    useGanttStore.getState().removeView('v1')

    expect(useGanttStore.getState().activeViewId).not.toBe('v1')
    expect(['v2', 'v3']).toContain(useGanttStore.getState().activeViewId)
  })

  it('sets activeViewId to null when the last view is removed', () => {
    useGanttStore.getState().setViews([makeView('v1')])
    useGanttStore.getState().setActiveViewId('v1')

    useGanttStore.getState().removeView('v1')

    expect(useGanttStore.getState().activeViewId).toBeNull()
  })

  it('preserves activeViewId when a non-active view is removed', () => {
    useGanttStore.getState().setViews([makeView('v1'), makeView('v2')])
    useGanttStore.getState().setActiveViewId('v1')

    useGanttStore.getState().removeView('v2')

    expect(useGanttStore.getState().activeViewId).toBe('v1')
  })
})

describe('setActiveViewId', () => {
  it('updates activeViewId', () => {
    useGanttStore.getState().setActiveViewId('v42')
    expect(useGanttStore.getState().activeViewId).toBe('v42')
  })

  it('accepts null', () => {
    useGanttStore.getState().setActiveViewId('v1')
    useGanttStore.getState().setActiveViewId(null)
    expect(useGanttStore.getState().activeViewId).toBeNull()
  })
})

describe('setTimeScale', () => {
  it('changes scale to day', () => {
    useGanttStore.getState().setTimeScale('day')
    expect(useGanttStore.getState().timeScale).toBe('day')
  })

  it('changes scale to month', () => {
    useGanttStore.getState().setTimeScale('month')
    expect(useGanttStore.getState().timeScale).toBe('month')
  })

  it('defaults to week on store init', () => {
    expect(useGanttStore.getState().timeScale).toBe('week')
  })
})

describe('selectTask', () => {
  it('sets selectedTaskId', () => {
    useGanttStore.getState().selectTask('t1')
    expect(useGanttStore.getState().selectedTaskId).toBe('t1')
  })

  it('accepts null to deselect', () => {
    useGanttStore.getState().selectTask('t1')
    useGanttStore.getState().selectTask(null)
    expect(useGanttStore.getState().selectedTaskId).toBeNull()
  })

  it('does not affect isDirty', () => {
    useGanttStore.getState().selectTask('t1')
    expect(useGanttStore.getState().isDirty).toBe(false)
  })
})

describe('markClean', () => {
  it('clears the dirty flag', () => {
    useGanttStore.getState().addTask(makeTask('t1'))
    expect(useGanttStore.getState().isDirty).toBe(true)

    useGanttStore.getState().markClean()
    expect(useGanttStore.getState().isDirty).toBe(false)
  })

  it('is safe to call when already clean', () => {
    useGanttStore.getState().markClean()
    expect(useGanttStore.getState().isDirty).toBe(false)
  })
})
