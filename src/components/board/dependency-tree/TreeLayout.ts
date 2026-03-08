export interface TreeNode {
  id: string
  x: number
  y: number
  level: number
  indexInLevel: number
}

export interface TreeEdge {
  sourceId: string
  targetId: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

interface LayoutConfig {
  nodeWidth: number
  nodeHeight: number
  hSpacing: number
  vSpacing: number
}

const DEFAULT_CONFIG: LayoutConfig = {
  nodeWidth: 200,
  nodeHeight: 80,
  hSpacing: 60,
  vSpacing: 120,
}

export function calculateTreeLayout(
  nodeIds: string[],
  edges: { sourceId: string; targetId: string }[],
  config: Partial<LayoutConfig> = {}
): { nodes: TreeNode[]; edges: TreeEdge[]; width: number; height: number } {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  if (nodeIds.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adjacency.set(id, [])
  }

  for (const edge of edges) {
    adjacency.get(edge.sourceId)?.push(edge.targetId)
    inDegree.set(edge.targetId, (inDegree.get(edge.targetId) || 0) + 1)
  }

  const levels: string[][] = []
  const levelMap = new Map<string, number>()
  const queue = nodeIds.filter((id) => (inDegree.get(id) || 0) === 0)

  if (queue.length === 0 && nodeIds.length > 0) {
    queue.push(nodeIds[0])
  }

  while (queue.length > 0) {
    const currentLevel = [...queue]
    levels.push(currentLevel)
    const nextQueue: string[] = []

    for (const id of currentLevel) {
      levelMap.set(id, levels.length - 1)
      const neighbors = adjacency.get(id) || []
      for (const neighbor of neighbors) {
        const deg = (inDegree.get(neighbor) || 1) - 1
        inDegree.set(neighbor, deg)
        if (deg <= 0 && !levelMap.has(neighbor)) {
          nextQueue.push(neighbor)
        }
      }
    }

    queue.length = 0
    queue.push(...nextQueue)
  }

  for (const id of nodeIds) {
    if (!levelMap.has(id)) {
      const lastLevel = levels.length > 0 ? levels.length - 1 : 0
      if (!levels[lastLevel]) levels[lastLevel] = []
      levels[lastLevel].push(id)
      levelMap.set(id, lastLevel)
    }
  }

  const maxNodesInLevel = Math.max(...levels.map((l) => l.length), 1)
  const totalWidth = maxNodesInLevel * (cfg.nodeWidth + cfg.hSpacing) - cfg.hSpacing
  const totalHeight = levels.length * (cfg.nodeHeight + cfg.vSpacing) - cfg.vSpacing

  const positionedNodes: TreeNode[] = []
  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const level = levels[levelIdx]
    const levelWidth = level.length * (cfg.nodeWidth + cfg.hSpacing) - cfg.hSpacing
    const startX = (totalWidth - levelWidth) / 2

    for (let i = 0; i < level.length; i++) {
      positionedNodes.push({
        id: level[i],
        x: startX + i * (cfg.nodeWidth + cfg.hSpacing),
        y: levelIdx * (cfg.nodeHeight + cfg.vSpacing),
        level: levelIdx,
        indexInLevel: i,
      })
    }
  }

  const nodeMap = new Map(positionedNodes.map((n) => [n.id, n]))
  const positionedEdges: TreeEdge[] = edges
    .filter((e) => nodeMap.has(e.sourceId) && nodeMap.has(e.targetId))
    .map((e) => {
      const source = nodeMap.get(e.sourceId)!
      const target = nodeMap.get(e.targetId)!
      return {
        sourceId: e.sourceId,
        targetId: e.targetId,
        sourceX: source.x + cfg.nodeWidth / 2,
        sourceY: source.y + cfg.nodeHeight,
        targetX: target.x + cfg.nodeWidth / 2,
        targetY: target.y,
      }
    })

  return {
    nodes: positionedNodes,
    edges: positionedEdges,
    width: totalWidth + cfg.nodeWidth,
    height: totalHeight + cfg.nodeHeight,
  }
}
