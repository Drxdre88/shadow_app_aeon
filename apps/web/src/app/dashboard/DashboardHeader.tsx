'use client'

import { motion } from 'framer-motion'
import { Plus, LogOut, Crown, LayoutGrid, Rows3, User, Orbit } from 'lucide-react'
import { signOut } from 'next-auth/react'
import Image from 'next/image'
import aeonLogo from '@/assets/aeon.png'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { StatsButton } from '@/components/ui/StatsModal'
import { BetaFeaturesButton } from '@/components/ui/BetaFeaturesModal'
import { VIEW_OPTIONS } from '@/components/project/ProjectViewSwitcher'
import type { ProjectViewMode } from '@/components/project/useViewPreference'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

export type DashboardSection = 'personal' | 'team'

const SECTIONS: { id: DashboardSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'personal', label: 'Personal', icon: User },
  { id: 'team', label: 'Team', icon: Orbit },
]

interface DashboardHeaderProps {
  user: { name?: string | null; email?: string | null; image?: string | null; role: string }
  hasProjects: boolean
  section: DashboardSection
  onSectionChange: (section: DashboardSection) => void
  view: ProjectViewMode
  onViewChange: (view: ProjectViewMode) => void
  gridLayout: 'scroll' | 'wrap'
  onGridLayoutChange: (layout: 'scroll' | 'wrap') => void
  onCreateProject: () => void
  onCreateWorkspace: () => void
}

export function DashboardHeader({
  user, hasProjects, section, onSectionChange,
  view, onViewChange, gridLayout, onGridLayoutChange, onCreateProject, onCreateWorkspace,
}: DashboardHeaderProps) {
  const glowIntensity = useThemeStore((s) => s.glowIntensity)
  const mult = glowIntensity / 75
  const isAdmin = user.role === 'admin'

  return (
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
            onClick={onCreateProject}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 hover:text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCreateWorkspace}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 hover:text-white"
          >
            <Orbit className="w-3.5 h-3.5" />
            New Realm
          </motion.button>

          {hasProjects && (
            <>
              <div className="hidden sm:block h-5 w-px bg-white/10 mx-1" />
              <div className="hidden sm:flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
                {SECTIONS.map((s) => {
                  const Icon = s.icon
                  const isActive = section === s.id
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSectionChange(s.id)}
                      className={cn(
                        'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                        isActive ? 'text-white' : 'text-[var(--text-dim)] hover:text-[var(--text-muted)]'
                      )}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="ws-section-indicator"
                          className="absolute inset-0 bg-white/10 rounded-md border border-white/10"
                          transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                        />
                      )}
                      <Icon className="w-3.5 h-3.5 relative z-10" />
                      <span className="relative z-10 hidden lg:inline">{s.label}</span>
                    </button>
                  )
                })}
              </div>
              <div className="hidden sm:block h-5 w-px bg-white/10 mx-1" />
              <div className="hidden sm:flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
                {VIEW_OPTIONS.map((opt) => {
                  const Icon = opt.icon
                  const isActive = view === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => onViewChange(opt.value)}
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
                    onClick={() => onGridLayoutChange('wrap')}
                    className={cn('p-1.5 rounded-md transition-colors', gridLayout === 'wrap' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300')}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onGridLayoutChange('scroll')}
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
  )
}
