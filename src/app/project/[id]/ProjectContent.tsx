'use client'

import { useState, useEffect, useCallback } from 'react'
import { LayoutGrid, Calendar, ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react'
import Image from 'next/image'
import aeonLogo from '@/assets/aeon.png'
import Link from 'next/link'
import { ThemeSelector } from '@/components/ui/ThemeSelector'
import { GlassStage } from '@/components/ui/GlassStage'
import { GanttChart } from '@/components/gantt/GanttChart'
import { TimeScaleSelector } from '@/components/gantt/TimeScaleSelector'
import { TaskBoard } from '@/components/board/TaskBoard'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useBoardStore } from '@/lib/store/boardStore'
import { getBoardTasks, createBoardTask, updateBoardTask, deleteBoardTask, reorderBoardTasks } from '@/lib/actions/board'
import { getRows, getGanttTasks, createGanttTask, updateGanttTask, deleteGanttTask } from '@/lib/actions/gantt'
import { getLabels, getTaskLabels } from '@/lib/actions/labels'
import type { Project } from '@/lib/db/schema'

interface ProjectContentProps {
  project: Project
}

export default function ProjectContent({ project }: ProjectContentProps) {
  const [activeTab, setActiveTab] = useState<'board' | 'gantt'>('board')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadKey, setLoadKey] = useState(0)
  const { setTasks: setGanttTasks, setRows, timeScale } = useGanttStore()
  const { setTasks: setBoardTasks, setLabels } = useBoardStore()

  useEffect(() => {
    setIsLoading(true)
    setLoadError(null)
    setGanttTasks([])
    setRows([])
    setLabels([])

    const loadBoard = Promise.all([
      getBoardTasks(project.id),
      getLabels(project.id),
      getTaskLabels(project.id),
    ])
      .then(([dbTasks, dbLabels, dbTaskLabels]) => {
        const taskLabelMap = new Map<string, string[]>()
        dbTaskLabels.forEach((tl) => {
          const existing = taskLabelMap.get(tl.taskId) || []
          existing.push(tl.labelId)
          taskLabelMap.set(tl.taskId, existing)
        })

        const mapped = dbTasks.map((t) => ({
          id: t.id,
          projectId: t.projectId,
          name: t.name,
          description: t.description || undefined,
          status: t.status as 'todo' | 'doing' | 'review' | 'done',
          priority: t.priority as 'low' | 'medium' | 'high' | 'urgent',
          color: t.color,
          labels: taskLabelMap.get(t.id) || [],
          startDate: t.startDate ? t.startDate.toISOString() : undefined,
          endDate: t.endDate ? t.endDate.toISOString() : undefined,
          onTimeline: t.onTimeline,
          orderIndex: t.orderIndex,
        }))
        setBoardTasks(mapped)

        setLabels(dbLabels.map((l) => ({
          id: l.id,
          projectId: l.projectId,
          name: l.name,
          color: l.color,
        })))
      })

    const loadGantt = Promise.all([
      getRows(project.id),
      getGanttTasks(project.id),
    ])
      .then(([dbRows, dbGanttTasks]) => {
        setRows(dbRows.map((r) => ({
          id: r.id,
          projectId: r.projectId,
          name: r.name,
          color: r.color,
          orderIndex: r.orderIndex,
        })))
        setGanttTasks(dbGanttTasks.map((t) => ({
          id: t.id,
          projectId: t.projectId,
          rowId: t.rowId || '',
          name: t.name,
          description: t.description || undefined,
          startDate: t.startDate.toISOString(),
          endDate: t.endDate.toISOString(),
          color: t.color,
          progress: t.progress,
          dependencies: [],
        })))
      })

    Promise.all([loadBoard, loadGantt])
      .catch((err) => {
        console.error('Failed to load project data:', err)
        setLoadError('Failed to load project data. Check your connection and try again.')
      })
      .finally(() => setIsLoading(false))
  }, [project.id, setBoardTasks, setGanttTasks, setRows, setLabels, loadKey])

  const handleTaskCreate = useCallback((task: {
    id: string
    projectId: string
    name: string
    description?: string
    status: string
    priority: string
    color: string
    onTimeline: boolean
    orderIndex: number
    startDate?: string
    endDate?: string
  }) => {
    createBoardTask(task).catch((err) => console.error('Failed to create task:', err))
  }, [])

  const handleTaskUpdate = useCallback((taskId: string, updates: Record<string, unknown>) => {
    updateBoardTask(taskId, project.id, updates as {
      name?: string
      description?: string | null
      status?: string
      priority?: string
      color?: string
      onTimeline?: boolean
      orderIndex?: number
    }).catch((err) => console.error('Failed to update task:', err))
  }, [project.id])

  const handleTaskDelete = useCallback((taskId: string) => {
    deleteBoardTask(taskId, project.id).catch((err) => console.error('Failed to delete task:', err))
  }, [project.id])

  const handleTaskMove = useCallback((updates: { id: string; orderIndex: number; status?: string }[]) => {
    reorderBoardTasks(project.id, updates).catch((err) => console.error('Failed to reorder tasks:', err))
  }, [project.id])

  const handleGanttTaskCreate = useCallback((task: {
    id: string
    projectId: string
    rowId: string
    name: string
    startDate: string
    endDate: string
    color: string
    progress?: number
  }) => {
    createGanttTask(task).catch((err) => console.error('Failed to create gantt task:', err))
  }, [])

  const handleGanttTaskUpdate = useCallback((taskId: string, updates: Record<string, unknown>) => {
    updateGanttTask(taskId, project.id, updates as {
      rowId?: string
      name?: string
      startDate?: string
      endDate?: string
      color?: string
      progress?: number
    }).catch((err) => console.error('Failed to update gantt task:', err))
  }, [project.id])

  const handleGanttTaskDelete = useCallback((taskId: string) => {
    deleteGanttTask(taskId, project.id).catch((err) => console.error('Failed to delete gantt task:', err))
  }, [project.id])

  return (
    <div className="min-h-screen">
      <GlassStage
        blobConfig={{
          blobs: [
            { position: 'top-[5%] right-[20%]', size: 'w-[600px] h-[600px]', color: 'glow', opacity: 0.10 },
            { position: 'bottom-[15%] left-[5%]', size: 'w-[400px] h-[400px]', color: 'primary', opacity: 0.07, delay: 7 },
          ]
        }}
      />

      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Image
              src={aeonLogo}
              alt="Aeon"
              width={24}
              height={24}
              className="rounded"
              style={{ filter: 'drop-shadow(0 0 6px var(--glow-color))' }}
            />
            <span className="text-lg font-bold text-white">{project.name}</span>
          </div>

          <div className="flex items-center gap-4">
            {activeTab === 'gantt' && <TimeScaleSelector />}
            <ThemeSelector />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setActiveTab('board')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'board'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            Task Board
          </button>
          <button
            onClick={() => setActiveTab('gantt')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'gantt'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Gantt Chart
          </button>
        </div>

        {loadError ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]">
            <AlertTriangle className="w-10 h-10 text-amber-400 mb-4" />
            <p className="text-white font-medium mb-2">Something went wrong</p>
            <p className="text-sm text-slate-400 mb-6 text-center max-w-md">{loadError}</p>
            <button
              onClick={() => setLoadKey((k) => k + 1)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30 transition-all text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className="flex gap-4">
            {[...Array(4)].map((_, colIdx) => (
              <div key={colIdx} className="flex-1 min-w-[250px] space-y-3">
                <div className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />
                {[...Array(colIdx === 0 ? 3 : colIdx === 1 ? 2 : 1)].map((_, cardIdx) => (
                  <div key={cardIdx} className="rounded-xl bg-white/[0.03] animate-pulse p-3 space-y-2">
                    <div className="h-3 w-16 rounded bg-white/[0.06]" />
                    <div className="h-4 w-3/4 rounded bg-white/[0.06]" />
                    <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
                    <div className="flex gap-2 pt-2 border-t border-white/[0.04]">
                      <div className="h-5 w-14 rounded bg-white/[0.05]" />
                      <div className="h-5 w-20 rounded bg-white/[0.04]" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <>
            {activeTab === 'board' && (
              <div className="h-[calc(100vh-180px)]">
                <TaskBoard
                  projectId={project.id}
                  onTaskCreate={handleTaskCreate}
                  onTaskUpdate={handleTaskUpdate}
                  onTaskDelete={handleTaskDelete}
                  onTaskMove={handleTaskMove}
                />
              </div>
            )}

            {activeTab === 'gantt' && (
              <GanttChart
                projectId={project.id}
                startDate={new Date(project.startDate)}
                endDate={new Date(project.endDate)}
                onTaskUpdate={handleGanttTaskUpdate}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
