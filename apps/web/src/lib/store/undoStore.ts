import { create } from 'zustand'

const MAX_STACK_SIZE = 20

export interface UndoEntry {
  id: string
  description: string
  undo: () => void
  timestamp: number
}

interface UndoState {
  stack: UndoEntry[]
  push: (description: string, undoFn: () => void) => string
  pop: () => UndoEntry | null
  remove: (id: string) => void
  popById: (id: string) => UndoEntry | null
  clear: () => void
}

export const useUndoStore = create<UndoState>()((set, get) => ({
  stack: [],

  push: (description, undoFn) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const entry: UndoEntry = { id, description, undo: undoFn, timestamp: Date.now() }
    set((s) => ({
      stack: [entry, ...s.stack].slice(0, MAX_STACK_SIZE),
    }))
    return id
  },

  pop: () => {
    const { stack } = get()
    if (stack.length === 0) return null
    const [top, ...rest] = stack
    set({ stack: rest })
    return top
  },

  remove: (id) => {
    set((s) => ({ stack: s.stack.filter((e) => e.id !== id) }))
  },

  popById: (id) => {
    const { stack } = get()
    const entry = stack.find((e) => e.id === id)
    if (!entry) return null
    set((s) => ({ stack: s.stack.filter((e) => e.id !== id) }))
    return entry
  },

  clear: () => set({ stack: [] }),
}))
