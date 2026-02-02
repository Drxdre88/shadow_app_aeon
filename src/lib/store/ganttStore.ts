import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface GanttTask {
  id: string
  projectId: string
  rowId: string | null
  name: string
  description?: string
  startDate: string
  endDate: string
  color: string
  progress: number
  dependencies: string[]
}

interface Row {
  id: string
  projectId: string
  name: string
  color: string
  orderIndex: number
}

interface GanttState {
  tasks: GanttTask[]
  rows: Row[]
  selectedTaskId: string | null
  isDirty: boolean
  timeScale: 'day' | 'week' | 'month'

  setTasks: (tasks: GanttTask[]) => void
  addTask: (task: GanttTask) => void
  updateTask: (id: string, updates: Partial<GanttTask>) => void
  removeTask: (id: string) => void

  setRows: (rows: Row[]) => void
  addRow: (row: Row) => void
  updateRow: (id: string, updates: Partial<Row>) => void
  removeRow: (id: string) => void
  reorderRows: (projectId: string, fromIndex: number, toIndex: number) => void

  selectTask: (id: string | null) => void
  setTimeScale: (scale: 'day' | 'week' | 'month') => void
  markClean: () => void
}

export const useGanttStore = create<GanttState>()(
  persist(
    (set) => ({
      tasks: [],
      rows: [],
      selectedTaskId: null,
      isDirty: false,
      timeScale: 'week',

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

      setRows: (rows) => set({ rows }),
      addRow: (row) => set((s) => ({ rows: [...s.rows, row], isDirty: true })),
      updateRow: (id, updates) => set((s) => ({
        rows: s.rows.map((r) => r.id === id ? { ...r, ...updates } : r),
        isDirty: true,
      })),
      removeRow: (id) => set((s) => ({
        rows: s.rows.filter((r) => r.id !== id),
        isDirty: true,
      })),
      reorderRows: (projectId, fromIndex, toIndex) => set((s) => {
        const projectRows = s.rows
          .filter((r) => r.projectId === projectId)
          .sort((a, b) => a.orderIndex - b.orderIndex)
        const [moved] = projectRows.splice(fromIndex, 1)
        projectRows.splice(toIndex, 0, moved)
        const updatedRows = projectRows.map((r, i) => ({ ...r, orderIndex: i }))
        return {
          rows: s.rows.map((r) => {
            const updated = updatedRows.find((u) => u.id === r.id)
            return updated || r
          }),
          isDirty: true,
        }
      }),

      selectTask: (id) => set({ selectedTaskId: id }),
      setTimeScale: (scale) => set({ timeScale: scale }),
      markClean: () => set({ isDirty: false }),
    }),
    {
      name: 'aeon-gantt',
      partialize: (s) => ({ tasks: s.tasks, rows: s.rows, timeScale: s.timeScale }),
    }
  )
)
