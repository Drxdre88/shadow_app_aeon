'use client'

import { useState } from 'react'
import { LayoutGrid, Calendar, Lightbulb, ArrowLeft, RefreshCw, AlertTriangle, Filter, Link2, GitBranch, Trophy, RotateCcw, Columns3, Grid2x2, Package, Activity } from 'lucide-react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import aeonLogo from '@/assets/aeon.png'
import Link from 'next/link'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { GlassStage } from '@/components/ui/GlassStage'
import { GanttChart } from '@/components/gantt/GanttChart'
import { TimeScaleSelector } from '@/components/gantt/TimeScaleSelector'
import { TaskBoard } from '@/components/board/TaskBoard'
import { useThemeStore } from '@/stores/themeStore'
import { activeFilterCount, DEFAULT_FILTERS } from '@/lib/utils/boardFilters'
import type { BoardFilters } from '@/lib/utils/boardFilters'
import { cn } from '@/lib/utils/cn'
import { GanttViewSelector } from '@/components/gantt/GanttViewSelector'
import { TrophyRoom } from '@/components/trophy/TrophyRoom'
import { VelocityTab } from '@/components/velocity/VelocityTab'
import { TaskEditModal } from '@/components/board/TaskEditModal'
import { VaultDaysModal } from '@/components/board/VaultDaysModal'
import { BatchVaultModal } from '@/components/board/BatchVaultModal'
import { ArchiveBrowser } from '@/components/board/ArchiveBrowser'
import type { Project } from '@/lib/db/schema'
import { useProjectData } from './useProjectData'
import { useBoardHandlers } from './useBoardHandlers'
import { useLabelHandlers } from './useLabelHandlers'
import { useDependencyHandlers } from './useDependencyHandlers'
import { useGanttHandlers } from './useGanttHandlers'
import { useCanvasHandlers } from './useCanvasHandlers'

const CanvasView = dynamic(() => import('@/components/canvas/CanvasView'), { ssr: false })

interface ProjectContentProps {
  project: Project
}

export default function ProjectContent({ project }: ProjectContentProps) {
  const [activeTab, setActiveTab] = useState<'board' | 'gantt' | 'canvas' | 'trophy' | 'velocity'>('board')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS)
  const [showAllDeps, setShowAllDeps] = useState(false)
  const [connectMode, setConnectMode] = useState(false)
  const { boardLayout, setBoardLayout } = useThemeStore()

  const { isLoading, loadError, triggerReload } = useProjectData(project.id, activeTab)

  const board = useBoardHandlers(project.id)
  const { handleLabelCreate, handleLabelUpdate, handleLabelDelete, handleLabelToggle } = useLabelHandlers(project.id)
  const { handleAddDependency, handleRemoveDependency } = useDependencyHandlers(project.id)
  const gantt = useGanttHandlers(project.id, setActiveTab, triggerReload)
  const canvas = useCanvasHandlers(project.id)

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
        <div className="px-2 sm:px-6 py-3 flex items-center justify-between">
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
            <span className="text-sm sm:text-lg font-bold text-white truncate max-w-[120px] sm:max-w-none">{project.name}</span>

            <div className="flex items-center gap-1 ml-2 sm:ml-4">
              <button
                onClick={() => setActiveTab('board')}
                className={cn(
                  'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === 'board'
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden sm:inline">Board</span>
              </button>
              <button
                onClick={() => setActiveTab('gantt')}
                className={cn(
                  'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === 'gantt'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Gantt</span>
              </button>
              <button
                onClick={() => setActiveTab('canvas')}
                className={cn(
                  'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === 'canvas'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                <Lightbulb className="w-4 h-4" />
                <span className="hidden sm:inline">Canvas</span>
              </button>
              <button
                onClick={() => setActiveTab('trophy')}
                className={cn(
                  'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === 'trophy'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                <Trophy className="w-4 h-4" />
                <span className="hidden sm:inline">Trophy</span>
              </button>
              <button
                onClick={() => setActiveTab('velocity')}
                className={cn(
                  'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === 'velocity'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                <Activity className="w-4 h-4" />
                <span className="hidden sm:inline">Velocity</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'board' && (
              <>
                <button
                  onClick={() => board.setShowArchive(true)}
                  className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  <Package className="w-4 h-4" />
                  <span className="hidden sm:inline">Archive</span>
                </button>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={cn(
                    'relative flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    showFilters
                      ? 'bg-white/10 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Filter className="w-4 h-4" />
                  <span className="hidden sm:inline">Filter</span>
                  {activeFilterCount(filters) > 0 && (
                    <span className="w-4 h-4 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {activeFilterCount(filters)}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setShowAllDeps(!showAllDeps)}
                  className={cn(
                    'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    showAllDeps
                      ? 'bg-white/10 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Link2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Deps</span>
                </button>
                <button
                  onClick={() => setConnectMode(!connectMode)}
                  className={cn(
                    'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    connectMode
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <GitBranch className="w-4 h-4" />
                  <span className="hidden sm:inline">Connect</span>
                </button>
                <button
                  onClick={() => setBoardLayout(boardLayout === 'scroll' ? 'grid' : 'scroll')}
                  className={cn(
                    'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    boardLayout === 'grid'
                      ? 'bg-white/10 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                  title={boardLayout === 'scroll' ? 'Switch to grid layout' : 'Switch to horizontal scroll'}
                >
                  {boardLayout === 'scroll' ? <Grid2x2 className="w-4 h-4" /> : <Columns3 className="w-4 h-4" />}
                </button>
              </>
            )}
            {activeTab === 'gantt' && (
              <>
                <GanttViewSelector
                  projectId={project.id}
                  onViewCreate={gantt.handleGanttViewCreate}
                  onViewUpdate={gantt.handleGanttViewUpdate}
                  onViewDelete={gantt.handleGanttViewDelete}
                />
                <TimeScaleSelector />
                <button
                  onClick={gantt.handleGanttReflow}
                  className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium text-cyan-400 hover:bg-cyan-500/10 border border-cyan-500/20 hover:border-cyan-500/30 transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Reflow</span>
                </button>
                <button
                  onClick={gantt.handleGanttReset}
                  className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/30 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Reset</span>
                </button>
              </>
            )}
            <HelpButton />
            <SettingsButton />
          </div>
        </div>
      </header>

      <main className="px-2 sm:px-6 py-2">

        {loadError ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]">
            <AlertTriangle className="w-10 h-10 text-amber-400 mb-4" />
            <p className="text-white font-medium mb-2">Something went wrong</p>
            <p className="text-sm text-slate-400 mb-6 text-center max-w-md">{loadError}</p>
            <button
              onClick={triggerReload}
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
              <div className="h-[calc(100vh-110px)] sm:h-[calc(100vh-120px)]">
                <TaskBoard
                  projectId={project.id}
                  showFilters={showFilters}
                  filters={filters}
                  onFiltersChange={setFilters}
                  onTaskCreate={board.handleTaskCreate}
                  onTaskUpdate={board.handleTaskUpdate}
                  onTaskDelete={board.handleTaskDelete}
                  onTaskMove={board.handleTaskMove}
                  onColumnCreate={board.handleColumnCreate}
                  onColumnUpdate={board.handleColumnUpdate}
                  onColumnReorder={board.handleColumnReorder}
                  onColumnDelete={board.handleColumnDelete}
                  onAddDependency={handleAddDependency}
                  onRemoveDependency={handleRemoveDependency}
                  onLabelCreate={handleLabelCreate}
                  onLabelUpdate={handleLabelUpdate}
                  onLabelDelete={handleLabelDelete}
                  onLabelToggle={handleLabelToggle}
                  showAllDeps={showAllDeps}
                  onShowAllDepsChange={setShowAllDeps}
                  connectMode={connectMode}
                  onConnectModeChange={setConnectMode}
                  onPushToGantt={gantt.handlePushToGantt}
                  onSendToVault={board.handleSendToVault}
                  onVaultCompleted={board.handleVaultCompleted}
                  onArchiveTask={board.handleArchiveTask}
                  onArchiveColumn={board.handleArchiveColumn}
                />
                <VaultDaysModal
                  isOpen={!!board.vaultTarget}
                  taskName={board.vaultTarget?.taskName ?? ''}
                  onConfirm={board.handleVaultConfirm}
                  onClose={() => board.setVaultTarget(null)}
                />
                <BatchVaultModal
                  isOpen={!!board.batchVaultTarget}
                  columnName={board.batchVaultTarget?.columnName ?? ''}
                  tasks={board.batchVaultTarget?.tasks ?? []}
                  onConfirm={board.handleBatchVaultConfirm}
                  onClose={() => board.setBatchVaultTarget(null)}
                />
                <ArchiveBrowser
                  isOpen={board.showArchive}
                  projectId={project.id}
                  onClose={() => board.setShowArchive(false)}
                />
              </div>
            )}

            {activeTab === 'gantt' && (
              <>
                <GanttChart
                  projectId={project.id}
                  startDate={new Date(project.startDate)}
                  endDate={new Date(project.endDate)}
                  onTaskUpdate={gantt.handleGanttTaskUpdate}
                  onTaskClick={gantt.handleGanttTaskClick}
                />
                <TaskEditModal
                  isOpen={!!gantt.ganttEditTaskId}
                  editingTaskId={gantt.ganttEditTaskId}
                  newTaskStatus={null}
                  formData={gantt.ganttFormData}
                  projectId={project.id}
                  onFormChange={gantt.setGanttFormData}
                  onSubmit={gantt.handleGanttEditSubmit}
                  onClose={() => gantt.setGanttEditTaskId(null)}
                  onLabelToggle={handleLabelToggle}
                  onDateChange={(taskId, dates) => board.handleTaskUpdate(taskId, dates as Record<string, unknown>)}
                />
              </>
            )}

            {activeTab === 'canvas' && (
              <CanvasView
                projectId={project.id}
                onNodeCreate={canvas.handleCanvasNodeCreate}
                onNodeUpdate={canvas.handleCanvasNodeUpdate}
                onNodeDelete={canvas.handleCanvasNodeDelete}
                onEdgeCreate={canvas.handleCanvasEdgeCreate}
                onEdgeDelete={canvas.handleCanvasEdgeDelete}
              />
            )}

            {activeTab === 'trophy' && (
              <TrophyRoom projectId={project.id} />
            )}

            {activeTab === 'velocity' && (
              <VelocityTab projectId={project.id} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
