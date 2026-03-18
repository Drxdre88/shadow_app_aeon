'use client'

import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
  type Node,
  type Edge,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './canvasStyles.css'
import { Plus } from 'lucide-react'
import { useCanvasStore, type CanvasNodeData, type CanvasEdgeData } from '@/lib/store/canvasStore'
import { IdeaNode, type IdeaNodeData } from './IdeaNode'
import { generateId, colorConfig, type AccentColor } from '@/lib/utils/colors'
import { cn } from '@/lib/utils/cn'

interface CanvasViewProps {
  projectId: string
  onNodeCreate: (node: {
    id: string
    projectId: string
    type: string
    positionX: number
    positionY: number
    name: string
    color: string
  }) => void
  onNodeUpdate: (nodeId: string, updates: Record<string, unknown>) => void
  onNodeDelete: (nodeId: string) => void
  onEdgeCreate: (edge: {
    id: string
    projectId: string
    sourceNodeId: string
    targetNodeId: string
  }) => void
  onEdgeDelete: (edgeId: string) => void
}

const nodeTypes = { idea: IdeaNode }

function toFlowNodes(
  storeNodes: CanvasNodeData[],
  onUpdate: (id: string, updates: { name?: string; description?: string; color?: string }) => void,
  onDelete: (id: string) => void
): Node[] {
  return storeNodes.map((n) => ({
    id: n.id,
    type: 'idea',
    position: { x: n.positionX, y: n.positionY },
    data: {
      name: n.name,
      description: n.description,
      color: n.color,
      onUpdate,
      onDelete,
    } satisfies IdeaNodeData,
  }))
}

function toFlowEdges(storeEdges: CanvasEdgeData[]): Edge[] {
  return storeEdges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    label: e.label,
    animated: e.animated,
    style: { stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 2 },
    labelStyle: { fill: '#94a3b8', fontSize: 11 },
  }))
}

export default function CanvasView({
  projectId,
  onNodeCreate,
  onNodeUpdate,
  onNodeDelete,
  onEdgeCreate,
  onEdgeDelete,
}: CanvasViewProps) {
  const {
    nodes: storeNodes,
    edges: storeEdges,
    updateNode: updateStoreNode,
    removeNode: removeStoreNode,
    addNode: addStoreNode,
    addEdge: addStoreEdge,
    removeEdge: removeStoreEdge,
  } = useCanvasStore()

  const handleNodeUpdate = useCallback((id: string, updates: { name?: string; description?: string; color?: string }) => {
    updateStoreNode(id, updates)
    onNodeUpdate(id, updates)
  }, [updateStoreNode, onNodeUpdate])

  const handleNodeDelete = useCallback((id: string) => {
    removeStoreNode(id)
    onNodeDelete(id)
  }, [removeStoreNode, onNodeDelete])

  const initialNodes = useMemo(
    () => toFlowNodes(storeNodes, handleNodeUpdate, handleNodeDelete),
    [storeNodes, handleNodeUpdate, handleNodeDelete]
  )
  const initialEdges = useMemo(() => toFlowEdges(storeEdges), [storeEdges])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    onNodesChange(changes)
  }, [onNodesChange])

  const handleEdgesChange: OnEdgesChange = useCallback((changes) => {
    onEdgesChange(changes)

    for (const change of changes) {
      if (change.type === 'remove') {
        removeStoreEdge(change.id)
        onEdgeDelete(change.id)
      }
    }
  }, [onEdgesChange, removeStoreEdge, onEdgeDelete])

  const handleConnect: OnConnect = useCallback((connection) => {
    if (!connection.source || !connection.target) return
    const id = generateId()
    const newEdge: Edge = {
      id,
      source: connection.source,
      target: connection.target,
      animated: false,
      style: { stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 2 },
    }
    setEdges((eds) => addEdge(newEdge, eds))
    addStoreEdge({
      id,
      projectId,
      sourceNodeId: connection.source,
      targetNodeId: connection.target,
      animated: false,
    })
    onEdgeCreate({
      id,
      projectId,
      sourceNodeId: connection.source,
      targetNodeId: connection.target,
    })
  }, [projectId, setEdges, addStoreEdge, onEdgeCreate])

  const handleNodeDragStop: NodeMouseHandler = useCallback((_event, node) => {
    updateStoreNode(node.id, {
      positionX: Math.round(node.position.x),
      positionY: Math.round(node.position.y),
    })
    onNodeUpdate(node.id, {
      positionX: Math.round(node.position.x),
      positionY: Math.round(node.position.y),
    })
  }, [updateStoreNode, onNodeUpdate])

  const handleAddNode = useCallback(() => {
    const id = generateId()
    const centerX = 100 + Math.random() * 400
    const centerY = 100 + Math.random() * 300

    const nodeData: CanvasNodeData = {
      id,
      projectId,
      type: 'idea',
      positionX: Math.round(centerX),
      positionY: Math.round(centerY),
      name: 'New Idea',
      color: 'purple',
    }

    addStoreNode(nodeData)

    const flowNode: Node = {
      id,
      type: 'idea',
      position: { x: centerX, y: centerY },
      data: {
        name: 'New Idea',
        color: 'purple',
        onUpdate: handleNodeUpdate,
        onDelete: handleNodeDelete,
      } satisfies IdeaNodeData,
    }
    setNodes((nds) => [...nds, flowNode])

    onNodeCreate({
      id,
      projectId,
      type: 'idea',
      positionX: Math.round(centerX),
      positionY: Math.round(centerY),
      name: 'New Idea',
      color: 'purple',
    })
  }, [projectId, addStoreNode, setNodes, onNodeCreate, handleNodeUpdate, handleNodeDelete])

  return (
    <div className="h-[calc(100vh-120px)] relative rounded-xl overflow-hidden border border-white/[0.06]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode="Delete"
        className="canvas-flow"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          style: { stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 2 },
          type: 'smoothstep',
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(148, 163, 184, 0.15)"
        />
        <Controls
          className="canvas-controls"
          showInteractive={false}
        />
        <MiniMap
          className="canvas-minimap"
          nodeColor={(n) => {
            const d = n.data as unknown as IdeaNodeData | undefined
            if (!d?.color) return 'rgba(168, 85, 247, 0.5)'
            const cfg = colorConfig[d.color as AccentColor]
            return cfg ? cfg.hex : 'rgba(168, 85, 247, 0.5)'
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '0.75rem',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        />
      </ReactFlow>

      <button
        onClick={handleAddNode}
        className={cn(
          'absolute bottom-6 right-6 z-10',
          'flex items-center gap-2 px-4 py-2.5 rounded-xl',
          'bg-purple-500/20 border border-purple-500/30 backdrop-blur-xl',
          'text-purple-400 text-sm font-medium',
          'hover:bg-purple-500/30 hover:border-purple-500/40 transition-all',
          'shadow-lg shadow-purple-500/10'
        )}
      >
        <Plus className="w-4 h-4" />
        Add Idea
      </button>
    </div>
  )
}
