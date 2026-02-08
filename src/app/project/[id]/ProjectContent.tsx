'use client'

import { useState, useEffect } from 'react'
import { Sparkles, LayoutGrid, Calendar, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { ThemeSelector } from '@/components/ui/ThemeSelector'
import { GanttChart } from '@/components/gantt/GanttChart'
import { TimeScaleSelector } from '@/components/gantt/TimeScaleSelector'
import { TaskBoard } from '@/components/board/TaskBoard'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useBoardStore } from '@/lib/store/boardStore'
import type { Project } from '@/lib/db/schema'

interface ProjectContentProps {
  project: Project
}

export default function ProjectContent({ project }: ProjectContentProps) {
  const [activeTab, setActiveTab] = useState<'board' | 'gantt'>('board')
  const [isLoading, setIsLoading] = useState(true)
  const { setTasks: setGanttTasks, setRows, timeScale } = useGanttStore()
  const { setTasks: setBoardTasks, setLabels } = useBoardStore()

  useEffect(() => {
    setBoardTasks([])
    setGanttTasks([])
    setRows([])
    setLabels([])
    setIsLoading(false)
  }, [project.id, setBoardTasks, setGanttTasks, setRows, setLabels])

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Sparkles className="w-5 h-5 text-[var(--primary)]" />
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

        {isLoading ? (
          <div className="flex gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex-1 min-w-[250px] h-96 rounded-xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {activeTab === 'board' && (
              <div className="h-[calc(100vh-180px)]">
                <TaskBoard projectId={project.id} />
              </div>
            )}

            {activeTab === 'gantt' && (
              <GanttChart
                projectId={project.id}
                startDate={new Date(project.startDate)}
                endDate={new Date(project.endDate)}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
