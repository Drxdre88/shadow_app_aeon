import { describe, it, expect, beforeEach } from 'vitest'
import { useBoardStore } from '../boardStore'
import type { BoardColumn, BoardTask } from '../boardStore'

const makeColumn = (overrides: Partial<BoardColumn> = {}): BoardColumn => ({
  id: 'col-1',
  projectId: 'proj-1',
  name: 'Backlog',
  color: '#aabbcc',
  orderIndex: 0,
  ...overrides,
})

const makeTask = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  id: 'task-1',
  projectId: 'proj-1',
  name: 'Do something',
  columnId: 'col-1',
  status: 'open',
  priority: 'medium',
  color: '#ffffff',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
  ...overrides,
})

const store = () => useBoardStore.getState()
const reset = () =>
  useBoardStore.setState({
    columns: [],
    tasks: [],
    labels: [],
    dependencies: [],
    checklistSummaries: {},
    checklistPreviews: {},
    checklistViewMode: 'off',
    selectedTaskId: null,
    isDirty: false,
    showDates: false,
  })

beforeEach(reset)

describe('column operations', () => {
  it('setColumns replaces all existing columns', () => {
    store().addColumn(makeColumn({ id: 'old-col' }))
    const replacement = [makeColumn({ id: 'new-col', name: 'Queue' })]
    store().setColumns(replacement)
    expect(store().columns).toEqual(replacement)
  })

  it('addColumn appends to existing columns', () => {
    const first = makeColumn({ id: 'col-a', orderIndex: 0 })
    const second = makeColumn({ id: 'col-b', orderIndex: 1 })
    store().addColumn(first)
    store().addColumn(second)
    expect(store().columns).toHaveLength(2)
    expect(store().columns[1].id).toBe('col-b')
  })

  it('updateColumn modifies only the targeted column', () => {
    store().setColumns([
      makeColumn({ id: 'col-1', name: 'Old Name' }),
      makeColumn({ id: 'col-2', name: 'Untouched' }),
    ])
    store().updateColumn('col-1', { name: 'New Name' })
    const updated = store().columns.find((c) => c.id === 'col-1')
    const untouched = store().columns.find((c) => c.id === 'col-2')
    expect(updated?.name).toBe('New Name')
    expect(untouched?.name).toBe('Untouched')
  })

  it('removeColumn deletes the matching column and leaves others', () => {
    store().setColumns([
      makeColumn({ id: 'col-1' }),
      makeColumn({ id: 'col-2' }),
    ])
    store().removeColumn('col-1')
    expect(store().columns).toHaveLength(1)
    expect(store().columns[0].id).toBe('col-2')
  })

  it('removeColumn on non-existent id leaves columns unchanged', () => {
    store().setColumns([makeColumn({ id: 'col-1' })])
    store().removeColumn('ghost-id')
    expect(store().columns).toHaveLength(1)
  })

  it('reorderColumns updates orderIndex and sorts ascending', () => {
    store().setColumns([
      makeColumn({ id: 'col-a', orderIndex: 2 }),
      makeColumn({ id: 'col-b', orderIndex: 0 }),
    ])
    store().reorderColumns([
      { id: 'col-a', orderIndex: 0 },
      { id: 'col-b', orderIndex: 1 },
    ])
    const cols = store().columns
    expect(cols[0].id).toBe('col-a')
    expect(cols[0].orderIndex).toBe(0)
    expect(cols[1].id).toBe('col-b')
    expect(cols[1].orderIndex).toBe(1)
  })

  it('reorderColumns ignores ids not present in the updates list', () => {
    store().setColumns([
      makeColumn({ id: 'col-a', orderIndex: 5 }),
      makeColumn({ id: 'col-b', orderIndex: 10 }),
    ])
    store().reorderColumns([{ id: 'col-a', orderIndex: 0 }])
    const colB = store().columns.find((c) => c.id === 'col-b')
    expect(colB?.orderIndex).toBe(10)
  })
})

describe('task operations', () => {
  it('setTasks replaces all tasks and marks isDirty false', () => {
    store().addTask(makeTask({ id: 'old-task' }))
    expect(store().isDirty).toBe(true)
    const replacement = [makeTask({ id: 'new-task' })]
    store().setTasks(replacement)
    expect(store().tasks).toEqual(replacement)
    expect(store().isDirty).toBe(false)
  })

  it('addTask appends the task and marks dirty', () => {
    store().addTask(makeTask({ id: 'task-a' }))
    store().addTask(makeTask({ id: 'task-b' }))
    expect(store().tasks).toHaveLength(2)
    expect(store().tasks[1].id).toBe('task-b')
    expect(store().isDirty).toBe(true)
  })

  it('updateTask modifies the targeted task and marks dirty', () => {
    store().setTasks([
      makeTask({ id: 'task-1', name: 'Original' }),
      makeTask({ id: 'task-2', name: 'Sibling' }),
    ])
    store().updateTask('task-1', { name: 'Updated', priority: 'high' })
    const updated = store().tasks.find((t) => t.id === 'task-1')
    const sibling = store().tasks.find((t) => t.id === 'task-2')
    expect(updated?.name).toBe('Updated')
    expect(updated?.priority).toBe('high')
    expect(sibling?.name).toBe('Sibling')
    expect(store().isDirty).toBe(true)
  })

  it('removeTask deletes the matching task and marks dirty', () => {
    store().setTasks([makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })])
    store().removeTask('task-1')
    expect(store().tasks).toHaveLength(1)
    expect(store().tasks[0].id).toBe('task-2')
    expect(store().isDirty).toBe(true)
  })

  it('moveTask updates columnId and orderIndex and marks dirty', () => {
    store().setTasks([makeTask({ id: 'task-1', columnId: 'col-a', orderIndex: 0 })])
    store().moveTask('task-1', 'col-b', 3)
    const moved = store().tasks.find((t) => t.id === 'task-1')
    expect(moved?.columnId).toBe('col-b')
    expect(moved?.orderIndex).toBe(3)
    expect(store().isDirty).toBe(true)
  })

  it('moveTask does not affect other tasks', () => {
    store().setTasks([
      makeTask({ id: 'task-1', columnId: 'col-a', orderIndex: 0 }),
      makeTask({ id: 'task-2', columnId: 'col-a', orderIndex: 1 }),
    ])
    store().moveTask('task-1', 'col-b', 5)
    const untouched = store().tasks.find((t) => t.id === 'task-2')
    expect(untouched?.columnId).toBe('col-a')
    expect(untouched?.orderIndex).toBe(1)
  })
})

describe('label operations', () => {
  const makeLabel = (id: string, name: string) => ({
    id,
    projectId: 'proj-1',
    name,
    color: '#ff0000',
  })

  it('setLabels replaces all labels', () => {
    store().addLabel(makeLabel('old-lbl', 'Old'))
    store().setLabels([makeLabel('new-lbl', 'New')])
    expect(store().labels).toHaveLength(1)
    expect(store().labels[0].id).toBe('new-lbl')
  })

  it('addLabel appends and marks dirty', () => {
    store().addLabel(makeLabel('lbl-1', 'Alpha'))
    expect(store().labels).toHaveLength(1)
    expect(store().isDirty).toBe(true)
  })

  it('updateLabel modifies the targeted label and marks dirty', () => {
    store().setLabels([makeLabel('lbl-1', 'Before'), makeLabel('lbl-2', 'Other')])
    store().updateLabel('lbl-1', { name: 'After' })
    expect(store().labels.find((l) => l.id === 'lbl-1')?.name).toBe('After')
    expect(store().labels.find((l) => l.id === 'lbl-2')?.name).toBe('Other')
    expect(store().isDirty).toBe(true)
  })

  it('removeLabel deletes the matching label and marks dirty', () => {
    store().setLabels([makeLabel('lbl-1', 'Keep'), makeLabel('lbl-2', 'Remove')])
    store().removeLabel('lbl-2')
    expect(store().labels).toHaveLength(1)
    expect(store().labels[0].id).toBe('lbl-1')
    expect(store().isDirty).toBe(true)
  })
})

describe('dependency operations', () => {
  const depA = { blockerTaskId: 'task-a', blockedTaskId: 'task-b' }
  const depB = { blockerTaskId: 'task-c', blockedTaskId: 'task-d' }

  it('setDependencies replaces all', () => {
    store().addDependency(depA)
    store().setDependencies([depB])
    expect(store().dependencies).toHaveLength(1)
    expect(store().dependencies[0]).toEqual(depB)
  })

  it('addDependency appends and marks dirty', () => {
    store().addDependency(depA)
    expect(store().dependencies).toHaveLength(1)
    expect(store().isDirty).toBe(true)
  })

  it('removeDependency removes the exact matching pair and marks dirty', () => {
    store().setDependencies([depA, depB])
    store().removeDependency('task-a', 'task-b')
    expect(store().dependencies).toHaveLength(1)
    expect(store().dependencies[0]).toEqual(depB)
    expect(store().isDirty).toBe(true)
  })

  it('removeDependency does not remove partial matches (same blocker different blocked)', () => {
    const depPartial = { blockerTaskId: 'task-a', blockedTaskId: 'task-z' }
    store().setDependencies([depA, depPartial])
    store().removeDependency('task-a', 'task-b')
    expect(store().dependencies).toHaveLength(1)
    expect(store().dependencies[0]).toEqual(depPartial)
  })

  it('removeDependency does not remove partial matches (same blocked different blocker)', () => {
    const depPartial = { blockerTaskId: 'task-z', blockedTaskId: 'task-b' }
    store().setDependencies([depA, depPartial])
    store().removeDependency('task-a', 'task-b')
    expect(store().dependencies).toHaveLength(1)
    expect(store().dependencies[0]).toEqual(depPartial)
  })
})

describe('checklist state', () => {
  it('setChecklistSummaries replaces the summaries map', () => {
    const summaries = { 'task-1': { checked: 2, crossed: 0, total: 5 } }
    store().setChecklistSummaries(summaries)
    expect(store().checklistSummaries).toEqual(summaries)
  })

  it('setChecklistPreviews replaces the previews map', () => {
    const previews = {
      'task-1': [{ title: 'Step 1', state: 'checked', groupName: 'Scope' }],
    }
    store().setChecklistPreviews(previews)
    expect(store().checklistPreviews).toEqual(previews)
  })

  it('toggleChecklistPreview cycles off → preview → full → off', () => {
    expect(store().checklistViewMode).toBe('off')
    store().toggleChecklistPreview()
    expect(store().checklistViewMode).toBe('preview')
    store().toggleChecklistPreview()
    expect(store().checklistViewMode).toBe('full')
    store().toggleChecklistPreview()
    expect(store().checklistViewMode).toBe('off')
  })

  it('toggleChecklistPreview completes a second full cycle correctly', () => {
    store().toggleChecklistPreview()
    store().toggleChecklistPreview()
    store().toggleChecklistPreview()
    store().toggleChecklistPreview()
    expect(store().checklistViewMode).toBe('preview')
  })
})

describe('UI toggles and selection', () => {
  it('toggleShowDates flips false → true', () => {
    expect(store().showDates).toBe(false)
    store().toggleShowDates()
    expect(store().showDates).toBe(true)
  })

  it('toggleShowDates flips true → false', () => {
    store().toggleShowDates()
    store().toggleShowDates()
    expect(store().showDates).toBe(false)
  })

  it('selectTask sets selectedTaskId', () => {
    store().selectTask('task-99')
    expect(store().selectedTaskId).toBe('task-99')
  })

  it('selectTask with null clears selectedTaskId', () => {
    store().selectTask('task-99')
    store().selectTask(null)
    expect(store().selectedTaskId).toBeNull()
  })

  it('selectTask replaces a previously selected id', () => {
    store().selectTask('task-1')
    store().selectTask('task-2')
    expect(store().selectedTaskId).toBe('task-2')
  })
})

describe('convertToTimeline', () => {
  it('sets startDate, endDate and onTimeline true for the target task', () => {
    store().setTasks([makeTask({ id: 'task-1', onTimeline: false })])
    store().convertToTimeline('task-1', '2025-01-01', '2025-01-31')
    const t = store().tasks.find((t) => t.id === 'task-1')
    expect(t?.onTimeline).toBe(true)
    expect(t?.startDate).toBe('2025-01-01')
    expect(t?.endDate).toBe('2025-01-31')
  })

  it('convertToTimeline marks isDirty', () => {
    store().setTasks([makeTask({ id: 'task-1' })])
    store().convertToTimeline('task-1', '2025-01-01', '2025-01-31')
    expect(store().isDirty).toBe(true)
  })

  it('convertToTimeline does not mutate other tasks', () => {
    store().setTasks([
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', onTimeline: false }),
    ])
    store().convertToTimeline('task-1', '2025-01-01', '2025-01-31')
    expect(store().tasks.find((t) => t.id === 'task-2')?.onTimeline).toBe(false)
  })
})

describe('dirty flag behavior', () => {
  it('starts clean', () => {
    expect(store().isDirty).toBe(false)
  })

  it('setTasks clears dirty regardless of prior state', () => {
    store().addTask(makeTask())
    expect(store().isDirty).toBe(true)
    store().setTasks([makeTask({ id: 'task-fresh' })])
    expect(store().isDirty).toBe(false)
  })

  it('markClean resets dirty to false after mutations', () => {
    store().addTask(makeTask())
    store().addLabel({ id: 'lbl-1', projectId: 'p', name: 'X', color: '#000' })
    expect(store().isDirty).toBe(true)
    store().markClean()
    expect(store().isDirty).toBe(false)
  })

  it('markClean is idempotent when already clean', () => {
    store().markClean()
    expect(store().isDirty).toBe(false)
  })

  it.each([
    ['addTask', () => store().addTask(makeTask())],
    ['updateTask', () => { store().setTasks([makeTask()]); store().updateTask('task-1', { name: 'X' }) }],
    ['removeTask', () => { store().setTasks([makeTask()]); store().removeTask('task-1') }],
    ['moveTask', () => { store().setTasks([makeTask()]); store().moveTask('task-1', 'col-2', 1) }],
    ['addLabel', () => store().addLabel({ id: 'l1', projectId: 'p', name: 'L', color: '#f' })],
    ['updateLabel', () => { store().setLabels([{ id: 'l1', projectId: 'p', name: 'L', color: '#f' }]); store().updateLabel('l1', { name: 'M' }) }],
    ['removeLabel', () => { store().setLabels([{ id: 'l1', projectId: 'p', name: 'L', color: '#f' }]); store().removeLabel('l1') }],
    ['addDependency', () => store().addDependency({ blockerTaskId: 'a', blockedTaskId: 'b' })],
    ['removeDependency', () => { store().setDependencies([{ blockerTaskId: 'a', blockedTaskId: 'b' }]); store().removeDependency('a', 'b') }],
    ['convertToTimeline', () => { store().setTasks([makeTask()]); store().convertToTimeline('task-1', '2025-01-01', '2025-12-31') }],
  ])('%s marks isDirty true', (_label, action) => {
    action()
    expect(store().isDirty).toBe(true)
  })
})
