'use client'

import { useState, useEffect } from 'react'
import { signOut } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Plus, LogOut, Crown, LayoutGrid, Rows3 } from 'lucide-react'
import Image from 'next/image'
import aeonLogo from '@/assets/aeon.png'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { StatsButton } from '@/components/ui/StatsModal'
import { BetaFeaturesButton } from '@/components/ui/BetaFeaturesModal'
import { NeonButton } from '@/components/ui/NeonButton'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { getProjectsWithStats } from '@/lib/actions/projects'
import { EditProjectModal } from '@/components/project/EditProjectModal'
import { ProjectViewSwitcher, VIEW_OPTIONS } from '@/components/project/ProjectViewSwitcher'
import { useViewPreference, type ProjectViewMode } from '@/components/project/useViewPreference'
import { ShareModal } from '@/components/board/ShareModal'
import { GlassStage } from '@/components/ui/GlassStage'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
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
  const isAdmin = user.role === 'admin'
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
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

      <header className="sticky top-0 z-40 bg-[#0a0a0c]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="px-3 sm:px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Image
              src={aeonLogo}
              alt="Aeon"
              width={28}
              height={28}
              className="rounded"
              style={{ filter: `drop-shadow(0 0 ${6 * mult}px var(--glow-color))` }}
            />
            <span
              className="text-xl font-bold"
              style={{
                color: '#8a8f98',
                textShadow: '0 0 10px rgba(138, 143, 152, 0.3)',
              }}
            >
              Aeon
            </span>
            {isAdmin && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                <Crown className="w-3 h-3" />
                Admin
              </span>
            )}
            <div className="hidden sm:block h-5 w-px bg-white/10 mx-1" />
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowCreateModal(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 hover:text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              New Project
            </motion.button>

            {projects.length > 0 && (
              <>
                <div className="hidden sm:block h-5 w-px bg-white/10 mx-1" />
                <div className="hidden sm:flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
                  {VIEW_OPTIONS.map((opt) => {
                    const Icon = opt.icon
                    const isActive = view === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setView(opt.value)}
                        className={cn(
                          'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                          isActive ? 'text-white' : 'text-[var(--text-dim)] hover:text-[var(--text-muted)]'
                        )}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="header-view-indicator"
                            className="absolute inset-0 bg-white/10 rounded-md border border-white/10"
                            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                          />
                        )}
                        <Icon className="w-3.5 h-3.5 relative z-10" />
                        <span className="relative z-10 hidden lg:inline">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>

                {view === 'grid' && (
                  <div className="hidden sm:flex items-center gap-0.5 rounded-lg bg-white/[0.04] border border-white/10 p-0.5">
                    <button
                      onClick={() => setGridLayout('wrap')}
                      className={cn('p-1.5 rounded-md transition-colors', gridLayout === 'wrap' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300')}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setGridLayout('scroll')}
                      className={cn('p-1.5 rounded-md transition-colors', gridLayout === 'scroll' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300')}
                    >
                      <Rows3 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <BetaFeaturesButton />
            <StatsButton />
            <HelpButton />
            <SettingsButton />
            <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-4 border-l border-white/10">
              {user.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={user.image}
                  alt={user.name || ''}
                  className="w-8 h-8 rounded-full border border-white/20"
                  style={{
                    boxShadow: glowIntensity > 0
                      ? `0 0 ${10 * mult}px ${2 * mult}px var(--glow-color)`
                      : undefined,
                  }}
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center text-xs font-semibold"
                  style={{
                    background: 'var(--primary-muted)',
                    color: 'var(--text-secondary)',
                    boxShadow: glowIntensity > 0
                      ? `0 0 ${10 * mult}px ${2 * mult}px var(--glow-color)`
                      : undefined,
                  }}
                >
                  {(user.name || user.email || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm text-[var(--text-muted)] hidden sm:block">
                {user.name || user.email}
              </span>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => signOut({ callbackUrl: '/' })}
                className="p-2 rounded-lg text-[var(--text-dim)] hover:text-[var(--error)] hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-6 py-3 relative z-10">
        {projects.length === 0 ? (
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
    </div>
  )
}
