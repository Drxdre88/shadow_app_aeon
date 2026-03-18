import { db } from '@/lib/db'
import { canvasNodes, canvasEdges } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { CreateCanvasNodeInput, UpdateCanvasNodeInput } from './validators'

export async function findCanvasNodes(projectId: string) {
  return db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.projectId, projectId))
}

export async function findCanvasEdges(projectId: string) {
  return db
    .select()
    .from(canvasEdges)
    .where(eq(canvasEdges.projectId, projectId))
}

export async function createCanvasNode(
  projectId: string,
  data: CreateCanvasNodeInput,
  clientId?: string
) {
  const [node] = await db
    .insert(canvasNodes)
    .values({
      ...(clientId ? { id: clientId } : {}),
      projectId,
      type: data.type,
      positionX: data.positionX,
      positionY: data.positionY,
      name: data.name,
      description: data.description || null,
      color: data.color,
    })
    .returning()

  return node
}

export async function updateCanvasNode(
  nodeId: string,
  projectId: string,
  data: UpdateCanvasNodeInput
) {
  const updates: Partial<typeof canvasNodes.$inferInsert> = { updatedAt: new Date() }
  if (data.type !== undefined) updates.type = data.type
  if (data.positionX !== undefined) updates.positionX = data.positionX
  if (data.positionY !== undefined) updates.positionY = data.positionY
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description ?? null
  if (data.color !== undefined) updates.color = data.color

  const [node] = await db
    .update(canvasNodes)
    .set(updates)
    .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.projectId, projectId)))
    .returning()

  return node || null
}

export async function deleteCanvasNode(nodeId: string, projectId: string) {
  const [deleted] = await db
    .delete(canvasNodes)
    .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.projectId, projectId)))
    .returning({ id: canvasNodes.id })

  return !!deleted
}

export async function createCanvasEdge(
  projectId: string,
  data: { sourceNodeId: string; targetNodeId: string; label?: string; animated?: boolean },
  clientId?: string
) {
  const [edge] = await db
    .insert(canvasEdges)
    .values({
      ...(clientId ? { id: clientId } : {}),
      projectId,
      sourceNodeId: data.sourceNodeId,
      targetNodeId: data.targetNodeId,
      label: data.label || null,
      animated: data.animated ?? false,
    })
    .returning()

  return edge
}

export async function deleteCanvasEdge(edgeId: string, projectId: string) {
  const [deleted] = await db
    .delete(canvasEdges)
    .where(and(eq(canvasEdges.id, edgeId), eq(canvasEdges.projectId, projectId)))
    .returning({ id: canvasEdges.id })

  return !!deleted
}
