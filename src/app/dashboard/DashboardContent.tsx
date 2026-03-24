'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Plus, LogOut, Eye, Crown, FolderOpen } from 'lucide-react'
import Image from 'next/image'
import aeonLogo from '@/assets/aeon.png'
import Link from 'next/link'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { GlowCard } from '@/components/ui/GlowCard'
import { NeonButton } from '@/components/ui/NeonButton'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { EditProjectModal } from '@/components/project/EditProjectModal'
import { ProjectViewSwitcher } from '@/components/project/ProjectViewSwitcher'
import { GlassStage } from '@/components/ui/GlassStage'
import { useThemeStore } from '@/stores/themeStore'
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

export default function DashboardContent({ user, projects }: DashboardContentProps) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectWithStats | null>(null)
  const isAdmin = user.role === 'admin'
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const existingGroups = [...new Set(projects.map((p) => p.group).filter((g): g is string => !!g && g !== 'General'))].sort()

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
        <div className="px-3 sm:px-6 py-3 flex items-center justify-between">
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
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <HelpButton />
            <SettingsButton />
            <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-4 border-l border-white/10">
              {user.image ? (
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

      <main className="px-3 sm:px-6 py-4 sm:py-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-wrap gap-4 mb-6"
        >
          <div onClick={() => setShowCreateModal(true)} className="w-full sm:w-64">
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

          <Link href="/demo" className="w-full sm:w-64">
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

          <div className="w-full sm:w-64">
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
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]">
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
            <ProjectViewSwitcher projects={projects} onEdit={setEditingProject} />
          )}
        </motion.div>
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
    </div>
  )
}
