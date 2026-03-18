import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CanvasNodeData {
  id: string
  projectId: string
  type: string
  positionX: number
  positionY: number
  name: string
  description?: string
  color: string
}

export interface CanvasEdgeData {
  id: string
  projectId: string
  sourceNodeId: string
  targetNodeId: string
  label?: string
  animated: boolean
}

interface CanvasState {
  nodes: CanvasNodeData[]
  edges: CanvasEdgeData[]
  selectedNodeId: string | null
  isDirty: boolean

  setNodes: (nodes: CanvasNodeData[]) => void
  addNode: (node: CanvasNodeData) => void
  updateNode: (id: string, updates: Partial<CanvasNodeData>) => void
  removeNode: (id: string) => void

  setEdges: (edges: CanvasEdgeData[]) => void
  addEdge: (edge: CanvasEdgeData) => void
  removeEdge: (id: string) => void

  selectNode: (id: string | null) => void
  markClean: () => void
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set) => ({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isDirty: false,

      setNodes: (nodes) => set({ nodes, isDirty: false }),
      addNode: (node) => set((s) => ({ nodes: [...s.nodes, node], isDirty: true })),
      updateNode: (id, updates) => set((s) => ({
        nodes: s.nodes.map((n) => n.id === id ? { ...n, ...updates } : n),
        isDirty: true,
      })),
      removeNode: (id) => set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.sourceNodeId !== id && e.targetNodeId !== id),
        isDirty: true,
      })),

      setEdges: (edges) => set({ edges, isDirty: false }),
      addEdge: (edge) => set((s) => ({ edges: [...s.edges, edge], isDirty: true })),
      removeEdge: (id) => set((s) => ({
        edges: s.edges.filter((e) => e.id !== id),
        isDirty: true,
      })),

      selectNode: (id) => set({ selectedNodeId: id }),
      markClean: () => set({ isDirty: false }),
    }),
    {
      name: 'aeon-canvas',
      partialize: (s) => ({ nodes: s.nodes, edges: s.edges }),
    }
  )
)
