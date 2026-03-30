import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore, type CanvasNodeData, type CanvasEdgeData } from '../canvasStore'

const makeNode = (overrides: Partial<CanvasNodeData> = {}): CanvasNodeData => ({
  id: 'node-1',
  projectId: 'proj-1',
  type: 'task',
  positionX: 100,
  positionY: 200,
  name: 'Node Alpha',
  color: '#ffffff',
  ...overrides,
})

const makeEdge = (overrides: Partial<CanvasEdgeData> = {}): CanvasEdgeData => ({
  id: 'edge-1',
  projectId: 'proj-1',
  sourceNodeId: 'node-1',
  targetNodeId: 'node-2',
  animated: false,
  ...overrides,
})

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    isDirty: false,
  })
})

describe('initial state', () => {
  it('has empty nodes array', () => {
    expect(useCanvasStore.getState().nodes).toEqual([])
  })

  it('has empty edges array', () => {
    expect(useCanvasStore.getState().edges).toEqual([])
  })

  it('has null selectedNodeId', () => {
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  it('is not dirty', () => {
    expect(useCanvasStore.getState().isDirty).toBe(false)
  })
})

describe('setNodes', () => {
  it('replaces the entire nodes array', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'node-old' }))
    const replacement = [makeNode({ id: 'node-new', name: 'New Node' })]

    useCanvasStore.getState().setNodes(replacement)

    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(useCanvasStore.getState().nodes[0].id).toBe('node-new')
  })

  it('marks state as clean', () => {
    useCanvasStore.getState().addNode(makeNode())
    expect(useCanvasStore.getState().isDirty).toBe(true)

    useCanvasStore.getState().setNodes([makeNode({ id: 'fresh' })])

    expect(useCanvasStore.getState().isDirty).toBe(false)
  })

  it('accepts an empty array, clearing all nodes', () => {
    useCanvasStore.getState().addNode(makeNode())
    useCanvasStore.getState().setNodes([])
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })
})

describe('addNode', () => {
  it('appends a node to the list', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1', name: 'First' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n2', name: 'Second' }))

    const { nodes } = useCanvasStore.getState()
    expect(nodes).toHaveLength(2)
    expect(nodes[1].name).toBe('Second')
  })

  it('marks state as dirty', () => {
    useCanvasStore.getState().addNode(makeNode())
    expect(useCanvasStore.getState().isDirty).toBe(true)
  })

  it('preserves all node fields', () => {
    const node = makeNode({ id: 'n-full', description: 'A description', color: '#aabbcc' })
    useCanvasStore.getState().addNode(node)
    expect(useCanvasStore.getState().nodes[0]).toEqual(node)
  })
})

describe('updateNode', () => {
  it('applies partial updates to the matching node', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1', name: 'Original' }))

    useCanvasStore.getState().updateNode('n1', { name: 'Updated', positionX: 999 })

    const node = useCanvasStore.getState().nodes[0]
    expect(node.name).toBe('Updated')
    expect(node.positionX).toBe(999)
  })

  it('does not affect other nodes', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1', name: 'First' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n2', name: 'Second' }))

    useCanvasStore.getState().updateNode('n1', { name: 'Changed' })

    expect(useCanvasStore.getState().nodes[1].name).toBe('Second')
  })

  it('marks state as dirty', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.setState({ isDirty: false })

    useCanvasStore.getState().updateNode('n1', { name: 'Dirtied' })

    expect(useCanvasStore.getState().isDirty).toBe(true)
  })

  it('is a no-op when id is not found', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1', name: 'Untouched' }))

    useCanvasStore.getState().updateNode('nonexistent', { name: 'Ghost' })

    expect(useCanvasStore.getState().nodes[0].name).toBe('Untouched')
  })
})

describe('removeNode', () => {
  it('removes the node with the matching id', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n2' }))

    useCanvasStore.getState().removeNode('n1')

    const { nodes } = useCanvasStore.getState()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('n2')
  })

  it('marks state as dirty', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.setState({ isDirty: false })

    useCanvasStore.getState().removeNode('n1')

    expect(useCanvasStore.getState().isDirty).toBe(true)
  })

  it('is a no-op when id does not exist', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.getState().removeNode('ghost')
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })
})

describe('removeNode edge cascade', () => {
  it('removes edges where removed node is the source', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n2' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }))

    useCanvasStore.getState().removeNode('n1')

    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('removes edges where removed node is the target', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n2' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }))

    useCanvasStore.getState().removeNode('n2')

    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('removes all edges referencing the node while preserving unrelated edges', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n2' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n3' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e-remove-src', sourceNodeId: 'n1', targetNodeId: 'n2' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e-remove-tgt', sourceNodeId: 'n3', targetNodeId: 'n1' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e-keep', sourceNodeId: 'n2', targetNodeId: 'n3' }))

    useCanvasStore.getState().removeNode('n1')

    const { edges } = useCanvasStore.getState()
    expect(edges).toHaveLength(1)
    expect(edges[0].id).toBe('e-keep')
  })

  it('does not affect edges when no edges reference the removed node', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n2' }))
    useCanvasStore.getState().addNode(makeNode({ id: 'n3' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e1', sourceNodeId: 'n2', targetNodeId: 'n3' }))

    useCanvasStore.getState().removeNode('n1')

    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })
})

describe('setEdges', () => {
  it('replaces the entire edges array', () => {
    useCanvasStore.getState().addEdge(makeEdge({ id: 'old-edge' }))
    const replacement = [makeEdge({ id: 'new-edge' })]

    useCanvasStore.getState().setEdges(replacement)

    expect(useCanvasStore.getState().edges).toHaveLength(1)
    expect(useCanvasStore.getState().edges[0].id).toBe('new-edge')
  })

  it('marks state as clean', () => {
    useCanvasStore.getState().addEdge(makeEdge())
    expect(useCanvasStore.getState().isDirty).toBe(true)

    useCanvasStore.getState().setEdges([makeEdge({ id: 'fresh-edge' })])

    expect(useCanvasStore.getState().isDirty).toBe(false)
  })

  it('accepts an empty array, clearing all edges', () => {
    useCanvasStore.getState().addEdge(makeEdge())
    useCanvasStore.getState().setEdges([])
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })
})

describe('addEdge', () => {
  it('appends an edge to the list', () => {
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e1' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e2' }))
    expect(useCanvasStore.getState().edges).toHaveLength(2)
    expect(useCanvasStore.getState().edges[1].id).toBe('e2')
  })

  it('marks state as dirty', () => {
    useCanvasStore.getState().addEdge(makeEdge())
    expect(useCanvasStore.getState().isDirty).toBe(true)
  })

  it('preserves all edge fields including optional label', () => {
    const edge = makeEdge({ id: 'labeled', label: 'depends on', animated: true })
    useCanvasStore.getState().addEdge(edge)
    expect(useCanvasStore.getState().edges[0]).toEqual(edge)
  })
})

describe('removeEdge', () => {
  it('removes the edge with the matching id', () => {
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e1' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e2' }))

    useCanvasStore.getState().removeEdge('e1')

    const { edges } = useCanvasStore.getState()
    expect(edges).toHaveLength(1)
    expect(edges[0].id).toBe('e2')
  })

  it('marks state as dirty', () => {
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e1' }))
    useCanvasStore.setState({ isDirty: false })

    useCanvasStore.getState().removeEdge('e1')

    expect(useCanvasStore.getState().isDirty).toBe(true)
  })

  it('is a no-op when id does not exist', () => {
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e1' }))
    useCanvasStore.getState().removeEdge('ghost')
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })
})

describe('selectNode', () => {
  it('sets selectedNodeId to the given id', () => {
    useCanvasStore.getState().selectNode('n1')
    expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
  })

  it('overwrites a previously selected node', () => {
    useCanvasStore.getState().selectNode('n1')
    useCanvasStore.getState().selectNode('n2')
    expect(useCanvasStore.getState().selectedNodeId).toBe('n2')
  })

  it('accepts null to deselect', () => {
    useCanvasStore.getState().selectNode('n1')
    useCanvasStore.getState().selectNode(null)
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  it('does not mutate isDirty', () => {
    useCanvasStore.setState({ isDirty: false })
    useCanvasStore.getState().selectNode('n1')
    expect(useCanvasStore.getState().isDirty).toBe(false)
  })
})

describe('markClean', () => {
  it('clears the dirty flag', () => {
    useCanvasStore.getState().addNode(makeNode())
    expect(useCanvasStore.getState().isDirty).toBe(true)

    useCanvasStore.getState().markClean()

    expect(useCanvasStore.getState().isDirty).toBe(false)
  })

  it('is safe to call when already clean', () => {
    useCanvasStore.getState().markClean()
    expect(useCanvasStore.getState().isDirty).toBe(false)
  })

  it('does not affect nodes or edges', () => {
    useCanvasStore.getState().addNode(makeNode({ id: 'n1' }))
    useCanvasStore.getState().addEdge(makeEdge({ id: 'e1' }))

    useCanvasStore.getState().markClean()

    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })
})
