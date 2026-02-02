'use client'

import { useState, useEffect } from 'react'
import { ThemeSelector } from '@/components/ui/ThemeSelector'
import { GanttChart } from '@/components/gantt/GanttChart'
import { TimeScaleSelector } from '@/components/gantt/TimeScaleSelector'
import { TaskBoard } from '@/components/board/TaskBoard'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useBoardStore } from '@/lib/store/boardStore'
import { Sparkles, LayoutGrid, Calendar } from 'lucide-react'
import Link from 'next/link'

const DEMO_PROJECT_ID = 'demo-project'

export default function DemoPage() {
  const [activeTab, setActiveTab] = useState<'gantt' | 'board'>('board')
  const { setTasks: setGanttTasks, setRows, timeScale } = useGanttStore()
  const { setTasks: setBoardTasks, setLabels } = useBoardStore()

  useEffect(() => {
    const today = new Date()
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    const nextMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

    setRows([
      { id: 'row-1', projectId: DEMO_PROJECT_ID, name: 'Development', color: 'purple', orderIndex: 0 },
      { id: 'row-2', projectId: DEMO_PROJECT_ID, name: 'Design', color: 'cyan', orderIndex: 1 },
      { id: 'row-3', projectId: DEMO_PROJECT_ID, name: 'Testing', color: 'green', orderIndex: 2 },
    ])

    setGanttTasks([
      { id: 'gt-1', projectId: DEMO_PROJECT_ID, rowId: 'row-1', name: 'Build UI Components', startDate: today.toISOString(), endDate: nextWeek.toISOString(), color: 'purple', progress: 60, dependencies: [] },
      { id: 'gt-2', projectId: DEMO_PROJECT_ID, rowId: 'row-2', name: 'Design System', startDate: today.toISOString(), endDate: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(), color: 'cyan', progress: 80, dependencies: [] },
      { id: 'gt-3', projectId: DEMO_PROJECT_ID, rowId: 'row-3', name: 'Integration Tests', startDate: nextWeek.toISOString(), endDate: nextMonth.toISOString(), color: 'green', progress: 0, dependencies: ['gt-1'] },
    ])

    setLabels([
      { id: 'label-1', projectId: DEMO_PROJECT_ID, name: 'Frontend', color: 'purple' },
      { id: 'label-2', projectId: DEMO_PROJECT_ID, name: 'Backend', color: 'blue' },
      { id: 'label-3', projectId: DEMO_PROJECT_ID, name: 'Bug', color: 'pink' },
    ])

    setBoardTasks([
      { id: 'bt-1', projectId: DEMO_PROJECT_ID, name: 'Setup project structure', status: 'done', priority: 'high', color: 'purple', labels: ['label-1'], onTimeline: true, orderIndex: 0 },
      { id: 'bt-2', projectId: DEMO_PROJECT_ID, name: 'Create GlowCard component', status: 'done', priority: 'medium', color: 'cyan', labels: ['label-1'], onTimeline: false, orderIndex: 1 },
      { id: 'bt-3', projectId: DEMO_PROJECT_ID, name: 'Implement drag-and-drop', status: 'doing', priority: 'high', color: 'purple', labels: ['label-1'], onTimeline: false, orderIndex: 0 },
      { id: 'bt-4', projectId: DEMO_PROJECT_ID, name: 'Add theme switching', status: 'doing', priority: 'medium', color: 'green', labels: [], onTimeline: false, orderIndex: 1 },
      { id: 'bt-5', projectId: DEMO_PROJECT_ID, name: 'Write API routes', status: 'todo', priority: 'high', color: 'blue', labels: ['label-2'], onTimeline: false, orderIndex: 0 },
      { id: 'bt-6', projectId: DEMO_PROJECT_ID, name: 'Database migrations', status: 'todo', priority: 'medium', color: 'blue', labels: ['label-2'], onTimeline: false, orderIndex: 1 },
      { id: 'bt-7', projectId: DEMO_PROJECT_ID, name: 'Fix date parsing bug', status: 'review', priority: 'urgent', color: 'pink', labels: ['label-3'], onTimeline: false, orderIndex: 0 },
    ])
  }, [setGanttTasks, setRows, setBoardTasks, setLabels])

  const today = new Date()
  const startDate = new Date(today.getFullYear(), today.getMonth(), 1)
  const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0)

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Sparkles className="w-6 h-6 text-[var(--primary)]" />
            <span className="text-xl font-bold text-white">Aeon</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">Demo</span>
          </Link>

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

        {activeTab === 'board' && (
          <div className="h-[calc(100vh-180px)]">
            <TaskBoard projectId={DEMO_PROJECT_ID} />
          </div>
        )}

        {activeTab === 'gantt' && (
          <GanttChart
            projectId={DEMO_PROJECT_ID}
            startDate={startDate}
            endDate={endDate}
          />
        )}
      </main>
    </div>
  )
}
