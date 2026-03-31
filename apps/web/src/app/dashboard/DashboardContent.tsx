'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Plus, Share2 } from 'lucide-react'
import { NeonButton } from '@/components/ui/NeonButton'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { getProjectsWithStats, getSharedProjects, getWorkspaceProjects } from '@/lib/actions/projects'
import { migrateGroupsToWorkspaces, createGroup } from '@/lib/actions/workspaces'
import { WorkspaceSettingsModal } from '@/components/workspace/WorkspaceSettingsModal'
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal'
import { EditProjectModal } from '@/components/project/EditProjectModal'
import { ProjectViewSwitcher } from '@/components/project/ProjectViewSwitcher'
import { useViewPreference, type ProjectViewMode } from '@/components/project/useViewPreference'
import { ShareModal } from '@/components/board/ShareModal'
import { GlassStage } from '@/components/ui/GlassStage'
import { DashboardHeader, type DashboardTab } from './DashboardHeader'
import { WorkspacesTab, type WorkspaceGroup } from './WorkspacesTab'
import type { ProjectWithStats } from '@/components/project/types'

interface DashboardContentProps {
  user: {
    id: string
    role: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
  projects: ProjectWithStats[]
}

export default function DashboardContent({ user, projects: initialProjects }: DashboardContentProps) {
  const [projects, setProjects] = useState(initialProjects)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectWithStats | null>(null)
  const [sharingProject, setSharingProject] = useState<ProjectWithStats | null>(null)
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('mine')
  const [sharedProjects, setSharedProjects] = useState<ProjectWithStats[]>([])
  const [workspaceData, setWorkspaceData] = useState<WorkspaceGroup[]>([])
  const [tabLoaded, setTabLoaded] = useState<Record<DashboardTab, boolean>>({ mine: true, shared: false, workspaces: false })
  const [migrationDone, setMigrationDone] = useState(false)
  const [workspaceSettingsId, setWorkspaceSettingsId] = useState<{ id: string; name: string; isOwner: boolean } | null>(null)
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const existingGroups = [...new Set(projects.map((p) => p.group).filter((g): g is string => !!g && g !== 'General'))].sort()

  const [view, setView] = useViewPreference()
  const [gridLayout, setGridLayout] = useState<'scroll' | 'wrap'>('wrap')

  useEffect(() => {
    let alive = true
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        getProjectsWithStats().then((data) => { if (alive) setProjects(data) }).catch(() => {})
      }
    }
    const interval = setInterval(refresh, 10_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { alive = false; clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [])

  useEffect(() => {
    if (migrationDone) return
    let cancelled = false
    const attempt = async (retries: number) => {
      if (retries >= 3 || cancelled) return
      try {
        const count = await migrateGroupsToWorkspaces()
        if (cancelled) return
        setMigrationDone(true)
        if (count > 0) setTabLoaded((prev) => ({ ...prev, workspaces: false }))
      } catch (err) {
        console.error('Workspace migration failed:', err)
        if (!cancelled) setTimeout(() => attempt(retries + 1), 2000 * (retries + 1))
      }
    }
    attempt(0)
    return () => { cancelled = true }
  }, [migrationDone])

  const handleWorkspaceCreate = async (name: string) => {
    await createGroup({ name })
    setTabLoaded((prev) => ({ ...prev, workspaces: false }))
    setDashboardTab('workspaces')
  }

  const refreshWorkspaces = () => {
    setTabLoaded((prev) => ({ ...prev, workspaces: false }))
  }

  useEffect(() => {
    if (dashboardTab === 'shared' && !tabLoaded.shared) {
      getSharedProjects()
        .then((data) => {
          setSharedProjects(data.map((p) => ({ ...p, totalTasks: 0, doneTasks: 0, completionPct: 0 })) as ProjectWithStats[])
          setTabLoaded((prev) => ({ ...prev, shared: true }))
        })
        .catch((err) => console.error('Failed to load shared projects:', err))
    }
    if (dashboardTab === 'workspaces' && !tabLoaded.workspaces) {
      getWorkspaceProjects()
        .then((data) => {
          setWorkspaceData(data.map((g) => ({
            groupId: g.groupId,
            groupName: g.groupName,
            groupColor: g.groupColor ?? 'purple',
            memberCount: g.memberCount,
            isOwner: g.ownerId === user.id || g.memberRole === 'owner',
            projects: g.projects.map((p) => ({ ...p, totalTasks: 0, doneTasks: 0, completionPct: 0 })) as ProjectWithStats[],
          })))
          setTabLoaded((prev) => ({ ...prev, workspaces: true }))
        })
        .catch((err) => console.error('Failed to load workspaces:', err))
    }
  }, [dashboardTab, tabLoaded, user.id])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key.toLowerCase() === 'n' && !showCreateModal && !editingProject && !sharingProject) {
        e.preventDefault()
        setShowCreateModal(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showCreateModal, editingProject, sharingProject])

  return (
    <div className="min-h-screen">
      <GlassStage
        blobConfig={{
          blobs: [
            { position: 'top-[10%] right-[15%]', size: 'w-[500px] h-[500px]', color: 'glow', opacity: 0.12 },
            { position: 'bottom-[20%] left-[10%]', size: 'w-[400px] h-[400px]', color: 'primary', opacity: 0.08, delay: 7 },
          ]
        }}
      />

      <DashboardHeader
        user={user}
        hasProjects={projects.length > 0}
        dashboardTab={dashboardTab}
        onTabChange={setDashboardTab}
        view={view}
        onViewChange={setView}
        gridLayout={gridLayout}
        onGridLayoutChange={setGridLayout}
        onCreateProject={() => setShowCreateModal(true)}
      />

      <main className="px-3 sm:px-6 py-3 relative z-10">
        {dashboardTab === 'mine' && (
          projects.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]"
            >
              <p className="text-[var(--text-muted)] mb-1">No projects yet</p>
              <p className="text-sm text-[var(--text-dim)] mb-6">Create your first project to get started</p>
              <NeonButton color="purple" glowIntensity="md" onClick={() => setShowCreateModal(true)}>
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create First Project
                </span>
              </NeonButton>
            </motion.div>
          ) : (
            <ProjectViewSwitcher
              projects={projects}
              onEdit={setEditingProject}
              onDelete={(id) => setProjects((prev) => prev.filter((p) => p.id !== id))}
              onShare={setSharingProject}
              onGroupChange={(projectId, newGroup) => {
                setProjects((prev) => prev.map((p) =>
                  p.id === projectId ? { ...p, group: newGroup ?? undefined } as ProjectWithStats : p
                ))
              }}
              view={view}
              onViewChange={setView}
              layout={gridLayout}
              onLayoutChange={setGridLayout}
            />
          )
        )}

        {dashboardTab === 'shared' && (
          !tabLoaded.shared ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--text-dim)]">Loading shared projects...</div>
          ) : sharedProjects.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]"
            >
              <Share2 className="w-8 h-8 text-[var(--text-dim)] mb-3" />
              <p className="text-[var(--text-muted)] mb-1">No shared projects</p>
              <p className="text-sm text-[var(--text-dim)]">Projects shared with you will appear here</p>
            </motion.div>
          ) : (
            <ProjectViewSwitcher
              projects={sharedProjects}
              onEdit={setEditingProject}
              onShare={setSharingProject}
              view={view}
              onViewChange={setView}
              layout={gridLayout}
              onLayoutChange={setGridLayout}
            />
          )
        )}

        {dashboardTab === 'workspaces' && (
          <WorkspacesTab
            loaded={tabLoaded.workspaces}
            workspaceData={workspaceData}
            view={view}
            onViewChange={setView}
            gridLayout={gridLayout}
            onGridLayoutChange={setGridLayout}
            onEdit={setEditingProject}
            onShare={setSharingProject}
            onOpenSettings={setWorkspaceSettingsId}
            onCreateWorkspace={() => setShowCreateWorkspace(true)}
          />
        )}
      </main>

      <CreateProjectModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} existingGroups={existingGroups} />
      {editingProject && (
        <EditProjectModal
          isOpen={true}
          project={editingProject}
          onClose={() => setEditingProject(null)}
          existingGroups={existingGroups}
        />
      )}
      {sharingProject && (
        <ShareModal
          isOpen={true}
          projectId={sharingProject.id}
          projectName={sharingProject.name}
          onClose={() => setSharingProject(null)}
        />
      )}
      {workspaceSettingsId && (
        <WorkspaceSettingsModal
          isOpen={true}
          groupId={workspaceSettingsId.id}
          groupName={workspaceSettingsId.name}
          isOwner={workspaceSettingsId.isOwner}
          onClose={() => setWorkspaceSettingsId(null)}
          onUpdated={refreshWorkspaces}
        />
      )}
      <CreateWorkspaceModal
        isOpen={showCreateWorkspace}
        onClose={() => setShowCreateWorkspace(false)}
        onCreate={handleWorkspaceCreate}
      />
    </div>
  )
}
