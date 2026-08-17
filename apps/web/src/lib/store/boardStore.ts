import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface BoardColumn {
  id: string
  projectId: string
  name: string
  color: string
  icon?: string | null
  orderIndex: number
}

export interface BoardTask {
  id: string
  projectId: string
  name: string
  description?: string
  columnId?: string
  status: string
  priority: Priority
  color: string
  labels: string[]
  startDate?: string
  endDate?: string
  onTimeline: boolean
  ganttTaskId?: string | null
  size?: number | null
  progress?: number | null
  updatedAt?: string
  orderIndex: number
}

interface Label {
  id: string
  projectId: string
  name: string
  color: string
}

interface Dependency {
  blockerTaskId: string
  blockedTaskId: string
}

export interface ChecklistSummary {
  checked: number
  crossed: number
  total: number
}

export interface ChecklistPreviewItem {
  title: string
  state: string
  groupName: string
}

export interface TaskAssigneePill {
  userId: string
  name: string | null
  image: string | null
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'retrying' | 'error' | 'offline'

interface BoardState {
  columns: BoardColumn[]
  tasks: BoardTask[]
  labels: Label[]
  dependencies: Dependency[]
  checklistSummaries: Record<string, ChecklistSummary>
  selectedTaskId: string | null
  isDirty: boolean
  saveStatus: SaveStatus
  lastMutatedAt: number

  setColumns: (columns: BoardColumn[]) => void
  addColumn: (column: BoardColumn) => void
  updateColumn: (id: string, updates: Partial<BoardColumn>) => void
  removeColumn: (id: string) => void
  reorderColumns: (updates: { id: string; orderIndex: number }[]) => void

  setTasks: (tasks: BoardTask[]) => void
  addTask: (task: BoardTask) => void
  updateTask: (id: string, updates: Partial<BoardTask>) => void
  removeTask: (id: string) => void
  moveTask: (id: string, columnId: string, orderIndex: number) => void
  swapTaskOrder: (idA: string, orderA: number, idB: string, orderB: number) => void

  setLabels: (labels: Label[]) => void
  addLabel: (label: Label) => void
  updateLabel: (id: string, updates: Partial<Label>) => void
  removeLabel: (id: string) => void

  setDependencies: (deps: Dependency[]) => void
  addDependency: (dep: Dependency) => void
  removeDependency: (blockerTaskId: string, blockedTaskId: string) => void

  setChecklistSummaries: (summaries: Record<string, ChecklistSummary>) => void
  updateChecklistSummary: (taskId: string, summary: ChecklistSummary) => void

  checklistPreviews: Record<string, ChecklistPreviewItem[]>
  setChecklistPreviews: (previews: Record<string, ChecklistPreviewItem[]>) => void
  checklistViewMode: 'off' | 'preview' | 'full'
  toggleChecklistPreview: () => void

  assigneesByTask: Record<string, TaskAssigneePill[]>
  setAssigneesByTask: (m: Record<string, TaskAssigneePill[]>) => void
  setTaskAssignees: (taskId: string, list: TaskAssigneePill[]) => void

  showDates: boolean
  toggleShowDates: () => void

  crossedTaskIds: Record<string, true>
  addCrossedTask: (taskId: string) => void
  removeCrossedTask: (taskId: string) => void
  clearCrossedTasks: () => void

  selectTask: (id: string | null) => void
  convertToTimeline: (taskId: string, startDate: string, endDate: string) => void
  markClean: () => void
  setSaveStatus: (status: SaveStatus) => void
}

const DIRTY_GRACE_MS = 5000

// Holds the timer that fades a terminal save state (saved/error) back to idle.
let saveFadeTimer: ReturnType<typeof setTimeout> | null = null

export const useBoardStore = create<BoardState>()(
  persist(
    (set) => ({
      columns: [],
      tasks: [],
      labels: [],
      dependencies: [],
      checklistSummaries: {},
      checklistPreviews: {},
      assigneesByTask: {},
      checklistViewMode: 'off' as 'off' | 'preview' | 'full',
      selectedTaskId: null,
      isDirty: false,
      saveStatus: 'idle' as SaveStatus,
      lastMutatedAt: 0,
      showDates: false,

      setColumns: (columns) => set({ columns }),
      addColumn: (column) => set((s) => ({ columns: [...s.columns, column], isDirty: true, lastMutatedAt: Date.now() })),
      updateColumn: (id, updates) => set((s) => ({
        columns: s.columns.map((c) => c.id === id ? { ...c, ...updates } : c),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      removeColumn: (id) => set((s) => ({
        columns: s.columns.filter((c) => c.id !== id),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      reorderColumns: (updates) => set((s) => {
        const map = new Map(updates.map((u) => [u.id, u.orderIndex]))
        return {
          columns: s.columns
            .map((c) => map.has(c.id) ? { ...c, orderIndex: map.get(c.id)! } : c)
            .sort((a, b) => a.orderIndex - b.orderIndex),
          isDirty: true,
          lastMutatedAt: Date.now(),
        }
      }),

      setTasks: (tasks) => set({ tasks, isDirty: false }),
      addTask: (task) => set((s) => ({ tasks: [...s.tasks, task], isDirty: true, lastMutatedAt: Date.now() })),
      updateTask: (id, updates) => set((s) => ({
        tasks: s.tasks.map((t) => t.id === id ? { ...t, ...updates } : t),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      removeTask: (id) => set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      moveTask: (id, columnId, orderIndex) => set((s) => ({
        tasks: s.tasks.map((t) => t.id === id ? { ...t, columnId, orderIndex } : t),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      swapTaskOrder: (idA, orderA, idB, orderB) => set((s) => ({
        tasks: s.tasks.map((t) => {
          if (t.id === idA) return { ...t, orderIndex: orderA }
          if (t.id === idB) return { ...t, orderIndex: orderB }
          return t
        }),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),

      setLabels: (labels) => set({ labels }),
      addLabel: (label) => set((s) => ({ labels: [...s.labels, label], isDirty: true, lastMutatedAt: Date.now() })),
      updateLabel: (id, updates) => set((s) => ({
        labels: s.labels.map((l) => l.id === id ? { ...l, ...updates } : l),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      removeLabel: (id) => set((s) => ({
        labels: s.labels.filter((l) => l.id !== id),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),

      setChecklistSummaries: (checklistSummaries) => set({ checklistSummaries }),
      updateChecklistSummary: (taskId, summary) => set((s) => ({
        checklistSummaries: { ...s.checklistSummaries, [taskId]: summary },
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      setChecklistPreviews: (checklistPreviews) => set({ checklistPreviews }),
      setAssigneesByTask: (assigneesByTask) => set({ assigneesByTask }),
      setTaskAssignees: (taskId, list) => set((s) => ({ assigneesByTask: { ...s.assigneesByTask, [taskId]: list } })),
      toggleChecklistPreview: () => set((s) => {
        const cycle = { off: 'preview', preview: 'full', full: 'off' } as const
        return { checklistViewMode: cycle[s.checklistViewMode] }
      }),
      setDependencies: (dependencies) => set({ dependencies }),
      addDependency: (dep) => set((s) => ({
        dependencies: [...s.dependencies, dep],
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      removeDependency: (blockerTaskId, blockedTaskId) => set((s) => ({
        dependencies: s.dependencies.filter(
          (d) => !(d.blockerTaskId === blockerTaskId && d.blockedTaskId === blockedTaskId)
        ),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),

      toggleShowDates: () => set((s) => ({ showDates: !s.showDates })),

      crossedTaskIds: {} as Record<string, true>,
      addCrossedTask: (taskId) => set((s) => ({
        crossedTaskIds: { ...s.crossedTaskIds, [taskId]: true as const },
      })),
      removeCrossedTask: (taskId) => set((s) => {
        const { [taskId]: _, ...rest } = s.crossedTaskIds
        return { crossedTaskIds: rest }
      }),
      clearCrossedTasks: () => set({ crossedTaskIds: {} }),

      selectTask: (id) => set({ selectedTaskId: id }),
      convertToTimeline: (taskId, startDate, endDate) => set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? { ...t, startDate, endDate, onTimeline: true }
            : t
        ),
        isDirty: true,
        lastMutatedAt: Date.now(),
      })),
      markClean: () => set({ isDirty: false }),
      setSaveStatus: (status) => {
        if (saveFadeTimer) { clearTimeout(saveFadeTimer); saveFadeTimer = null }
        set({ saveStatus: status })
        // A terminal state shows briefly, then settles back to the resting "saved" dot.
        // 'offline' is sticky — it must persist until the queue actually drains.
        if (status === 'saved' || status === 'error') {
          saveFadeTimer = setTimeout(() => set({ saveStatus: 'idle' }), status === 'saved' ? 1500 : 4000)
        }
      },
    }),
    {
      name: 'aeon-board',
      partialize: (s) => ({ tasks: s.tasks, labels: s.labels, dependencies: s.dependencies, columns: s.columns }),
    }
  )
)

// External in-flight-write sources (the mutation queue, direct action calls).
// isDirty is a single boolean that several uncoordinated writers reset to
// false on their OWN completion — so on its own it can go false while another
// write is still on the wire, letting a poll/Pusher reload clobber the store
// with a pre-write DB read. These sources close that gap without a circular
// import: mutationQueue registers its pending count, direct callers hold a
// refcount via beginDirectWrite/endDirectWrite.
const pendingWriteSources: Array<() => boolean> = []
export function registerPendingWritesSource(source: () => boolean) {
  pendingWriteSources.push(source)
}

let directWrites = 0
export function beginDirectWrite() { directWrites++ }
export function endDirectWrite() { directWrites = Math.max(0, directWrites - 1) }

export function isDirtyOrGracePeriod(): boolean {
  const s = useBoardStore.getState()
  return (
    s.isDirty ||
    directWrites > 0 ||
    pendingWriteSources.some((hasPending) => hasPending()) ||
    Date.now() - s.lastMutatedAt < DIRTY_GRACE_MS
  )
}

export const useColumns = () => useBoardStore((s) => s.columns)
export const useTasks = () => useBoardStore((s) => s.tasks)
export const useLabels = () => useBoardStore((s) => s.labels)
export const useDependencies = () => useBoardStore((s) => s.dependencies)
export const useSelectedTaskId = () => useBoardStore((s) => s.selectedTaskId)
export const useShowDates = () => useBoardStore((s) => s.showDates)
export const useChecklistSummaries = () => useBoardStore((s) => s.checklistSummaries)
export const useIsDirty = () => useBoardStore((s) => s.isDirty)
export const useChecklistViewMode = () => useBoardStore((s) => s.checklistViewMode)
export const useTaskAssignees = (taskId: string) => useBoardStore((s) => s.assigneesByTask[taskId])
