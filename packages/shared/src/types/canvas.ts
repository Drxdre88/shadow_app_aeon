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
