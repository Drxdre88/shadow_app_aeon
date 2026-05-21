'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { NeonButton } from '@/components/ui/NeonButton'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { getWorkspaceProjects, getSharedProjects } from '@/lib/actions/projects'
import { ensurePersonalWorkspace, createGroup, addProjectToGroup, removeProjectFromGroup } from '@/lib/actions/workspaces'
import type { RealmInfo } from '@/components/project/ProjectContextMenu'
import { WorkspaceSettingsModal } from '@/components/workspace/WorkspaceSettingsModal'
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal'
import { EditProjectModal } from '@/components/project/EditProjectModal'
import { ShareModal } from '@/components/board/ShareModal'
import { GlassStage } from '@/components/ui/GlassStage'
import { useViewPreference, type ProjectViewMode } from '@/components/project/useViewPreference'
import { AppSidebar } from '@/components/sidebar/AppSidebar'
import { TopBar } from '@/components/layout/TopBar'
import { DailyBriefingCard } from '@/components/hyperspace/DailyBriefingCard'
import { EodReflectionCard } from '@/components/hyperspace/EodReflectionCard'
import { useSidebarStore } from '@/stores/sidebarStore'
import { RealmSection } from '@/components/workspace/RealmSection'
import { ProjectViewSwitcher } from '@/components/project/ProjectViewSwitcher'
import { SpaceView } from '@/components/project/SpaceView'
import type { WorkspaceGroup } from './WorkspaceDashboard'
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
  initialWorkspaces?: Array<{ groupId: string; groupName: string; groupColor: string | null; groupIcon: string | null; isPersonal: boolean; memberCount: number; ownerId: string; memberRole: string; projects: Array<Record<string, unknown>> }>
  initialShared?: Array<Record<string, unknown>>
}

function mapWorkspaces(wsData: NonNullable<DashboardContentProps['initialWorkspaces']>, userId: string): WorkspaceGroup[] {
  const mapped: WorkspaceGroup[] = wsData.map((g) => ({
    groupId: g.groupId,
    groupName: g.groupName,
    groupColor: g.groupColor ?? 'purple',
    groupIcon: g.groupIcon ?? null,
    isPersonal: g.isPersonal,
    memberCount: g.memberCount,
    isOwner: g.ownerId === userId || g.memberRole === 'owner',
    projects: g.projects.map((p) => ({ ...p, totalTasks: 0, doneTasks: 0, completionPct: 0 })) as ProjectWithStats[],
  }))
  const personal = mapped.filter((g) => g.isPersonal)
  const team = mapped.filter((g) => !g.isPersonal).sort((a, b) => a.groupName.localeCompare(b.groupName))
  return [...personal, ...team]
}

export default function DashboardContent({ user, projects: initialProjects, initialWorkspaces, initialShared }: DashboardContentProps) {
  const { collapsed, activeRealmId, hiddenProjectIds, hiddenRealmIds } = useSidebarStore()
  const [workspaces, setWorkspaces] = useState<WorkspaceGroup[]>(() =>
    initialWorkspaces ? mapWorkspaces(initialWorkspaces, user.id) : []
  )
  const [sharedProjects, setSharedProjects] = useState<ProjectWithStats[]>(() =>
    initialShared ? initialShared.map((p) => ({ ...p, totalTasks: 0, doneTasks: 0, completionPct: 0 }) as ProjectWithStats) : []
  )
  const [loaded, setLoaded] = useState(!!initialWorkspaces)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectWithStats | null>(null)
  const [sharingProject, setSharingProject] = useState<ProjectWithStats | null>(null)
  const [workspaceSettingsId, setWorkspaceSettingsId] = useState<{ id: string; name: string; color?: string; icon?: string | null; isOwner: boolean; isPersonal: boolean } | null>(null)
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const existingGroups = [...new Set(initialProjects.map((p) => p.group).filter((g): g is string => !!g && g !== 'General'))].sort()

  const [view, setView] = useViewPreference()
  const [gridLayout, setGridLayout] = useState<'scroll' | 'wrap'>('wrap')
  const workspaceInitRef = useRef(false)
  const fetchGenRef = useRef(0)

  const loadWorkspaces = useCallback(async () => {
    const gen = ++fetchGenRef.current
    const [wsData, sharedData] = await Promise.all([
      getWorkspaceProjects(),
      getSharedProjects(),
    ])

    if (gen !== fetchGenRef.current) return

    setWorkspaces(mapWorkspaces(wsData, user.id))
    setSharedProjects(sharedData.map((p) => ({ ...p, totalTasks: 0, doneTasks: 0, completionPct: 0 })) as ProjectWithStats[])
    setLoaded(true)
  }, [user.id])

  const realms: RealmInfo[] = useMemo(() =>
    workspaces.map((ws) => ({ id: ws.groupId, name: ws.groupName, color: ws.groupColor, isPersonal: ws.isPersonal })),
    [workspaces]
  )

  const sidebarRealms = useMemo(() =>
    workspaces
      .filter((ws) => !ws.isPersonal && !hiddenRealmIds.includes(ws.groupId))
      .map((ws) => ({
        id: ws.groupId,
        name: ws.groupName,
        color: ws.groupColor,
        icon: ws.groupIcon,
        isPersonal: ws.isPersonal,
        isOwner: ws.isOwner,
        projectCount: ws.projects.filter((p) => !hiddenProjectIds.includes(p.id)).length,
        memberCount: ws.memberCount,
      })),
    [workspaces, hiddenRealmIds, hiddenProjectIds]
  )

  const projectRealmMap: Record<string, string[]> = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const ws of workspaces) {
      if (ws.isPersonal) continue
      for (const p of ws.projects) {
        if (!map[p.id]) map[p.id] = []
        map[p.id].push(ws.groupId)
      }
    }
    return map
  }, [workspaces])

  const handleToggleRealm = useCallback(async (projectId: string, realmId: string) => {
    const ws = workspaces.find((w) => w.groupId === realmId)
    if (!ws) return
    const isCurrentlyIn = ws.projects.some((p) => p.id === projectId)

    if (isCurrentlyIn) {
      setWorkspaces((prev) => prev.map((w) =>
        w.groupId === realmId ? { ...w, projects: w.projects.filter((p) => p.id !== projectId) } : w
      ))
      try {
        await removeProjectFromGroup(projectId, realmId)
      } catch {
        loadWorkspaces()
      }
    } else {
      const allProjects = workspaces.flatMap((w) => w.projects)
      const project = allProjects.find((p) => p.id === projectId) || sharedProjects.find((p) => p.id === projectId)
      if (!project) return
      setWorkspaces((prev) => prev.map((w) =>
        w.groupId === realmId ? { ...w, projects: [...w.projects, project] } : w
      ))
      try {
        await addProjectToGroup(projectId, realmId)
      } catch {
        loadWorkspaces()
      }
    }
  }, [workspaces, sharedProjects, loadWorkspaces])

  useEffect(() => {
    if (workspaceInitRef.current) return
    workspaceInitRef.current = true
    if (initialWorkspaces) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([ensurePersonalWorkspace(), loadWorkspaces()])
      .catch((err) => console.error('Workspace setup failed:', err))
  }, [loadWorkspaces, initialWorkspaces])

  useEffect(() => {
    if (!loaded) return
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        loadWorkspaces().catch(() => {})
      }
    }
    const interval = setInterval(refresh, 10_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [loaded, loadWorkspaces])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key.toLowerCase() === 'n' && !showCreateModal && !editingProject && !sharingProject) {
        e.preventDefault()
        setShowCreateModal(true)
      }
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        e.preventDefault()
        if (num === 1) {
          useSidebarStore.getState().setActiveRealm(null)
        } else {
          const realm = sidebarRealms[num - 2]
          if (realm) useSidebarStore.getState().setActiveRealm(realm.id)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showCreateModal, editingProject, sharingProject, sidebarRealms])

  const handleWorkspaceCreate = async (name: string, color?: string, icon?: string) => {
    await createGroup({ name, color, icon })
    await loadWorkspaces()
  }

  const activeRealm = activeRealmId ? workspaces.find((w) => w.groupId === activeRealmId) : null
  const activeRealmName = activeRealm?.groupName ?? (activeRealmId ? undefined : 'All Realms')

  const visibleWorkspaces = useMemo(() => {
    if (!activeRealmId) return workspaces
    return workspaces.filter((ws) => ws.groupId === activeRealmId)
  }, [workspaces, activeRealmId])

  const realmSections = useMemo(() =>
    visibleWorkspaces
      .filter((ws) => !ws.isPersonal && !hiddenRealmIds.includes(ws.groupId))
      .map((ws) => ({ ...ws, projects: ws.projects.filter((p) => !hiddenProjectIds.includes(p.id)) })),
    [visibleWorkspaces, hiddenRealmIds, hiddenProjectIds]
  )

  const generalProjects = useMemo(() => {
    const personalWs = workspaces.find((ws) => ws.isPersonal)
    if (!personalWs) return sharedProjects.filter((p) => !hiddenProjectIds.includes(p.id))
    const assignedIds = new Set(
      workspaces.filter((ws) => !ws.isPersonal).flatMap((ws) => ws.projects.map((p) => p.id))
    )
    const unassigned = personalWs.projects.filter((p) => !assignedIds.has(p.id) && !hiddenProjectIds.includes(p.id))
    const shared = sharedProjects.filter((p) => !hiddenProjectIds.includes(p.id)).map((p) => ({ ...p, group: 'Shared with me' }))
    return [...unassigned, ...shared]
  }, [workspaces, sharedProjects, hiddenProjectIds])

  const hasProjects = workspaces.some((ws) => ws.projects.length > 0) || initialProjects.length > 0

  return (
    <div className="h-screen flex overflow-hidden">
      <GlassStage
        blobConfig={{
          blobs: [
            { position: 'top-[10%] right-[15%]', size: 'w-[500px] h-[500px]', color: 'glow', opacity: 0.12 },
            { position: 'bottom-[20%] left-[10%]', size: 'w-[400px] h-[400px]', color: 'primary', opacity: 0.08, delay: 7 },
          ]
        }}
      />

      <AppSidebar
        user={user}
        realms={sidebarRealms}
        onCreateProject={() => setShowCreateModal(true)}
        onCreateWorkspace={() => setShowCreateWorkspace(true)}
        onOpenSettings={(realm) => setWorkspaceSettingsId(realm)}
        onSignOut={() => signOut({ callbackUrl: '/' })}
      />

      <div
        className="flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300"
        style={{ marginLeft: collapsed ? 60 : 260 }}
      >
        <TopBar
          activeRealmName={activeRealmName}
          view={view}
          onViewChange={setView}
          gridLayout={gridLayout}
          onGridLayoutChange={setGridLayout}
          sidebarCollapsed={collapsed}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-6 py-4 relative z-10">
          {loaded && (
            <div className="flex flex-col gap-3 mb-4">
              <EodReflectionCard />
              <DailyBriefingCard />
            </div>
          )}
          {!loaded ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--text-dim)]">Loading realms...</div>
          ) : !hasProjects ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]"
            >
              <p className="text-[var(--text-muted)] mb-1">No projects yet</p>
              <p className="text-sm text-[var(--text-dim)] mb-6">Create your first project to get started</p>
              <NeonButton glowIntensity="md" onClick={() => setShowCreateModal(true)}>
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create First Project
                </span>
              </NeonButton>
            </motion.div>
          ) : view === 'space' ? (
            <SpaceView
              projects={[
                ...realmSections.flatMap((ws) => ws.projects.map((p) => ({ ...p, group: ws.groupName }))),
                ...(!activeRealmId ? generalProjects : []),
              ]}
            />
          ) : (
            <div className="space-y-6">
              {realmSections.map((ws) => (
                <RealmSection
                  key={ws.groupId}
                  realm={{
                    id: ws.groupId,
                    name: ws.groupName,
                    color: ws.groupColor,
                    isPersonal: false,
                    isOwner: ws.isOwner,
                    memberCount: ws.memberCount,
                    projectCount: ws.projects.length,
                  }}
                  defaultExpanded
                  onOpenSettings={(r) => setWorkspaceSettingsId(r)}
                >
                  <ProjectViewSwitcher
                    projects={ws.projects.map((p) => ({ ...p, group: null }))}
                    onEdit={setEditingProject}
                    onDelete={() => loadWorkspaces().catch(() => {})}
                    onShare={setSharingProject}
                    onGroupChange={() => loadWorkspaces().catch(() => {})}
                    realms={realms}
                    projectRealmMap={projectRealmMap}
                    onToggleRealm={handleToggleRealm}
                    view={view}
                    onViewChange={setView}
                    layout={gridLayout}
                    onLayoutChange={setGridLayout}
                  />
                </RealmSection>
              ))}

              {generalProjects.length > 0 && !activeRealmId && (
                <RealmSection
                  realm={{
                    id: 'general',
                    name: 'General',
                    color: 'rgba(148, 163, 184, 0.7)',
                    isPersonal: false,
                    isOwner: true,
                    memberCount: 1,
                    projectCount: generalProjects.length,
                  }}
                  defaultExpanded
                  onOpenSettings={null}
                >
                  <ProjectViewSwitcher
                    projects={generalProjects}
                    onEdit={setEditingProject}
                    onDelete={() => loadWorkspaces().catch(() => {})}
                    onShare={setSharingProject}
                    onGroupChange={() => loadWorkspaces().catch(() => {})}
                    realms={realms}
                    projectRealmMap={projectRealmMap}
                    onToggleRealm={handleToggleRealm}
                    view={view}
                    onViewChange={setView}
                    layout={gridLayout}
                    onLayoutChange={setGridLayout}
                  />
                </RealmSection>
              )}
            </div>
          )}
        </main>
      </div>

      <CreateProjectModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} realms={realms} onProjectCreated={loadWorkspaces} />
      {editingProject && (
        <EditProjectModal
          isOpen={true}
          project={editingProject}
          onClose={() => setEditingProject(null)}
          existingGroups={existingGroups}
          realms={realms}
          projectRealmIds={projectRealmMap[editingProject.id] ?? []}
          onRealmToggled={loadWorkspaces}
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
          groupColor={workspaceSettingsId.color}
          groupIcon={workspaceSettingsId.icon}
          isOwner={workspaceSettingsId.isOwner}
          isPersonal={workspaceSettingsId.isPersonal}
          currentUserId={user.id}
          onClose={() => setWorkspaceSettingsId(null)}
          onUpdated={loadWorkspaces}
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
