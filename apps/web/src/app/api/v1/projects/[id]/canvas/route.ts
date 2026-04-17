import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectAccess } from '@/lib/data/projects'
import { findCanvasNodes, findCanvasEdges, createCanvasNode, createCanvasEdge } from '@/lib/data/canvas'
import { z } from 'zod'

type Params = { params: Promise<{ id: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    if (!await verifyProjectAccess(id, result.id)) return jsonError('Project not found', 404)

    const [nodes, edges] = await Promise.all([findCanvasNodes(id), findCanvasEdges(id)])
    return jsonData({ nodes, edges })
  }),
  API_READ_LIMIT
)

const batchSchema = z.object({
  nodes: z.array(z.object({
    type: z.string().max(50).default('process'),
    name: z.string().min(1).max(255),
    description: z.string().max(10000).optional(),
    color: z.string().max(20).default('purple'),
    positionX: z.number().int().optional(),
    positionY: z.number().int().optional(),
  })).max(50),
  edges: z.array(z.object({
    sourceIndex: z.number().int().min(0),
    targetIndex: z.number().int().min(0),
    label: z.string().max(255).optional(),
    animated: z.boolean().optional(),
  })).max(100).optional(),
  layout: z.enum(['TB', 'LR', 'BT', 'RL']).default('TB'),
})

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const access = await verifyProjectAccess(id, result.id)
    if (!access) return jsonError('Project not found', 404)
    if (access.role === 'viewer') return jsonError('Viewers cannot modify this project', 403)

    let body: unknown
    try { body = await request.json() } catch { return jsonError('Invalid JSON body', 400) }

    const parsed = batchSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const { autoLayout: runLayout } = await import('@/components/canvas/autoLayout')

    const layoutNodes = parsed.data.nodes.map((n, i) => ({ id: `temp-${i}`, type: n.type }))
    const layoutEdges = (parsed.data.edges || []).map((e) => ({
      source: `temp-${e.sourceIndex}`,
      target: `temp-${e.targetIndex}`,
    }))
    const layoutResult = runLayout(layoutNodes, layoutEdges, parsed.data.layout)

    const createdNodes = []
    for (let i = 0; i < parsed.data.nodes.length; i++) {
      const n = parsed.data.nodes[i]
      const pos = layoutResult.nodes.get(`temp-${i}`)
      const node = await createCanvasNode(id, {
        type: n.type,
        name: n.name,
        description: n.description,
        color: n.color,
        positionX: n.positionX ?? pos?.x ?? i * 300,
        positionY: n.positionY ?? pos?.y ?? 0,
      })
      createdNodes.push(node)
    }

    const createdEdges = []
    if (parsed.data.edges) {
      for (const e of parsed.data.edges) {
        if (e.sourceIndex >= createdNodes.length || e.targetIndex >= createdNodes.length) continue
        const edge = await createCanvasEdge(id, {
          sourceNodeId: createdNodes[e.sourceIndex].id,
          targetNodeId: createdNodes[e.targetIndex].id,
          label: e.label,
          animated: e.animated,
        })
        createdEdges.push(edge)
      }
    }

    return jsonData({ nodes: createdNodes, edges: createdEdges }, 201)
  }),
  API_WRITE_LIMIT
)
