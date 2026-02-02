import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type TaskStatus = 'todo' | 'doing' | 'review' | 'done'
type Priority = 'low' | 'medium' | 'high' | 'urgent'

interface BoardTask {
  id: string
  projectId: string
  name: string
  description?: string
  status: TaskStatus
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

interface BoardState {
  tasks: BoardTask[]
  labels: Label[]
  selectedTaskId: string | null
  isDirty: boolean

  setTasks: (tasks: BoardTask[]) => void
  addTask: (task: BoardTask) => void
  updateTask: (id: string, updates: Partial<BoardTask>) => void
  removeTask: (id: string) => void
  moveTask: (id: string, status: TaskStatus, orderIndex: number) => void

  setLabels: (labels: Label[]) => void
  addLabel: (label: Label) => void
  removeLabel: (id: string) => void

  selectTask: (id: string | null) => void
  convertToTimeline: (taskId: string, startDate: string, endDate: string) => void
  markClean: () => void
}

export const useBoardStore = create<BoardState>()(
  persist(
    (set) => ({
      tasks: [],
      labels: [],
      selectedTaskId: null,
      isDirty: false,

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
      moveTask: (id, status, orderIndex) => set((s) => ({
        tasks: s.tasks.map((t) => t.id === id ? { ...t, status, orderIndex } : t),
        isDirty: true,
      })),

      setLabels: (labels) => set({ labels }),
      addLabel: (label) => set((s) => ({ labels: [...s.labels, label], isDirty: true })),
      removeLabel: (id) => set((s) => ({
        labels: s.labels.filter((l) => l.id !== id),
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
      partialize: (s) => ({ tasks: s.tasks, labels: s.labels }),
    }
  )
)
