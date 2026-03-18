'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Plus, LogOut, Eye, Crown, FolderOpen, Calendar, LayoutGrid, Trash2, Pencil } from 'lucide-react'
import Image from 'next/image'
import aeonLogo from '@/assets/aeon.png'
import Link from 'next/link'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { GlowCard } from '@/components/ui/GlowCard'
import { NeonButton } from '@/components/ui/NeonButton'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { EditProjectModal } from '@/components/project/EditProjectModal'
import { deleteProject } from '@/lib/actions/projects'
import { GlassStage } from '@/components/ui/GlassStage'
import { useThemeStore } from '@/stores/themeStore'
import { ACCENT_COLORS, type AccentColor, colorConfig } from '@/lib/utils/colors'
import { cn } from '@/lib/utils/cn'
import type { Project } from '@/lib/db/schema'

interface DashboardContentProps {
  user: {
    id: string
    role: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
  projects: Project[]
}

export default function DashboardContent({ user, projects }: DashboardContentProps) {
  const router = useRouter()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const isAdmin = user.role === 'admin'
  const { glowIntensity, projectColors, setProjectColor, shortcuts } = useThemeStore()
  const mult = glowIntensity / 75
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)
  const [colorPickerProjectId, setColorPickerProjectId] = useState<string | null>(null)
  const projectListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = projectListRef.current
    if (!el) return
    const onOver = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest('[data-project-id]')
      setHoveredProjectId(card?.getAttribute('data-project-id') ?? null)
    }
    const onLeave = () => setHoveredProjectId(null)
    el.addEventListener('mouseover', onOver)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mouseover', onOver)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key.toLowerCase() === (shortcuts?.changeGlow ?? 'g') && hoveredProjectId) {
        e.preventDefault()
        setColorPickerProjectId((prev) => prev === hoveredProjectId ? null : hoveredProjectId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hoveredProjectId, shortcuts])

  const handleColorChange = useCallback((projectId: string, color: string) => {
    setProjectColor(projectId, color)
    setColorPickerProjectId(null)
  }, [setProjectColor])

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Delete this project? All tasks will be permanently removed.')) return
    await deleteProject(projectId)
    router.refresh()
  }

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

      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
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
          </div>
          <div className="flex items-center gap-4">
            <SettingsButton />
            <div className="flex items-center gap-3 pl-4 border-l border-white/10">
              {user.image && (
                <img
                  src={user.image}
                  alt=""
                  className="w-8 h-8 rounded-full border border-white/20"
                  style={{
                    boxShadow: glowIntensity > 0
                      ? `0 0 ${10 * mult}px ${2 * mult}px var(--glow-color)`
                      : undefined,
                  }}
                />
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

      <main className="px-6 py-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome back, {user.name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-[var(--text-muted)]">
            Manage your projects and timelines
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex flex-wrap gap-4 mb-10"
        >
          <div onClick={() => setShowCreateModal(true)} className="w-64">
            <GlowCard accentColor="purple" glowIntensity="sm" showAccentLine hover>
              <div className="flex items-center gap-3 p-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/15">
                  <Plus className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">New Project</h3>
                  <p className="text-xs text-[var(--text-dim)]">Create timeline & board</p>
                </div>
              </div>
            </GlowCard>
          </div>

          <Link href="/demo" className="w-64">
            <GlowCard accentColor="cyan" glowIntensity="sm" showAccentLine hover>
              <div className="flex items-center gap-3 p-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-500/15">
                  <Eye className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">View Demo</h3>
                  <p className="text-xs text-[var(--text-dim)]">Explore sample project</p>
                </div>
              </div>
            </GlowCard>
          </Link>

          <div className="w-64">
          <GlowCard accentColor="green" glowIntensity="sm" showAccentLine>
            <div className="flex items-center gap-3 p-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/15">
                <FolderOpen className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">{projects.length} Project{projects.length !== 1 ? 's' : ''}</h3>
                <p className="text-xs text-[var(--text-dim)]">{projects.length === 0 ? 'Get started below' : 'Active'}</p>
              </div>
            </div>
          </GlowCard>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <h2 className="text-lg font-semibold text-white mb-4">Your Projects</h2>

          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]">
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="mb-4"
              >
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-8 h-8 text-[var(--primary)] opacity-40" />
                    <LayoutGrid className="w-8 h-8 text-[var(--accent)] opacity-40" />
                  </div>
                  <div
                    className="absolute inset-0 blur-xl opacity-30"
                    style={{ background: 'var(--glow-color)' }}
                  />
                </div>
              </motion.div>
              <p className="text-[var(--text-muted)] mb-1">No projects yet</p>
              <p className="text-sm text-[var(--text-dim)] mb-6">Create your first project to get started</p>
              <NeonButton color="purple" glowIntensity="md" onClick={() => setShowCreateModal(true)}>
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create First Project
                </span>
              </NeonButton>
            </div>
          ) : (
            <div ref={projectListRef} className="flex flex-wrap gap-4">
              {projects.map((project) => {
                const projectColor = (projectColors[project.id] || 'purple') as AccentColor
                return (
                  <div key={project.id} className="relative w-72" data-project-id={project.id}>
                    <Link href={`/project/${project.id}`}>
                      <GlowCard accentColor={projectColor} glowIntensity="sm" showAccentLine hover>
                        <div className="p-3">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="text-sm font-semibold text-white truncate">{project.name}</h3>
                            <div className="flex items-center gap-0.5">
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingProject(project) }}
                                className="p-1.5 rounded-lg text-[var(--text-dim)] hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={(e) => handleDelete(e, project.id)}
                                className="p-1.5 rounded-lg text-[var(--text-dim)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </motion.button>
                            </div>
                          </div>
                          {project.description && (
                            <p className="text-xs text-[var(--text-dim)] mt-1 line-clamp-2">{project.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-3 text-xs text-[var(--text-muted)]">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(project.startDate).toLocaleDateString()}
                            </span>
                            <span className="text-[var(--text-dim)]">-</span>
                            <span>{new Date(project.endDate).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </GlowCard>
                    </Link>
                    {colorPickerProjectId === project.id && (
                      <div className="absolute top-full left-0 mt-2 z-50 p-3 rounded-xl backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.6)]">
                        <div className="flex gap-2">
                          {ACCENT_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => handleColorChange(project.id, c)}
                              className={cn(
                                'w-7 h-7 rounded-full border-2 transition-all hover:scale-110',
                                projectColor === c ? 'border-white scale-110' : 'border-transparent'
                              )}
                              style={{ backgroundColor: colorConfig[c].hex }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>
      </main>

      <CreateProjectModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      {editingProject && (
        <EditProjectModal
          isOpen={true}
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />
      )}
    </div>
  )
}
