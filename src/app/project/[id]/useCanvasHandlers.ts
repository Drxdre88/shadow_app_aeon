'use client'

import { useCallback } from 'react'
import { createCanvasNode, updateCanvasNode, deleteCanvasNode, createCanvasEdge, deleteCanvasEdge } from '@/lib/actions/canvas'

export function useCanvasHandlers(projectId: string) {
  const handleCanvasNodeCreate = useCallback((node: {
    id: string
    projectId: string
    type: string
    positionX: number
    positionY: number
    name: string
    color: string
  }) => {
    createCanvasNode(node).catch((err) => console.error('Failed to create canvas node:', err))
  }, [])

  const handleCanvasNodeUpdate = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    updateCanvasNode(nodeId, projectId, updates as {
      type?: string
      positionX?: number
      positionY?: number
      name?: string
      description?: string | null
      color?: string
    }).catch((err) => console.error('Failed to update canvas node:', err))
  }, [projectId])

  const handleCanvasNodeDelete = useCallback((nodeId: string) => {
    deleteCanvasNode(nodeId, projectId).catch((err) => console.error('Failed to delete canvas node:', err))
  }, [projectId])

  const handleCanvasEdgeCreate = useCallback((edge: {
    id: string
    projectId: string
    sourceNodeId: string
    targetNodeId: string
  }) => {
    createCanvasEdge(edge).catch((err) => console.error('Failed to create canvas edge:', err))
  }, [])

  const handleCanvasEdgeDelete = useCallback((edgeId: string) => {
    deleteCanvasEdge(edgeId, projectId).catch((err) => console.error('Failed to delete canvas edge:', err))
  }, [projectId])

  return {
    handleCanvasNodeCreate,
    handleCanvasNodeUpdate,
    handleCanvasNodeDelete,
    handleCanvasEdgeCreate,
    handleCanvasEdgeDelete,
  }
}
