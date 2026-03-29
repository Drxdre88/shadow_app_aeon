import dagre from 'dagre'

interface LayoutNode {
  id: string
  width?: number
  height?: number
}

interface LayoutEdge {
  source: string
  target: string
}

interface LayoutResult {
  nodes: Map<string, { x: number; y: number }>
}

const NODE_WIDTH = 240
const NODE_HEIGHT = 100
const DECISION_WIDTH = 180
const TERMINAL_HEIGHT = 60

function getNodeDimensions(nodeType?: string) {
  if (nodeType === 'decision') return { width: DECISION_WIDTH, height: NODE_HEIGHT }
  if (nodeType === 'start' || nodeType === 'end') return { width: 140, height: TERMINAL_HEIGHT }
  return { width: NODE_WIDTH, height: NODE_HEIGHT }
}

export function autoLayout(
  nodes: (LayoutNode & { type?: string })[],
  edges: LayoutEdge[],
  direction: 'TB' | 'LR' | 'BT' | 'RL' = 'TB'
): LayoutResult {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
    edgesep: 30,
    marginx: 40,
    marginy: 40,
  })

  for (const node of nodes) {
    const dims = getNodeDimensions(node.type)
    g.setNode(node.id, { width: node.width || dims.width, height: node.height || dims.height })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const result = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const layoutNode = g.node(node.id)
    if (layoutNode) {
      const dims = getNodeDimensions(node.type)
      result.set(node.id, {
        x: Math.round(layoutNode.x - (dims.width / 2)),
        y: Math.round(layoutNode.y - (dims.height / 2)),
      })
    }
  }

  return { nodes: result }
}
