'use client'

import { signOut } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Sparkles, Plus, LogOut, Eye, Crown, FolderOpen, Calendar, LayoutGrid } from 'lucide-react'
import Link from 'next/link'
import { ThemeSelector } from '@/components/ui/ThemeSelector'
import { GlowCard } from '@/components/ui/GlowCard'
import { NeonButton } from '@/components/ui/NeonButton'
import { useThemeStore } from '@/stores/themeStore'

interface DashboardContentProps {
  user: {
    id: string
    role: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

export default function DashboardContent({ user }: DashboardContentProps) {
  const isAdmin = user.role === 'admin'
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute top-[10%] right-[15%] w-[500px] h-[500px] rounded-full blur-[120px] animate-glow-breathe"
          style={{ background: 'var(--glow-color)', opacity: 0.08 }}
        />
        <div
          className="absolute bottom-[20%] left-[10%] w-[400px] h-[400px] rounded-full blur-[100px] animate-glow-breathe"
          style={{ background: 'var(--primary)', opacity: 0.06, animationDelay: '3s' }}
        />
      </div>

      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-[var(--primary)]" />
            <span className="text-xl font-bold text-white">Aeon</span>
            {isAdmin && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                <Crown className="w-3 h-3" />
                Admin
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <ThemeSelector />
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

      <main className="max-w-7xl mx-auto px-4 py-8 relative z-10">
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
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10"
        >
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

          <Link href="/demo">
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

          <GlowCard accentColor="green" glowIntensity="sm" showAccentLine>
            <div className="flex items-center gap-3 p-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/15">
                <FolderOpen className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">0 Projects</h3>
                <p className="text-xs text-[var(--text-dim)]">Get started below</p>
              </div>
            </div>
          </GlowCard>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <h2 className="text-lg font-semibold text-white mb-4">Your Projects</h2>
          <div
            className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]"
          >
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
            <NeonButton color="purple" glowIntensity="md">
              <span className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Create First Project
              </span>
            </NeonButton>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
