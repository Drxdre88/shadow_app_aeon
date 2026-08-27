import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({
  requireOwnership: vi.fn(),
  requireEditor: vi.fn(),
}))

vi.mock('@/lib/data/tasks', () => ({
  findTasks: vi.fn(),
  findTaskById: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
  archiveTask: vi.fn(),
  restoreTask: vi.fn(),
  archiveTasksBatch: vi.fn(),
  findArchivedTasks: vi.fn(),
}))

vi.mock('@/lib/data/columns', () => ({
  findColumns: vi.fn(),
  createDefaultColumns: vi.fn(),
}))

vi.mock('@/lib/data/labels', () => ({
  findLabels: vi.fn(),
  findTaskLabels: vi.fn(),
  setTaskLabels: vi.fn(),
}))

vi.mock('@/lib/data/dependencies', () => ({
  findDependencies: vi.fn(),
}))

vi.mock('@/lib/data/checklist', () => ({
  findChecklistSummariesAndPreviews: vi.fn(),
  findChecklistItems: vi.fn(),
  createChecklistItemsBatch: vi.fn(),
}))

vi.mock('@/lib/data/assignees', () => ({
  getAssigneesForProject: vi.fn(),
}))

vi.mock('@/lib/data/virtual-members', () => ({
  getVirtualAssigneesForProject: vi.fn(),
  findVirtualMembersForProject: vi.fn(),
}))

vi.mock('@/lib/data/bridge', () => ({
  syncBoardStatusToGantt: vi.fn(),
  deleteLinkedGanttTask: vi.fn(),
}))

vi.mock('@/lib/data/activity', () => ({
  emitActivity: vi.fn(),
}))

vi.mock('@/lib/kairos/auto-capture', () => ({
  captureBoardEvent: vi.fn().mockResolvedValue(undefined),
  captureProjectEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/data/storage', () => ({
  checkStorageLimit: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { requireOwnership, requireEditor } from '@/lib/actions/helpers'
import {
  findTasks as _findTasks,
  findTaskById as _findTaskById,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  archiveTask as _archiveTask,
  restoreTask as _restoreTask,
  archiveTasksBatch as _archiveTasksBatch,
  findArchivedTasks as _findArchivedTasks,
} from '@/lib/data/tasks'
import { findColumns as _findColumns, createDefaultColumns as _createDefaultColumns } from '@/lib/data/columns'
import { findLabels as _findLabels, findTaskLabels as _findTaskLabels, setTaskLabels as _setTaskLabels } from '@/lib/data/labels'
import { findDependencies as _findDependencies } from '@/lib/data/dependencies'
import {
  findChecklistSummariesAndPreviews as _findChecklistSummariesAndPreviews,
  findChecklistItems as _findChecklistItems,
  createChecklistItemsBatch as _createChecklistItemsBatch,
} from '@/lib/data/checklist'
import { syncBoardStatusToGantt, deleteLinkedGanttTask } from '@/lib/data/bridge'
import { emitActivity } from '@/lib/data/activity'
import { checkStorageLimit } from '@/lib/data/storage'
import { getAssigneesForProject as _getAssigneesForProject } from '@/lib/data/assignees'
import {
  getVirtualAssigneesForProject as _getVirtualAssigneesForProject,
  findVirtualMembersForProject as _findVirtualMembersForProject,
} from '@/lib/data/virtual-members'

import {
  loadBoardData,
  createBoardTask,
  updateBoardTask,
  deleteBoardTask,
  archiveBoardTask,
  restoreBoardTask,
  getArchivedTasks,
  archiveColumnTasks,
  duplicateBoardTask,
} from '../board'

const PROJECT_ID = 'a1b2c3d4-1111-4111-a111-000000000001'
const TASK_ID = 'a1b2c3d4-1111-4111-a111-000000000002'
const COLUMN_ID = 'a1b2c3d4-1111-4111-a111-000000000003'
const NEW_TASK_ID = 'a1b2c3d4-1111-4111-a111-000000000004'
const LABEL_ID = 'a1b2c3d4-1111-4111-a111-000000000005'
const OTHER_COLUMN_ID = 'a1b2c3d4-1111-4111-a111-000000000099'
const USER_ID = 'user-1'

const makeTask = (overrides = {}) => ({
  id: TASK_ID,
  projectId: PROJECT_ID,
  name: 'Test Task',
  columnId: COLUMN_ID,
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  onTimeline: false,
  orderIndex: 0,
  size: null,
  progress: null,
  description: null,
  startDate: null as Date | null,
  endDate: null as Date | null,
  metadata: {} as unknown,
  ganttTaskId: null as string | null,
  completedAt: null as Date | null,
  archivedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const makeColumn = (overrides = {}) => ({
  id: COLUMN_ID,
  projectId: PROJECT_ID,
  name: 'Backlog',
  color: 'purple',
  orderIndex: 0,
  icon: null as string | null,
  createdAt: new Date(),
  ...overrides,
})

const makeLabel = (overrides = {}) => ({
  id: LABEL_ID,
  projectId: PROJECT_ID,
  name: 'Bug',
  color: 'red',
  createdAt: new Date(),
  ...overrides,
})

const makeChecklistItem = (overrides = {}) => ({
  id: 'checklist-item-1',
  taskId: TASK_ID,
  title: 'Step one',
  groupName: 'Steps',
  state: 'unchecked',
  completed: false,
  status: null as string | null,
  startDate: null as Date | null,
  endDate: null as Date | null,
  orderIndex: 0,
  createdAt: new Date(),
  ...overrides,
})

const validCreateData = {
  id: NEW_TASK_ID,
  projectId: PROJECT_ID,
  name: 'New Task',
  columnId: COLUMN_ID,
  status: 'todo' as const,
  priority: 'medium' as const,
  color: 'purple',
  onTimeline: false,
  orderIndex: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireOwnership).mockResolvedValue(USER_ID)
  vi.mocked(requireEditor).mockResolvedValue(USER_ID)
  vi.mocked(checkStorageLimit).mockResolvedValue({ allowed: true, limit: 100, current: 5, remaining: 95 })
  vi.mocked(emitActivity).mockResolvedValue(undefined)
  vi.mocked(syncBoardStatusToGantt).mockResolvedValue(undefined)
  vi.mocked(deleteLinkedGanttTask).mockResolvedValue(undefined)
  vi.mocked(_createDefaultColumns).mockResolvedValue(undefined)
  vi.mocked(_findTasks).mockResolvedValue([])
  vi.mocked(_findColumns).mockResolvedValue([])
  vi.mocked(_findLabels).mockResolvedValue([])
  vi.mocked(_findTaskLabels).mockResolvedValue([])
  vi.mocked(_findDependencies).mockResolvedValue([])
  vi.mocked(_findChecklistSummariesAndPreviews).mockResolvedValue({ summaries: {}, previews: {} })
  vi.mocked(_getAssigneesForProject).mockResolvedValue({})
  vi.mocked(_getVirtualAssigneesForProject).mockResolvedValue({})
  vi.mocked(_findVirtualMembersForProject).mockResolvedValue([])
})

describe('loadBoardData', () => {
  it('calls requireOwnership with projectId', async () => {
    await loadBoardData(PROJECT_ID)
    expect(requireOwnership).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('calls createDefaultColumns to ensure columns exist', async () => {
    await loadBoardData(PROJECT_ID)
    expect(_createDefaultColumns).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('returns all board data from parallel queries', async () => {
    const tasks = [makeTask()]
    const columns = [makeColumn()]
    const labels = [makeLabel()]
    const taskLabels = [{ taskId: TASK_ID, labelId: LABEL_ID }]
    const dependencies = [{ id: 'dep-1', blockerTaskId: TASK_ID, blockedTaskId: NEW_TASK_ID }]
    const checklistSummaries = { [TASK_ID]: { total: 2, checked: 1, crossed: 0 } }
    const checklistPreviews = { [TASK_ID]: [{ title: 'Step one', state: 'unchecked', groupName: 'Steps' }] }

    vi.mocked(_findTasks).mockResolvedValue(tasks)
    vi.mocked(_findColumns).mockResolvedValue(columns)
    vi.mocked(_findLabels).mockResolvedValue(labels)
    vi.mocked(_findTaskLabels).mockResolvedValue(taskLabels)
    vi.mocked(_findDependencies).mockResolvedValue(dependencies)
    vi.mocked(_findChecklistSummariesAndPreviews).mockResolvedValue({ summaries: checklistSummaries, previews: checklistPreviews })

    const result = await loadBoardData(PROJECT_ID)

    expect(result).toEqual({ tasks, columns, labels, taskLabels, dependencies, checklistSummaries, checklistPreviews, assignees: {}, virtualAssignees: {}, virtualMembers: [] })
  })

  it('throws when requireOwnership rejects', async () => {
    vi.mocked(requireOwnership).mockRejectedValue(new Error('Unauthorized'))
    await expect(loadBoardData(PROJECT_ID)).rejects.toThrow('Unauthorized')
  })
})

describe('createBoardTask', () => {
  it('calls requireEditor with projectId', async () => {
    vi.mocked(_createTask).mockResolvedValue(makeTask())
    await createBoardTask(validCreateData)
    expect(requireEditor).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('checks storage limit before creating', async () => {
    vi.mocked(_createTask).mockResolvedValue(makeTask())
    await createBoardTask(validCreateData)
    expect(checkStorageLimit).toHaveBeenCalledWith(USER_ID, 'tasks')
  })

  it('throws when storage limit is reached', async () => {
    vi.mocked(checkStorageLimit).mockResolvedValue({ allowed: false, limit: 10, current: 10, remaining: 0 })
    await expect(createBoardTask(validCreateData)).rejects.toThrow('Task limit reached (10)')
  })

  it('calls _createTask with validated data and provided id', async () => {
    const task = makeTask({ name: 'New Task' })
    vi.mocked(_createTask).mockResolvedValue(task)

    await createBoardTask(validCreateData)

    expect(_createTask).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ name: 'New Task', status: 'todo', priority: 'medium' }),
      NEW_TASK_ID
    )
  })

  it('returns the created task', async () => {
    const task = makeTask({ name: 'New Task' })
    vi.mocked(_createTask).mockResolvedValue(task)

    const result = await createBoardTask(validCreateData)

    expect(result).toEqual(task)
  })

  it('forwards size and progress so a card created with them keeps them', async () => {
    vi.mocked(_createTask).mockResolvedValue(makeTask({ size: 5, progress: 40 }))

    await createBoardTask({ ...validCreateData, size: 5, progress: 40 })

    expect(_createTask).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ size: 5, progress: 40 }),
      NEW_TASK_ID
    )
  })

  it('writes labels picked at creation time to the join table', async () => {
    vi.mocked(_createTask).mockResolvedValue(makeTask())

    await createBoardTask({ ...validCreateData, labels: [LABEL_ID] })

    expect(_setTaskLabels).toHaveBeenCalledWith(TASK_ID, [LABEL_ID], PROJECT_ID)
  })

  it('skips the label write when no labels were picked', async () => {
    vi.mocked(_createTask).mockResolvedValue(makeTask())

    await createBoardTask(validCreateData)

    expect(_setTaskLabels).not.toHaveBeenCalled()
  })

  it('emits created activity after task creation', async () => {
    const task = makeTask({ name: 'New Task' })
    vi.mocked(_createTask).mockResolvedValue(task)

    await createBoardTask(validCreateData)

    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT_ID, 'task', task.id, 'created', 'New Task', undefined, USER_ID
    )
  })

  it('rejects on empty name (schema validation)', async () => {
    await expect(
      createBoardTask({ ...validCreateData, name: '' })
    ).rejects.toThrow()
  })

  it('rejects on name exceeding 255 characters (schema validation)', async () => {
    await expect(
      createBoardTask({ ...validCreateData, name: 'x'.repeat(256) })
    ).rejects.toThrow()
  })

  it('rejects on invalid priority (schema validation)', async () => {
    await expect(
      createBoardTask({ ...validCreateData, priority: 'critical' as 'urgent' })
    ).rejects.toThrow()
  })

  it('rejects on invalid status (schema validation)', async () => {
    await expect(
      createBoardTask({ ...validCreateData, status: 'pending' as 'todo' })
    ).rejects.toThrow()
  })

  it('throws when requireEditor rejects', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Viewers cannot modify this project'))
    await expect(createBoardTask(validCreateData)).rejects.toThrow('Viewers cannot modify this project')
  })
})

describe('updateBoardTask', () => {
  it('calls requireEditor with projectId', async () => {
    vi.mocked(_updateTask).mockResolvedValue(makeTask())
    await updateBoardTask(TASK_ID, PROJECT_ID, { name: 'Renamed' })
    expect(requireEditor).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('calls _updateTask with validated data', async () => {
    const task = makeTask({ name: 'Renamed' })
    vi.mocked(_updateTask).mockResolvedValue(task)

    await updateBoardTask(TASK_ID, PROJECT_ID, { name: 'Renamed' })

    expect(_updateTask).toHaveBeenCalledWith(
      TASK_ID, PROJECT_ID, expect.objectContaining({ name: 'Renamed' })
    )
  })

  it('returns the updated task', async () => {
    const task = makeTask({ name: 'Renamed' })
    vi.mocked(_updateTask).mockResolvedValue(task)

    const result = await updateBoardTask(TASK_ID, PROJECT_ID, { name: 'Renamed' })

    expect(result).toEqual(task)
  })

  it('emits completed activity when status is done', async () => {
    const task = makeTask({ status: 'done', name: 'Finished Task' })
    vi.mocked(_updateTask).mockResolvedValue(task)

    await updateBoardTask(TASK_ID, PROJECT_ID, { status: 'done' })

    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT_ID, 'task', TASK_ID, 'completed', 'Finished Task', undefined, USER_ID
    )
  })

  it('emits moved activity when columnId changes', async () => {
    const existingTask = makeTask({ columnId: COLUMN_ID })
    const updatedTask = makeTask({ columnId: OTHER_COLUMN_ID, name: 'Moved Task' })

    vi.mocked(_findTaskById).mockResolvedValue(existingTask)
    vi.mocked(_updateTask).mockResolvedValue(updatedTask)

    await updateBoardTask(TASK_ID, PROJECT_ID, { columnId: OTHER_COLUMN_ID })

    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT_ID, 'task', TASK_ID, 'moved', 'Moved Task',
      { fromColumnId: COLUMN_ID, toColumnId: OTHER_COLUMN_ID },
      USER_ID
    )
  })

  it('fetches existing task to track column change when columnId is provided', async () => {
    vi.mocked(_findTaskById).mockResolvedValue(makeTask())
    vi.mocked(_updateTask).mockResolvedValue(makeTask({ columnId: OTHER_COLUMN_ID }))

    await updateBoardTask(TASK_ID, PROJECT_ID, { columnId: OTHER_COLUMN_ID })

    expect(_findTaskById).toHaveBeenCalledWith(TASK_ID, PROJECT_ID)
  })

  it('does not fetch existing task when columnId is not provided', async () => {
    vi.mocked(_updateTask).mockResolvedValue(makeTask({ name: 'Renamed' }))

    await updateBoardTask(TASK_ID, PROJECT_ID, { name: 'Renamed' })

    expect(_findTaskById).not.toHaveBeenCalled()
  })

  it('emits updated activity for generic field changes', async () => {
    const task = makeTask({ name: 'Updated Task' })
    vi.mocked(_updateTask).mockResolvedValue(task)

    await updateBoardTask(TASK_ID, PROJECT_ID, { name: 'Updated Task' })

    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT_ID, 'task', TASK_ID, 'updated', 'Updated Task', undefined, USER_ID
    )
  })

  it('calls syncBoardStatusToGantt when status is updated', async () => {
    vi.mocked(_updateTask).mockResolvedValue(makeTask({ status: 'in-progress' }))

    await updateBoardTask(TASK_ID, PROJECT_ID, { status: 'in-progress' })

    expect(syncBoardStatusToGantt).toHaveBeenCalledWith(TASK_ID, 'in-progress')
  })

  it('does not call syncBoardStatusToGantt when status is not in the update', async () => {
    vi.mocked(_updateTask).mockResolvedValue(makeTask({ name: 'Renamed' }))

    await updateBoardTask(TASK_ID, PROJECT_ID, { name: 'Renamed' })

    expect(syncBoardStatusToGantt).not.toHaveBeenCalled()
  })

  it('rejects on invalid priority (schema validation)', async () => {
    await expect(
      updateBoardTask(TASK_ID, PROJECT_ID, { priority: 'blocker' as 'urgent' })
    ).rejects.toThrow()
  })

  it('rejects on empty name string (schema validation)', async () => {
    await expect(
      updateBoardTask(TASK_ID, PROJECT_ID, { name: '' })
    ).rejects.toThrow()
  })

  it('throws when requireEditor rejects', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Unauthorized'))
    await expect(updateBoardTask(TASK_ID, PROJECT_ID, { name: 'x' })).rejects.toThrow('Unauthorized')
  })
})

describe('deleteBoardTask', () => {
  it('calls requireEditor with projectId', async () => {
    vi.mocked(_findTaskById).mockResolvedValue(makeTask())
    await deleteBoardTask(TASK_ID, PROJECT_ID)
    expect(requireEditor).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('calls deleteLinkedGanttTask before deleting the task', async () => {
    const deleteOrder: string[] = []
    vi.mocked(_findTaskById).mockResolvedValue(makeTask())
    vi.mocked(deleteLinkedGanttTask).mockImplementation(async () => { deleteOrder.push('gantt') })
    vi.mocked(_deleteTask).mockImplementation(async () => { deleteOrder.push('task'); return true })

    await deleteBoardTask(TASK_ID, PROJECT_ID)

    expect(deleteOrder).toEqual(['gantt', 'task'])
  })

  it('calls _deleteTask with taskId and projectId', async () => {
    vi.mocked(_findTaskById).mockResolvedValue(makeTask())
    await deleteBoardTask(TASK_ID, PROJECT_ID)
    expect(_deleteTask).toHaveBeenCalledWith(TASK_ID, PROJECT_ID)
  })

  it('emits deleted activity with the task name', async () => {
    vi.mocked(_findTaskById).mockResolvedValue(makeTask({ name: 'To Be Deleted' }))
    await deleteBoardTask(TASK_ID, PROJECT_ID)
    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT_ID, 'task', TASK_ID, 'deleted', 'To Be Deleted', undefined, USER_ID
    )
  })

  it('throws when requireEditor rejects', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Unauthorized'))
    await expect(deleteBoardTask(TASK_ID, PROJECT_ID)).rejects.toThrow('Unauthorized')
  })
})

describe('archiveBoardTask', () => {
  it('calls requireEditor with projectId', async () => {
    vi.mocked(_archiveTask).mockResolvedValue(makeTask())
    await archiveBoardTask(TASK_ID, PROJECT_ID)
    expect(requireEditor).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('calls _archiveTask and returns the result', async () => {
    const task = makeTask({ name: 'Archived Task' })
    vi.mocked(_archiveTask).mockResolvedValue(task)

    const result = await archiveBoardTask(TASK_ID, PROJECT_ID)

    expect(_archiveTask).toHaveBeenCalledWith(TASK_ID, PROJECT_ID)
    expect(result).toEqual(task)
  })

  it('emits archived activity when task is found', async () => {
    const task = makeTask({ name: 'Archived Task' })
    vi.mocked(_archiveTask).mockResolvedValue(task)

    await archiveBoardTask(TASK_ID, PROJECT_ID)

    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT_ID, 'task', TASK_ID, 'archived', 'Archived Task', undefined, USER_ID
    )
  })

  it('does not emit activity when task is not found', async () => {
    vi.mocked(_archiveTask).mockResolvedValue(null as never)

    await archiveBoardTask(TASK_ID, PROJECT_ID)

    expect(emitActivity).not.toHaveBeenCalled()
  })

  it('throws when requireEditor rejects', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Unauthorized'))
    await expect(archiveBoardTask(TASK_ID, PROJECT_ID)).rejects.toThrow('Unauthorized')
  })
})

describe('restoreBoardTask', () => {
  it('calls requireEditor with projectId', async () => {
    vi.mocked(_restoreTask).mockResolvedValue(makeTask())
    await restoreBoardTask(TASK_ID, PROJECT_ID)
    expect(requireEditor).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('calls _restoreTask and returns the result', async () => {
    const task = makeTask({ name: 'Restored Task' })
    vi.mocked(_restoreTask).mockResolvedValue(task)

    const result = await restoreBoardTask(TASK_ID, PROJECT_ID)

    expect(_restoreTask).toHaveBeenCalledWith(TASK_ID, PROJECT_ID)
    expect(result).toEqual(task)
  })

  it('emits restored activity when task is found', async () => {
    const task = makeTask({ name: 'Restored Task' })
    vi.mocked(_restoreTask).mockResolvedValue(task)

    await restoreBoardTask(TASK_ID, PROJECT_ID)

    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT_ID, 'task', TASK_ID, 'restored', 'Restored Task', undefined, USER_ID
    )
  })

  it('does not emit activity when task is not found', async () => {
    vi.mocked(_restoreTask).mockResolvedValue(null as never)

    await restoreBoardTask(TASK_ID, PROJECT_ID)

    expect(emitActivity).not.toHaveBeenCalled()
  })

  it('throws when requireEditor rejects', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Unauthorized'))
    await expect(restoreBoardTask(TASK_ID, PROJECT_ID)).rejects.toThrow('Unauthorized')
  })
})

describe('getArchivedTasks', () => {
  it('calls requireOwnership with projectId', async () => {
    vi.mocked(_findArchivedTasks).mockResolvedValue([])
    await getArchivedTasks(PROJECT_ID)
    expect(requireOwnership).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('returns archived tasks', async () => {
    const archived = [makeTask({ name: 'Old Task' })]
    vi.mocked(_findArchivedTasks).mockResolvedValue(archived)

    const result = await getArchivedTasks(PROJECT_ID)

    expect(result).toEqual(archived)
  })

  it('throws when requireOwnership rejects', async () => {
    vi.mocked(requireOwnership).mockRejectedValue(new Error('Unauthorized'))
    await expect(getArchivedTasks(PROJECT_ID)).rejects.toThrow('Unauthorized')
  })
})

describe('archiveColumnTasks', () => {
  it('calls requireEditor with projectId', async () => {
    vi.mocked(_findTasks).mockResolvedValue([])
    vi.mocked(_archiveTasksBatch).mockResolvedValue([])
    await archiveColumnTasks(PROJECT_ID, COLUMN_ID)
    expect(requireEditor).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('archives only tasks belonging to the specified column', async () => {
    const colTask = makeTask({ id: 'task-in-col', columnId: COLUMN_ID })
    const otherTask = makeTask({ id: 'task-other-col', columnId: OTHER_COLUMN_ID })

    vi.mocked(_findTasks).mockResolvedValue([colTask, otherTask])
    vi.mocked(_archiveTasksBatch).mockResolvedValue([colTask])

    await archiveColumnTasks(PROJECT_ID, COLUMN_ID)

    expect(_archiveTasksBatch).toHaveBeenCalledWith(PROJECT_ID, ['task-in-col'])
  })

  it('emits archived activity for each archived task', async () => {
    const task1 = makeTask({ id: 'task-a', name: 'Task A', columnId: COLUMN_ID })
    const task2 = makeTask({ id: 'task-b', name: 'Task B', columnId: COLUMN_ID })

    vi.mocked(_findTasks).mockResolvedValue([task1, task2])
    vi.mocked(_archiveTasksBatch).mockResolvedValue([task1, task2])

    await archiveColumnTasks(PROJECT_ID, COLUMN_ID)

    expect(emitActivity).toHaveBeenCalledTimes(2)
    expect(emitActivity).toHaveBeenCalledWith(PROJECT_ID, 'task', 'task-a', 'archived', 'Task A', undefined, USER_ID)
    expect(emitActivity).toHaveBeenCalledWith(PROJECT_ID, 'task', 'task-b', 'archived', 'Task B', undefined, USER_ID)
  })

  it('returns the list of archived tasks', async () => {
    const task = makeTask({ columnId: COLUMN_ID })
    vi.mocked(_findTasks).mockResolvedValue([task])
    vi.mocked(_archiveTasksBatch).mockResolvedValue([task])

    const result = await archiveColumnTasks(PROJECT_ID, COLUMN_ID)

    expect(result).toEqual([task])
  })

  it('throws when requireEditor rejects', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Unauthorized'))
    await expect(archiveColumnTasks(PROJECT_ID, COLUMN_ID)).rejects.toThrow('Unauthorized')
  })
})

describe('duplicateBoardTask', () => {
  const sourceTask = makeTask({
    id: TASK_ID,
    name: 'Original Task',
    columnId: COLUMN_ID,
    status: 'todo',
    priority: 'high',
    color: 'blue',
    onTimeline: true,
    size: 2,
    description: 'Some description',
    orderIndex: 3,
  })

  const duplicatedTask = makeTask({
    id: NEW_TASK_ID,
    name: 'Copy of Original Task',
    columnId: COLUMN_ID,
    orderIndex: 4,
  })

  beforeEach(() => {
    vi.mocked(_findTaskById).mockResolvedValue(sourceTask)
    vi.mocked(_findTasks).mockResolvedValue([sourceTask])
    vi.mocked(_createTask).mockResolvedValue(duplicatedTask)
    vi.mocked(_findTaskLabels).mockResolvedValue([])
    vi.mocked(_findChecklistItems).mockResolvedValue([])
  })

  it('calls requireEditor with projectId', async () => {
    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)
    expect(requireEditor).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('throws when source task is not found', async () => {
    vi.mocked(_findTaskById).mockResolvedValue(null as never)
    await expect(duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)).rejects.toThrow('Source task not found')
  })

  it('creates new task with Copy of prefix', async () => {
    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)

    expect(_createTask).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ name: 'Copy of Original Task' }),
      NEW_TASK_ID
    )
  })

  it('places duplicate at maxOrder + 1 within the same column', async () => {
    const task0 = makeTask({ id: 'task-0', columnId: COLUMN_ID, orderIndex: 0 })
    const task1 = makeTask({ id: 'task-1', columnId: COLUMN_ID, orderIndex: 5 })
    vi.mocked(_findTasks).mockResolvedValue([task0, task1, sourceTask])

    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)

    expect(_createTask).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ orderIndex: 6 }),
      NEW_TASK_ID
    )
  })

  it('copies source task properties to the duplicate', async () => {
    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)

    expect(_createTask).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        status: 'todo',
        priority: 'high',
        color: 'blue',
        onTimeline: true,
        size: 2,
        description: 'Some description',
      }),
      NEW_TASK_ID
    )
  })

  it('copies labels from source task', async () => {
    vi.mocked(_findTaskLabels).mockResolvedValue([
      { taskId: TASK_ID, labelId: LABEL_ID },
      { taskId: TASK_ID, labelId: 'another-label-id' },
    ])

    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)

    expect(_setTaskLabels).toHaveBeenCalledWith(NEW_TASK_ID, [LABEL_ID, 'another-label-id'], PROJECT_ID)
  })

  it('does not call setTaskLabels when source has no labels', async () => {
    vi.mocked(_findTaskLabels).mockResolvedValue([])

    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)

    expect(_setTaskLabels).not.toHaveBeenCalled()
  })

  it('copies checklist items from source task', async () => {
    const items = [
      makeChecklistItem({ title: 'Step 1', groupName: 'Phase 1' }),
      makeChecklistItem({ id: 'item-2', title: 'Step 2', groupName: 'Phase 1' }),
    ]
    vi.mocked(_findChecklistItems).mockResolvedValue(items)

    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)

    expect(_createChecklistItemsBatch).toHaveBeenCalledWith(
      NEW_TASK_ID,
      [
        { title: 'Step 1', groupName: 'Phase 1' },
        { title: 'Step 2', groupName: 'Phase 1' },
      ]
    )
  })

  it('does not call createChecklistItemsBatch when source has no checklist', async () => {
    vi.mocked(_findChecklistItems).mockResolvedValue([])

    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)

    expect(_createChecklistItemsBatch).not.toHaveBeenCalled()
  })

  it('emits created activity with duplicatedFrom metadata', async () => {
    await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)

    expect(emitActivity).toHaveBeenCalledWith(
      PROJECT_ID, 'task', NEW_TASK_ID, 'created', 'Copy of Original Task',
      { duplicatedFrom: TASK_ID },
      USER_ID
    )
  })

  it('returns the newly created task', async () => {
    const result = await duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)
    expect(result).toEqual(duplicatedTask)
  })

  it('throws when requireEditor rejects', async () => {
    vi.mocked(requireEditor).mockRejectedValue(new Error('Unauthorized'))
    await expect(duplicateBoardTask(TASK_ID, PROJECT_ID, NEW_TASK_ID)).rejects.toThrow('Unauthorized')
  })
})
