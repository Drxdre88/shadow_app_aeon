'use client'

import { motion } from 'framer-motion'
import { Plus, Building2, Settings } from 'lucide-react'
import { NeonButton } from '@/components/ui/NeonButton'
import { ProjectViewSwitcher } from '@/components/project/ProjectViewSwitcher'
import type { ProjectViewMode } from '@/components/project/useViewPreference'
import type { ProjectWithStats } from '@/components/project/types'

export interface WorkspaceGroup {
  groupId: string
  groupName: string
  groupColor: string
  memberCount: number
  isOwner: boolean
  projects: ProjectWithStats[]
}

interface WorkspacesTabProps {
  loaded: boolean
  workspaceData: WorkspaceGroup[]
  view: ProjectViewMode
  onViewChange: (view: ProjectViewMode) => void
  gridLayout: 'scroll' | 'wrap'
  onGridLayoutChange: (layout: 'scroll' | 'wrap') => void
  onEdit: (project: ProjectWithStats) => void
  onShare: (project: ProjectWithStats) => void
  onOpenSettings: (ws: { id: string; name: string; isOwner: boolean }) => void
  onCreateWorkspace: () => void
}

export function WorkspacesTab({
  loaded, workspaceData, view, onViewChange,
  gridLayout, onGridLayoutChange, onEdit, onShare,
  onOpenSettings, onCreateWorkspace,
}: WorkspacesTabProps) {
  if (!loaded) {
    return <div className="flex items-center justify-center py-16 text-sm text-[var(--text-dim)]">Loading workspaces...</div>
  }

  if (workspaceData.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]"
      >
        <Building2 className="w-8 h-8 text-[var(--text-dim)] mb-3" />
        <p className="text-[var(--text-muted)] mb-1">No workspaces</p>
        <p className="text-sm text-[var(--text-dim)] mb-4">Create a workspace to collaborate with your team</p>
        <NeonButton color="purple" glowIntensity="md" onClick={onCreateWorkspace}>
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create Workspace
          </span>
        </NeonButton>
      </motion.div>
    )
  }

  return (
    <div className="space-y-6">
      {workspaceData.map((ws) => (
        <div key={ws.groupId}>
          <div className="flex items-center gap-2 mb-3 group/ws">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ws.groupColor.startsWith('#') ? ws.groupColor : `var(--primary)` }} />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">{ws.groupName}</h3>
            <span className="text-[10px] text-slate-600">{ws.memberCount} members</span>
            <span className="text-[10px] text-slate-600">{ws.projects.length} projects</span>
            <button
              onClick={() => onOpenSettings({ id: ws.groupId, name: ws.groupName, isOwner: ws.isOwner })}
              className="p-1 rounded-md text-slate-600 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover/ws:opacity-100"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <div className="flex-1 h-px bg-white/[0.06]" />
            <button
              onClick={onCreateWorkspace}
              className="p-1 rounded-md text-slate-600 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover/ws:opacity-100"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          {ws.projects.length > 0 ? (
            <ProjectViewSwitcher
              projects={ws.projects}
              onEdit={onEdit}
              onShare={onShare}
              view={view}
              onViewChange={onViewChange}
              layout={gridLayout}
              onLayoutChange={onGridLayoutChange}
            />
          ) : (
            <p className="text-xs text-[var(--text-dim)] py-4 text-center">No projects in this workspace yet</p>
          )}
        </div>
      ))}
    </div>
  )
}
