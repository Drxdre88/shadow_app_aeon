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

interface BoardTask {
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

interface BoardState {
  columns: BoardColumn[]
  tasks: BoardTask[]
  labels: Label[]
  dependencies: Dependency[]
  selectedTaskId: string | null
  isDirty: boolean

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

  setLabels: (labels: Label[]) => void
  addLabel: (label: Label) => void
  removeLabel: (id: string) => void

  setDependencies: (deps: Dependency[]) => void
  addDependency: (dep: Dependency) => void
  removeDependency: (blockerTaskId: string, blockedTaskId: string) => void

  selectTask: (id: string | null) => void
  convertToTimeline: (taskId: string, startDate: string, endDate: string) => void
  markClean: () => void
}

export const useBoardStore = create<BoardState>()(
  persist(
    (set) => ({
      columns: [],
      tasks: [],
      labels: [],
      dependencies: [],
      selectedTaskId: null,
      isDirty: false,

      setColumns: (columns) => set({ columns }),
      addColumn: (column) => set((s) => ({ columns: [...s.columns, column] })),
      updateColumn: (id, updates) => set((s) => ({
        columns: s.columns.map((c) => c.id === id ? { ...c, ...updates } : c),
      })),
      removeColumn: (id) => set((s) => ({
        columns: s.columns.filter((c) => c.id !== id),
      })),
      reorderColumns: (updates) => set((s) => {
        const map = new Map(updates.map((u) => [u.id, u.orderIndex]))
        return {
          columns: s.columns
            .map((c) => map.has(c.id) ? { ...c, orderIndex: map.get(c.id)! } : c)
            .sort((a, b) => a.orderIndex - b.orderIndex),
        }
      }),

      setTasks: (tasks) => set({ tasks, isDirty: false }),
      addTask: (task) => set((s) => ({ tasks: [...s.tasks, task], isDirty: true })),
      updateTask: (id, updates) => set((s) => ({
        tasks: s.tasks.map((t) => t.id === id ? { ...t, ...updates } : t),
        isDirty: true,
      })),
      removeTask: (id) => set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
        isDirty: true,
      })),
      moveTask: (id, columnId, orderIndex) => set((s) => ({
        tasks: s.tasks.map((t) => t.id === id ? { ...t, columnId, orderIndex } : t),
        isDirty: true,
      })),

      setLabels: (labels) => set({ labels }),
      addLabel: (label) => set((s) => ({ labels: [...s.labels, label], isDirty: true })),
      removeLabel: (id) => set((s) => ({
        labels: s.labels.filter((l) => l.id !== id),
        isDirty: true,
      })),

      setDependencies: (dependencies) => set({ dependencies }),
      addDependency: (dep) => set((s) => ({
        dependencies: [...s.dependencies, dep],
        isDirty: true,
      })),
      removeDependency: (blockerTaskId, blockedTaskId) => set((s) => ({
        dependencies: s.dependencies.filter(
          (d) => !(d.blockerTaskId === blockerTaskId && d.blockedTaskId === blockedTaskId)
        ),
        isDirty: true,
      })),

      selectTask: (id) => set({ selectedTaskId: id }),
      convertToTimeline: (taskId, startDate, endDate) => set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? { ...t, startDate, endDate, onTimeline: true }
            : t
        ),
        isDirty: true,
      })),
      markClean: () => set({ isDirty: false }),
    }),
    {
      name: 'aeon-board',
      partialize: (s) => ({ tasks: s.tasks, labels: s.labels, dependencies: s.dependencies, columns: s.columns }),
    }
  )
)
