'use client'

import { useState } from 'react'
import { RefreshCw, AlertTriangle, Filter, Link2, GitBranch, RotateCcw, Columns3, Grid2x2, Package, Users, Search } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { signOut } from 'next-auth/react'
import { GlassStage } from '@/components/ui/GlassStage'
import { TimeScaleSelector } from '@/components/gantt/TimeScaleSelector'
import { TaskBoard } from '@/components/board/TaskBoard'
import { ProjectSwitcher } from '@/components/board/ProjectSwitcher'
import { useThemeStore } from '@/stores/themeStore'
import { SaveStatusPill } from '@/components/board/SaveStatusPill'
import { FavoriteStar } from '@/components/board/FavoriteStar'
import { activeFilterCount, DEFAULT_FILTERS } from '@/lib/utils/boardFilters'
import type { BoardFilters } from '@/lib/utils/boardFilters'
import { cn } from '@/lib/utils/cn'
import { GanttViewSelector } from '@/components/gantt/GanttViewSelector'
import { TaskEditModal } from '@/components/board/TaskEditModal'
import { VaultDaysModal } from '@/components/board/VaultDaysModal'
import { BatchVaultModal } from '@/components/board/BatchVaultModal'
import { ArchiveBrowser } from '@/components/board/ArchiveBrowser'
import { ShareModal } from '@/components/board/ShareModal'
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar'
import { useSidebarStore } from '@/stores/sidebarStore'
import type { Project } from '@/lib/db/schema'
import { useProjectData } from './useProjectData'
import { useBoardHandlers } from './useBoardHandlers'
import { useLabelHandlers } from './useLabelHandlers'
import { useDependencyHandlers } from './useDependencyHandlers'
import { useGanttHandlers } from './useGanttHandlers'
import { useCanvasHandlers } from './useCanvasHandlers'
import { useBoardTheme } from './useBoardTheme'

const CanvasView = dynamic(() => import('@/components/canvas/CanvasView'), { ssr: false })
const GanttChart = dynamic(() => import('@/components/gantt/GanttChart').then(m => ({ default: m.GanttChart })), { ssr: false })
const TrophyRoom = dynamic(() => import('@/components/trophy/TrophyRoom').then(m => ({ default: m.TrophyRoom })), { ssr: false })
const VelocityTab = dynamic(() => import('@/components/velocity/VelocityTab').then(m => ({ default: m.VelocityTab })), { ssr: false })

interface ProjectContentProps {
  project: Project
  user: {
    id: string
    role: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
  initialBoardData?: Record<string, unknown>
  initialFavorite?: boolean
}

export default function ProjectContent({ project, user, initialBoardData, initialFavorite = false }: ProjectContentProps) {
  const [activeTab, setActiveTab] = useState<'board' | 'gantt' | 'canvas' | 'trophy' | 'velocity'>('board')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS)
  const [showAllDeps, setShowAllDeps] = useState(false)
  const [connectMode, setConnectMode] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const { boardLayout, setBoardLayout, colors, projectColors, smoothUiRenders } = useThemeStore()
  const projectGlow = projectColors[project.id] || colors.glowColor || 'rgba(139, 92, 246, 0.5)'
  const { collapsed } = useSidebarStore()

  const { isLoading, loadError, triggerReload } = useProjectData(project.id, activeTab, initialBoardData)
  useBoardTheme(project.id, (project.settings ?? {}) as Record<string, unknown>)

  const board = useBoardHandlers(project.id)
  const { handleLabelCreate, handleLabelUpdate, handleLabelDelete, handleLabelToggle } = useLabelHandlers(project.id)
  const { handleAddDependency, handleRemoveDependency } = useDependencyHandlers(project.id)
  const gantt = useGanttHandlers(project.id, setActiveTab, triggerReload)
  const canvas = useCanvasHandlers(project.id)

  return (
    <div className="min-h-screen flex">
      <ProjectSidebar
        projectId={project.id}
        user={user}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSignOut={() => signOut({ callbackUrl: '/' })}
      />

      <div className="flex-1 min-w-0 transition-all duration-300" style={{ marginLeft: collapsed ? 60 : 260 }}>
      <GlassStage
        blobConfig={{
          blobs: [
            { position: 'top-[5%] right-[20%]', size: 'w-[600px] h-[600px]', color: 'glow', opacity: 0.10 },
            { position: 'bottom-[15%] left-[5%]', size: 'w-[400px] h-[400px]', color: 'primary', opacity: 0.07, delay: 7 },
          ]
        }}
      />

      <header className="sticky top-0 z-40 bg-[#0a0a0c]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="px-2 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProjectSwitcher
              currentProjectId={project.id}
              projectName={project.name}
              glowColor={projectGlow}
            />
            <SaveStatusPill />
            <FavoriteStar projectId={project.id} initialFavorite={initialFavorite} />
          </div>

          <button
            onClick={() => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }))
            }}
            className="hidden sm:flex h-8 w-56 items-center gap-2 rounded-full px-3 text-xs text-white/30 transition-colors hover:bg-white/[0.06]"
            style={{ background: 'rgba(255, 255, 255, 0.04)' }}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span>Search or Cmd+K...</span>
          </button>

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
                    <span className="w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center" style={{ backgroundColor: 'var(--primary)' }}>
                      {activeFilterCount(filters)}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setShowAllDeps(!showAllDeps)}
                  className={cn(
                    'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    showAllDeps
                      ? 'bg-white/10 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Link2 className="w-4 h-4" />
                  <span>Deps</span>
                </button>
                <button
                  onClick={() => setConnectMode(!connectMode)}
                  className={cn(
                    'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    connectMode
                      ? 'border text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                  style={connectMode ? {
                    backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
                    color: 'var(--primary)',
                  } : undefined}
                >
                  <GitBranch className="w-4 h-4" />
                  <span>Connect</span>
                </button>
                <button
                  onClick={() => setBoardLayout(boardLayout === 'scroll' ? 'grid' : 'scroll')}
                  className={cn(
                    'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
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
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Share</span>
            </button>
          </div>
        </div>
      </header>

      <main className="px-0 sm:px-6 py-2">

        {loadError ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]">
            <AlertTriangle className="w-10 h-10 text-amber-400 mb-4" />
            <p className="text-white font-medium mb-2">Something went wrong</p>
            <p className="text-sm text-slate-400 mb-6 text-center max-w-md">{loadError}</p>
            <button
              onClick={triggerReload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border transition-all text-sm font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
                color: 'var(--primary)',
              }}
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
          <AnimatePresence mode={smoothUiRenders ? 'wait' : 'sync'}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: smoothUiRenders ? 0.15 : 0 }}
            >
              {activeTab === 'board' && (
                <div className="h-[calc(100dvh-120px)]">
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
                    startDate={project.startDate ? new Date(project.startDate) : new Date()}
                    endDate={project.endDate ? new Date(project.endDate) : new Date('2027-01-01')}
                    onTaskUpdate={gantt.handleGanttTaskUpdate}
                    onTaskClick={gantt.handleGanttTaskClick}
                    onRowUpdate={gantt.handleGanttRowUpdate}
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
            </motion.div>
          </AnimatePresence>
        )}
      </main>
      <ShareModal
        isOpen={showShare}
        projectId={project.id}
        projectName={project.name}
        onClose={() => setShowShare(false)}
      />
      </div>
    </div>
  )
}
