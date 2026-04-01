'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'

import { Settings, Orbit } from 'lucide-react'
import { ProjectViewSwitcher } from '@/components/project/ProjectViewSwitcher'
import type { RealmInfo } from '@/components/project/ProjectContextMenu'
import type { ProjectViewMode } from '@/components/project/useViewPreference'
import type { ProjectWithStats } from '@/components/project/types'

export interface WorkspaceGroup {
  groupId: string
  groupName: string
  groupColor: string
  isPersonal: boolean
  memberCount: number
  isOwner: boolean
  projects: ProjectWithStats[]
}

interface WorkspaceDashboardProps {
  workspaces: WorkspaceGroup[]
  sharedProjects?: ProjectWithStats[]
  section: 'personal' | 'team'
  view: ProjectViewMode
  onViewChange: (view: ProjectViewMode) => void
  gridLayout: 'scroll' | 'wrap'
  onGridLayoutChange: (layout: 'scroll' | 'wrap') => void
  onEdit: (project: ProjectWithStats) => void
  onShare: (project: ProjectWithStats) => void
  onDelete?: (id: string) => void
  onGroupChange?: (projectId: string, newGroup: string | null) => void
  realms?: RealmInfo[]
  projectRealmMap?: Record<string, string[]>
  onToggleRealm?: (projectId: string, realmId: string) => void
  onOpenSettings: (ws: { id: string; name: string; isOwner: boolean; isPersonal: boolean }) => void
  onCreateWorkspace: () => void
}

export function WorkspaceDashboard({
  workspaces, sharedProjects = [], section, view, onViewChange, gridLayout, onGridLayoutChange,
  onEdit, onShare, onDelete, onGroupChange, realms, projectRealmMap, onToggleRealm, onOpenSettings,
}: WorkspaceDashboardProps) {
  const personalWorkspaces = useMemo(() => workspaces.filter((ws) => ws.isPersonal), [workspaces])
  const teamWorkspaces = useMemo(() => workspaces.filter((ws) => !ws.isPersonal), [workspaces])

  const allPersonalProjects = useMemo(() => {
    const owned = personalWorkspaces.flatMap((ws) => ws.projects)
    const shared = sharedProjects.map((p) => ({ ...p, group: 'Shared with me' }))
    return [...owned, ...shared]
  }, [personalWorkspaces, sharedProjects])

  if (section === 'personal') {
    return (
      <ProjectViewSwitcher
        projects={allPersonalProjects}
        onEdit={onEdit}
        onDelete={onDelete}
        onShare={onShare}
        onGroupChange={onGroupChange}
        realms={realms}
        projectRealmMap={projectRealmMap}
        onToggleRealm={onToggleRealm}
        view={view}
        onViewChange={onViewChange}
        layout={gridLayout}
        onLayoutChange={onGridLayoutChange}
      />
    )
  }

  if (teamWorkspaces.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]"
      >
        <Orbit className="w-8 h-8 text-[var(--text-dim)] mb-3" />
        <p className="text-[var(--text-muted)] mb-1">No team realms</p>
        <p className="text-sm text-[var(--text-dim)] mb-4">Create a realm to collaborate with your team</p>
      </motion.div>
    )
  }

  return (
    <div className="space-y-6">
      {teamWorkspaces.map((ws) => (
        <WorkspaceSection
          key={ws.groupId}
          workspace={ws}
          view={view}
          onViewChange={onViewChange}
          gridLayout={gridLayout}
          onGridLayoutChange={onGridLayoutChange}
          onEdit={onEdit}
          onShare={onShare}
          onDelete={onDelete}
          onGroupChange={onGroupChange}
          realms={realms}
          projectRealmMap={projectRealmMap}
          onToggleRealm={onToggleRealm}
          onOpenSettings={onOpenSettings}
        />
      ))}
    </div>
  )
}

interface WorkspaceSectionProps {
  workspace: WorkspaceGroup
  view: ProjectViewMode
  onViewChange: (view: ProjectViewMode) => void
  gridLayout: 'scroll' | 'wrap'
  onGridLayoutChange: (layout: 'scroll' | 'wrap') => void
  onEdit: (project: ProjectWithStats) => void
  onShare: (project: ProjectWithStats) => void
  onDelete?: (id: string) => void
  onGroupChange?: (projectId: string, newGroup: string | null) => void
  realms?: RealmInfo[]
  projectRealmMap?: Record<string, string[]>
  onToggleRealm?: (projectId: string, realmId: string) => void
  onOpenSettings: (ws: { id: string; name: string; isOwner: boolean; isPersonal: boolean }) => void
}

function WorkspaceSection({ workspace: ws, view, onViewChange, gridLayout, onGridLayoutChange, onEdit, onShare, onDelete, onGroupChange, realms, projectRealmMap, onToggleRealm, onOpenSettings }: WorkspaceSectionProps) {
  const flatProjects = useMemo(() =>
    ws.projects.map((p) => ({ ...p, group: null })),
    [ws.projects]
  )

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 group/ws">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: ws.groupColor.startsWith('#') ? ws.groupColor : 'var(--primary)' }}
        />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">{ws.groupName}</h3>
        <span className="text-[10px] text-slate-600">{ws.memberCount} members</span>
        <span className="text-[10px] text-slate-600">{ws.projects.length} projects</span>
        <button
          onClick={() => onOpenSettings({ id: ws.groupId, name: ws.groupName, isOwner: ws.isOwner, isPersonal: ws.isPersonal })}
          className="p-1 rounded-md text-slate-600 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover/ws:opacity-100"
          aria-label={`${ws.groupName} realm settings`}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 h-px bg-white/[0.06]" />
      </div>
      {ws.projects.length > 0 ? (
        <ProjectViewSwitcher
          projects={flatProjects}
          onEdit={onEdit}
          onDelete={onDelete}
          onShare={onShare}
          onGroupChange={onGroupChange}
          realms={realms}
          projectRealmMap={projectRealmMap}
          onToggleRealm={onToggleRealm}
          view={view}
          onViewChange={onViewChange}
          layout={gridLayout}
          onLayoutChange={onGridLayoutChange}
        />
      ) : (
        <p className="text-xs text-[var(--text-dim)] py-4 text-center">No projects in this realm yet</p>
      )}
    </div>
  )
}
