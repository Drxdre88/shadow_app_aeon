'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  findCanvasNodes as _findNodes,
  findCanvasEdges as _findEdges,
  createCanvasNode as _createNode,
  updateCanvasNode as _updateNode,
  deleteCanvasNode as _deleteNode,
  createCanvasEdge as _createEdge,
  deleteCanvasEdge as _deleteEdge,
} from '@/lib/data/canvas'
import { createCanvasNodeSchema, updateCanvasNodeSchema, createCanvasEdgeSchema } from '@/lib/data/validators'

export async function getCanvasNodes(projectId: string) {
  await requireOwnership(projectId)
  return _findNodes(projectId)
}

export async function getCanvasEdges(projectId: string) {
  await requireOwnership(projectId)
  return _findEdges(projectId)
}

export async function createCanvasNode(data: {
  id: string
  projectId: string
  type?: string
  positionX: number
  positionY: number
  name: string
  description?: string
  color: string
}) {
  await requireOwnership(data.projectId)

  const parsed = createCanvasNodeSchema.parse({
    type: data.type ?? 'idea',
    positionX: data.positionX,
    positionY: data.positionY,
    name: data.name,
    description: data.description,
    color: data.color,
  })

  const node = await _createNode(data.projectId, parsed, data.id)

  revalidatePath(`/project/${data.projectId}`)
  return node
}

export async function updateCanvasNode(
  nodeId: string,
  projectId: string,
  data: {
    type?: string
    positionX?: number
    positionY?: number
    name?: string
    description?: string | null
    color?: string
  }
) {
  await requireOwnership(projectId)
  const parsed = updateCanvasNodeSchema.parse(data)
  const node = await _updateNode(nodeId, projectId, parsed)
  revalidatePath(`/project/${projectId}`)
  return node
}

export async function deleteCanvasNode(nodeId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteNode(nodeId, projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function createCanvasEdge(data: {
  id: string
  projectId: string
  sourceNodeId: string
  targetNodeId: string
  label?: string
  animated?: boolean
}) {
  await requireOwnership(data.projectId)

  const parsed = createCanvasEdgeSchema.parse({
    sourceNodeId: data.sourceNodeId,
    targetNodeId: data.targetNodeId,
    label: data.label,
    animated: data.animated,
  })

  const edge = await _createEdge(data.projectId, parsed, data.id)

  revalidatePath(`/project/${data.projectId}`)
  return edge
}

export async function deleteCanvasEdge(edgeId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteEdge(edgeId, projectId)
  revalidatePath(`/project/${projectId}`)
}
