'use client'

import { useMemo, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { calculateTreeLayout } from './dependency-tree/TreeLayout'
import { GlowTreeNode } from './dependency-tree/GlowTreeNode'
import { GlowTreeEdge } from './dependency-tree/GlowTreeEdge'

interface DependencyGlowTreeProps {
  taskId: string
  onClose: () => void
}

const NODE_WIDTH = 200
const NODE_HEIGHT = 80

export function DependencyGlowTree({ taskId, onClose }: DependencyGlowTreeProps) {
  const tasks = useBoardStore((s) => s.tasks)
  const dependencies = useBoardStore((s) => s.dependencies)

  const focusedTask = tasks.find((t) => t.id === taskId)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const { chainNodeIds, chainEdges } = useMemo(() => {
    const visited = new Set<string>()
    const edges: { sourceId: string; targetId: string }[] = []

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

    walkUp(taskId)
    walkDown(taskId)

    if (!visited.has(taskId)) visited.add(taskId)

    return { chainNodeIds: Array.from(visited), chainEdges: edges }
  }, [taskId, dependencies])

  const layout = useMemo(
    () => calculateTreeLayout(chainNodeIds, chainEdges, {
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
    }),
    [chainNodeIds, chainEdges]
  )

  const taskMap = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks]
  )

  if (!focusedTask) return null

  const containerWidth = Math.max(layout.width + 80, 400)
  const containerHeight = Math.max(layout.height + 80, 200)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'relative z-10 w-[90vw] max-w-4xl max-h-[80vh]',
            'rounded-2xl overflow-hidden',
            'bg-gradient-to-b from-white/8 to-black/40',
            'backdrop-blur-xl border border-white/10',
            'shadow-[0_0_60px_rgba(99,102,241,0.2)]',
            'flex flex-col'
          )}
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div>
              <h2 className="text-lg font-semibold text-white">Dependency Chain</h2>
              <p className="text-sm text-slate-400 mt-0.5">{focusedTask.name}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-8">
            {layout.nodes.length <= 1 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                No dependencies to visualize
              </div>
            ) : (
              <div
                className="relative mx-auto"
                style={{ width: containerWidth, height: containerHeight }}
              >
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={containerWidth}
                  height={containerHeight}
                  style={{ left: 40, top: 40 }}
                >
                  {layout.edges.map((edge, i) => (
                    <GlowTreeEdge
                      key={`${edge.sourceId}-${edge.targetId}`}
                      sourceX={edge.sourceX}
                      sourceY={edge.sourceY}
                      targetX={edge.targetX}
                      targetY={edge.targetY}
                      index={i}
                    />
                  ))}
                </svg>

                <div className="absolute" style={{ left: 40, top: 40 }}>
                  {layout.nodes.map((node) => {
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
                        isFocused={node.id === taskId}
                        level={node.level}
                        indexInLevel={node.indexInLevel}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
