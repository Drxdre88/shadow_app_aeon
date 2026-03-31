'use client'

import { useMemo, useEffect, useCallback, useState, useRef, type WheelEvent as ReactWheelEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { resolveColor } from '@/lib/utils/colors'
import { calculateTreeLayout } from './dependency-tree/TreeLayout'
import { GlowTreeNode } from './dependency-tree/GlowTreeNode'
import { GlowTreeEdge } from './dependency-tree/GlowTreeEdge'

interface DependencyGlowTreeProps {
  taskId: string | null
  showAll?: boolean
  onClose: () => void
  onTaskEdit?: (taskId: string) => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
}

const NODE_WIDTH = 260
const NODE_HEIGHT = 110
const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.0
const MAX_FIT_ZOOM = 0.85
const DOT_SPACING = 30
const CLUSTER_GAP = 240

export function DependencyGlowTree({ taskId, showAll, onClose, onTaskEdit, onTaskUpdate }: DependencyGlowTreeProps) {
  const tasks = useBoardStore((s) => s.tasks)
  const updateTask = useBoardStore((s) => s.updateTask)
  const dependencies = useBoardStore((s) => s.dependencies)
  const { colors: themeColors, glowIntensity: globalGlow, depCanvasBlur, depViewMode, depLineWidth, depLineGlow, depLineStyle } = useThemeStore()
  const [focusId, setFocusId] = useState(taskId)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const hasAutoFit = useRef(false)

  const focusedTask = focusId ? tasks.find((t) => t.id === focusId) : null

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const { allChains } = useMemo(() => {
    if (showAll) {
      const taskIds = new Set(dependencies.flatMap((d) => [d.blockerTaskId, d.blockedTaskId]))
      const visited = new Set<string>()
      const chains: { nodeIds: string[]; edges: { sourceId: string; targetId: string }[] }[] = []

      const walkChain = (startId: string) => {
        const chainNodes = new Set<string>()
        const chainEdges: { sourceId: string; targetId: string }[] = []
        const queue = [startId]

        while (queue.length > 0) {
          const id = queue.pop()!
          if (chainNodes.has(id)) continue
          chainNodes.add(id)
          visited.add(id)

          for (const dep of dependencies) {
            if (dep.blockedTaskId === id) {
              chainEdges.push({ sourceId: dep.blockerTaskId, targetId: dep.blockedTaskId })
              if (!chainNodes.has(dep.blockerTaskId)) queue.push(dep.blockerTaskId)
            }
            if (dep.blockerTaskId === id) {
              chainEdges.push({ sourceId: dep.blockerTaskId, targetId: dep.blockedTaskId })
              if (!chainNodes.has(dep.blockedTaskId)) queue.push(dep.blockedTaskId)
            }
          }
        }

        if (chainNodes.size > 0) {
          const seen = new Set<string>()
          const uniqueEdges = chainEdges.filter((e) => {
            const key = `${e.sourceId}-${e.targetId}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          chains.push({ nodeIds: Array.from(chainNodes), edges: uniqueEdges })
        }
      }

      for (const id of taskIds) {
        if (!visited.has(id)) walkChain(id)
      }

      const meaningfulChains = chains.filter(c => c.edges.length > 0)
      return { allChains: meaningfulChains.length > 0 ? meaningfulChains : chains }
    }

    const visited = new Set<string>()
    const edges: { sourceId: string; targetId: string }[] = []
    const fId = focusId || taskId

    const walkUp = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      for (const dep of dependencies) {
        if (dep.blockedTaskId === id) {
          edges.push({ sourceId: dep.blockerTaskId, targetId: dep.blockedTaskId })
          walkUp(dep.blockerTaskId)
        }
      }
    }

    const walkDown = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      for (const dep of dependencies) {
        if (dep.blockerTaskId === id) {
          edges.push({ sourceId: dep.blockerTaskId, targetId: dep.blockedTaskId })
          walkDown(dep.blockedTaskId)
        }
      }
    }

    if (fId) {
      walkUp(fId)
      walkDown(fId)
      if (!visited.has(fId)) visited.add(fId)
    }

    return { allChains: [{ nodeIds: Array.from(visited), edges }] }
  }, [focusId, taskId, dependencies, showAll])

  const { mergedNodes, mergedEdges, totalWidth, totalHeight, clusterInfo } = useMemo(() => {
    const allNodes: (ReturnType<typeof calculateTreeLayout>['nodes'][0] & { clusterId: number })[] = []
    const allEdges: ReturnType<typeof calculateTreeLayout>['edges'] = []
    const clusterInfo: { startY: number; endY: number }[] = []
    let yOffset = 0

    for (let i = 0; i < allChains.length; i++) {
      const chain = allChains[i]
      const layout = calculateTreeLayout(chain.nodeIds, chain.edges, {
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
      })

      for (const node of layout.nodes) {
        allNodes.push({ ...node, y: node.y + yOffset, clusterId: i })
      }
      for (const edge of layout.edges) {
        allEdges.push({
          ...edge,
          sourceY: edge.sourceY + yOffset,
          targetY: edge.targetY + yOffset,
        })
      }

      clusterInfo.push({ startY: yOffset, endY: yOffset + layout.height })
      yOffset += layout.height + CLUSTER_GAP
    }

    const maxX = allNodes.length > 0 ? Math.max(...allNodes.map((n) => n.x + NODE_WIDTH)) : 400
    const maxY = allNodes.length > 0 ? Math.max(...allNodes.map((n) => n.y + NODE_HEIGHT)) : 200

    return { mergedNodes: allNodes, mergedEdges: allEdges, totalWidth: maxX, totalHeight: maxY, clusterInfo }
  }, [allChains])

  const taskMap = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks]
  )

  const autoFit = useCallback(() => {
    if (!containerRef.current || mergedNodes.length === 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const padX = 160
    const padY = 160
    const scaleX = (rect.width - padX) / totalWidth
    const scaleY = (rect.height - padY) / totalHeight
    const fitZoom = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_ZOOM), MAX_FIT_ZOOM)
    const centerX = (rect.width - totalWidth * fitZoom) / 2
    const centerY = (rect.height - totalHeight * fitZoom) / 2
    setZoom(fitZoom)
    setPan({ x: centerX, y: centerY })
  }, [totalWidth, totalHeight, mergedNodes.length])

  useEffect(() => {
    hasAutoFit.current = false
  }, [taskId, showAll])

  useEffect(() => {
    if (hasAutoFit.current) return
    hasAutoFit.current = true
    requestAnimationFrame(autoFit)
  }, [autoFit])

  const handleWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top

    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.min(Math.max(zoom * delta, MIN_ZOOM), MAX_ZOOM)
    const scale = newZoom / zoom

    setPan({
      x: cursorX - (cursorX - pan.x) * scale,
      y: cursorY - (cursorY - pan.y) * scale,
    })
    setZoom(newZoom)
  }, [zoom, pan])

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return
    setIsPanning(true)
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: ReactMouseEvent) => {
    if (!isPanning) return
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    })
  }, [isPanning])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const handleNodeClick = useCallback((nodeId: string) => {
    onTaskEdit?.(nodeId)
  }, [onTaskEdit])

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    setFocusId(nodeId)
    hasAutoFit.current = false
  }, [])

  const handleStatusChange = useCallback((nodeId: string, newStatus: string) => {
    updateTask(nodeId, { status: newStatus })
    onTaskUpdate?.(nodeId, { status: newStatus })
  }, [updateTask, onTaskUpdate])

  const glowMult = globalGlow / 75
  const glowHex = themeColors.glowColor
  const bgOp1 = Math.min(255, Math.round(6 * glowMult)).toString(16).padStart(2, '0')
  const bgOp2 = Math.min(255, Math.round(12 * glowMult)).toString(16).padStart(2, '0')

  const headerText = showAll ? 'All Dependency Chains' : 'Dependency Chain'
  const subtitleText = showAll
    ? `${allChains.length} chain${allChains.length !== 1 ? 's' : ''} / ${mergedNodes.length} tasks`
    : focusedTask?.name || ''
  const zoomPercent = Math.round(zoom * 100)

  const hasContent = mergedNodes.length > 1 || (showAll && mergedNodes.length > 0)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex flex-col"
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: globalGlow > 0
              ? `linear-gradient(135deg, #050508 0%, ${glowHex}${bgOp1} 30%, #050508 50%, ${glowHex}${bgOp2} 70%, #050508 100%)`
              : '#050508',
            backdropFilter: depCanvasBlur > 0 ? `blur(${depCanvasBlur}px)` : undefined,
            WebkitBackdropFilter: depCanvasBlur > 0 ? `blur(${depCanvasBlur}px)` : undefined,
          }}
        />

        <div className="absolute inset-3 rounded-2xl border border-white/[0.08] overflow-hidden"
          style={{
            boxShadow: globalGlow > 0
              ? `inset 0 0 80px ${glowHex}${bgOp1}, 0 0 40px rgba(0,0,0,0.5)`
              : '0 0 40px rgba(0,0,0,0.5)',
          }}
        >
          <div
            ref={containerRef}
            className="relative w-full h-full overflow-hidden"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.08 }}>
              <pattern
                id="canvas-dots"
                x={pan.x % (DOT_SPACING * zoom)}
                y={pan.y % (DOT_SPACING * zoom)}
                width={DOT_SPACING * zoom}
                height={DOT_SPACING * zoom}
                patternUnits="userSpaceOnUse"
              >
                <circle cx={1} cy={1} r={0.8} fill="rgba(255,255,255,0.6)" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#canvas-dots)" />
            </svg>

            {!hasContent ? (
              <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm z-10">
                No dependencies to visualize
              </div>
            ) : (
              <div
                className="absolute origin-top-left"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  willChange: 'transform',
                  width: totalWidth,
                  height: totalHeight,
                }}
              >
                <svg
                  className="pointer-events-none"
                  width={totalWidth}
                  height={totalHeight}
                  viewBox={`0 0 ${totalWidth} ${totalHeight}`}
                  style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
                >
                  {mergedEdges.map((edge, i) => {
                    const sourceTask = taskMap.get(edge.sourceId)
                    const targetTask = taskMap.get(edge.targetId)
                    const isResolved = sourceTask?.status === 'done'
                    return (
                      <GlowTreeEdge
                        key={`${edge.sourceId}-${edge.targetId}`}
                        sourceX={edge.sourceX}
                        sourceY={edge.sourceY}
                        targetX={edge.targetX}
                        targetY={edge.targetY}
                        index={i}
                        isResolved={isResolved}
                        edgeMode={depViewMode}
                        sourceColor={resolveColor(sourceTask?.color ?? 'purple').hex}
                        targetColor={resolveColor(targetTask?.color ?? 'purple').hex}
                        lineWidth={depLineWidth}
                        lineGlow={depLineGlow}
                        lineStyle={depLineStyle}
                      />
                    )
                  })}
                </svg>

                {showAll && clusterInfo.length > 1 && clusterInfo.slice(0, -1).map((cluster, i) => {
                  const separatorY = cluster.endY + CLUSTER_GAP / 2
                  return (
                    <div
                      key={`sep-${i}`}
                      className="absolute pointer-events-none"
                      style={{ top: separatorY, left: 0, width: totalWidth, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }}
                    />
                  )
                })}

                <div className="absolute" style={{ top: 0, left: 0 }}>
                  {mergedNodes.map((node) => {
                    const task = taskMap.get(node.id)
                    if (!task) return null
                    return (
                      <GlowTreeNode
                        key={node.id}
                        id={node.id}
                        x={node.x}
                        y={node.y}
                        width={NODE_WIDTH}
                        height={NODE_HEIGHT}
                        name={task.name}
                        status={task.status}
                        priority={task.priority}
                        color={task.color}
                        isFocused={node.id === focusId}
                        isRoot={node.level === 0}
                        level={node.level}
                        indexInLevel={node.indexInLevel}
                        onNodeClick={handleNodeClick}
                        onNodeDoubleClick={handleNodeDoubleClick}
                        onStatusChange={handleStatusChange}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            <div className="absolute top-4 left-4 z-20">
              <div className={cn(
                'px-4 py-2.5 rounded-xl',
                'bg-black/70 backdrop-blur-xl border border-white/[0.08]',
              )}>
                <h2 className="text-sm font-semibold text-white">{headerText}</h2>
                <p className="text-xs text-slate-400 mt-0.5 max-w-[280px] truncate">{subtitleText}</p>
              </div>
            </div>

            <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
              <span className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400',
                'bg-black/70 backdrop-blur-xl border border-white/[0.08]',
              )}>
                {zoomPercent}%
              </span>
              <button
                onClick={autoFit}
                className={cn(
                  'p-2 rounded-lg',
                  'bg-black/70 backdrop-blur-xl border border-white/[0.08]',
                  'text-slate-400 hover:text-white transition-colors',
                )}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className={cn(
                  'p-2 rounded-lg',
                  'bg-black/70 backdrop-blur-xl border border-white/[0.08]',
                  'text-slate-400 hover:text-white transition-colors',
                )}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
