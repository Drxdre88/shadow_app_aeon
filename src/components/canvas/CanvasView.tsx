'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
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
import { Wand2, Download, Diamond, Square, Play, StopCircle, Database, Layers } from 'lucide-react'
import { useCanvasStore, type CanvasNodeData, type CanvasEdgeData } from '@/lib/store/canvasStore'
import { IdeaNode, type IdeaNodeData } from './IdeaNode'
import { ProcessNode, type FlowNodeData } from './nodes/ProcessNode'
import { generateId, colorConfig, type AccentColor } from '@/lib/utils/colors'
import { autoLayout } from './autoLayout'
import { exportCanvasPng, exportCanvasSvg } from './canvasExport'
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
    label?: string
  }) => void
  onEdgeDelete: (edgeId: string) => void
}

const NODE_TYPES = {
  idea: IdeaNode,
  process: ProcessNode,
  decision: ProcessNode,
  start: ProcessNode,
  end: ProcessNode,
  data: ProcessNode,
  group: ProcessNode,
}

const TOOLBAR_ITEMS = [
  { type: 'idea', label: 'Idea', icon: Square, color: 'purple' },
  { type: 'process', label: 'Process', icon: Square, color: 'blue' },
  { type: 'decision', label: 'Decision', icon: Diamond, color: 'orange' },
  { type: 'start', label: 'Start', icon: Play, color: 'green' },
  { type: 'end', label: 'End', icon: StopCircle, color: 'red' },
  { type: 'data', label: 'Data', icon: Database, color: 'cyan' },
  { type: 'group', label: 'Group', icon: Layers, color: 'pink' },
]

function toFlowNodes(
  storeNodes: CanvasNodeData[],
  onUpdate: (id: string, updates: { name?: string; description?: string; color?: string }) => void,
  onDelete: (id: string) => void
): Node[] {
  return storeNodes.map((n) => {
    const nodeType = n.type || 'idea'
    const isLegacy = nodeType === 'idea'
    return {
      id: n.id,
      type: isLegacy ? 'idea' : nodeType,
      position: { x: n.positionX, y: n.positionY },
      data: isLegacy
        ? { name: n.name, description: n.description, color: n.color, onUpdate, onDelete } satisfies IdeaNodeData
        : { name: n.name, description: n.description, color: n.color, nodeType, onUpdate, onDelete } satisfies FlowNodeData,
    }
  })
}

function toFlowEdges(storeEdges: CanvasEdgeData[]): Edge[] {
  return storeEdges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    label: e.label,
    animated: e.animated,
    type: 'smoothstep',
    style: { stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 2 },
    labelStyle: { fill: '#94a3b8', fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: 'rgba(10, 10, 20, 0.8)', rx: 4, ry: 4 },
    labelBgPadding: [6, 3] as [number, number],
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
  const flowRef = useRef<HTMLDivElement>(null)
  const {
    nodes: storeNodes,
    edges: storeEdges,
    updateNode: updateStoreNode,
    removeNode: removeStoreNode,
    addNode: addStoreNode,
    addEdge: addStoreEdge,
    removeEdge: removeStoreEdge,
    setNodes: setStoreNodes,
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

  useEffect(() => {
    setNodes(toFlowNodes(storeNodes, handleNodeUpdate, handleNodeDelete))
  }, [storeNodes, handleNodeUpdate, handleNodeDelete, setNodes])

  useEffect(() => {
    setEdges(toFlowEdges(storeEdges))
  }, [storeEdges, setEdges])

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
      type: 'smoothstep',
      style: { stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 2 },
    }
    setEdges((eds) => addEdge(newEdge, eds))
    addStoreEdge({ id, projectId, sourceNodeId: connection.source, targetNodeId: connection.target, animated: false })
    onEdgeCreate({ id, projectId, sourceNodeId: connection.source, targetNodeId: connection.target })
  }, [projectId, setEdges, addStoreEdge, onEdgeCreate])

  const handleNodeDragStop: NodeMouseHandler = useCallback((_event, node) => {
    updateStoreNode(node.id, { positionX: Math.round(node.position.x), positionY: Math.round(node.position.y) })
    onNodeUpdate(node.id, { positionX: Math.round(node.position.x), positionY: Math.round(node.position.y) })
  }, [updateStoreNode, onNodeUpdate])

  const handleAddNode = useCallback((type: string, color: string) => {
    const id = generateId()
    const defaultNames: Record<string, string> = {
      idea: 'New Idea', process: 'Process', decision: 'Decision?',
      start: 'Start', end: 'End', data: 'Data Source', group: 'Group',
    }
    const centerX = 100 + Math.random() * 400
    const centerY = 100 + Math.random() * 300

    const nodeData: CanvasNodeData = {
      id, projectId, type, positionX: Math.round(centerX), positionY: Math.round(centerY),
      name: defaultNames[type] || 'New Node', color,
    }
    addStoreNode(nodeData)

    const isLegacy = type === 'idea'
    const flowNode: Node = {
      id, type: isLegacy ? 'idea' : type,
      position: { x: centerX, y: centerY },
      data: isLegacy
        ? { name: nodeData.name, color, onUpdate: handleNodeUpdate, onDelete: handleNodeDelete } satisfies IdeaNodeData
        : { name: nodeData.name, color, nodeType: type, onUpdate: handleNodeUpdate, onDelete: handleNodeDelete } satisfies FlowNodeData,
    }
    setNodes((nds) => [...nds, flowNode])
    onNodeCreate({ id, projectId, type, positionX: Math.round(centerX), positionY: Math.round(centerY), name: nodeData.name, color })
  }, [projectId, addStoreNode, setNodes, onNodeCreate, handleNodeUpdate, handleNodeDelete])

  const handleAutoLayout = useCallback(() => {
    const layoutNodes = storeNodes.map((n) => ({ id: n.id, type: n.type }))
    const layoutEdges = storeEdges.map((e) => ({ source: e.sourceNodeId, target: e.targetNodeId }))
    const result = autoLayout(layoutNodes, layoutEdges, 'TB')

    const updatedNodes = storeNodes.map((n) => {
      const pos = result.nodes.get(n.id)
      return pos ? { ...n, positionX: pos.x, positionY: pos.y } : n
    })
    setStoreNodes(updatedNodes)

    setNodes(toFlowNodes(updatedNodes, handleNodeUpdate, handleNodeDelete))

    for (const n of updatedNodes) {
      const pos = result.nodes.get(n.id)
      if (pos) onNodeUpdate(n.id, { positionX: pos.x, positionY: pos.y })
    }
  }, [storeNodes, storeEdges, setStoreNodes, setNodes, onNodeUpdate, handleNodeUpdate, handleNodeDelete])

  const handleExport = useCallback(async (format: 'png' | 'svg') => {
    const el = flowRef.current?.querySelector('.react-flow__viewport') as HTMLElement
    if (!el) return
    if (format === 'png') await exportCanvasPng(el, `canvas-${projectId}.png`)
    else await exportCanvasSvg(el, `canvas-${projectId}.svg`)
  }, [projectId])

  return (
    <div className="h-[calc(100vh-120px)] relative rounded-xl overflow-hidden border border-white/[0.06]" ref={flowRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={NODE_TYPES}
        fitView
        deleteKeyCode="Delete"
        className="canvas-flow"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          style: { stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 2 },
          type: 'smoothstep',
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(148, 163, 184, 0.15)" />
        <Controls className="canvas-controls" showInteractive={false} />
        <MiniMap
          className="canvas-minimap"
          nodeColor={(n) => {
            const d = n.data as unknown as (IdeaNodeData | FlowNodeData) | undefined
            if (!d?.color) return 'rgba(168, 85, 247, 0.5)'
            const cfg = colorConfig[d.color as AccentColor]
            return cfg ? cfg.hex : 'rgba(168, 85, 247, 0.5)'
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.06)' }}
        />
      </ReactFlow>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-lg">
        {TOOLBAR_ITEMS.map(({ type, label, icon: Icon, color }) => {
          const cfg = colorConfig[color as AccentColor]
          return (
            <button
              key={type}
              onClick={() => handleAddNode(type, color)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-white/10"
              style={{ color: cfg?.hex || '#a78bfa' }}
              title={label}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          )
        })}

        <div className="w-px h-5 bg-white/10 mx-1" />

        <button
          onClick={handleAutoLayout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-400 hover:bg-white/10 transition-all"
          title="Auto Layout"
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Layout</span>
        </button>

        <button
          onClick={() => handleExport('png')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-white/10 transition-all"
          title="Export PNG"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">PNG</span>
        </button>
      </div>
    </div>
  )
}
