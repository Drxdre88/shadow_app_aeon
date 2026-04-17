'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { cn } from '@/lib/utils/cn'
import { motion, AnimatePresence } from 'framer-motion'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { StatsButton } from '@/components/ui/StatsModal'
import { BetaFeaturesButton } from '@/components/ui/BetaFeaturesModal'
import { getSiblingProjects } from '@/lib/actions/projects'
import {
  LayoutGrid,
  Calendar,
  Lightbulb,
  Trophy,
  Activity,
  LogOut,
  ChevronRight,
  Menu,
  User,
  ArrowLeft,
  Eye,
  Folder,
} from 'lucide-react'

type ViewTab = 'board' | 'gantt' | 'canvas' | 'trophy' | 'velocity'

interface ProjectSidebarProps {
  projectId: string
  user: { name?: string | null; email?: string | null; image?: string | null; role: string }
  activeTab: ViewTab
  onTabChange: (tab: ViewTab) => void
  onSignOut: () => void
}

const VIEW_TABS = [
  { id: 'board' as const, icon: LayoutGrid, label: 'Board' },
  { id: 'gantt' as const, icon: Calendar, label: 'Gantt' },
  { id: 'canvas' as const, icon: Lightbulb, label: 'Canvas' },
  { id: 'trophy' as const, icon: Trophy, label: 'Trophy' },
  { id: 'velocity' as const, icon: Activity, label: 'Velocity' },
]

export function ProjectSidebar({ projectId, user, activeTab, onTabChange, onSignOut }: ProjectSidebarProps) {
  const colors = useThemeStore((s) => s.colors)
  const { collapsed, toggleCollapsed } = useSidebarStore()
  const [siblings, setSiblings] = useState<{ realmName: string | null; projects: { id: string; name: string; planetImage: string | null }[] }>({ realmName: null, projects: [] })
  const router = useRouter()

  const glowColor = colors?.glow ?? 'rgba(139, 92, 246, 0.4)'

  useEffect(() => {
    getSiblingProjects(projectId)
      .then(setSiblings)
      .catch(() => setSiblings({ realmName: null, projects: [] }))
  }, [projectId])

  return (
    <aside
      className="fixed top-0 left-0 flex flex-col h-screen shrink-0 overflow-hidden z-30"
      style={{
        width: collapsed ? 60 : 260,
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        background: 'rgba(10, 10, 15, 0.85)',
        backdropFilter: 'blur(24px)',
        borderRight: '1px solid rgba(255, 255, 255, 0.06)',
        boxShadow: '4px 0 30px rgba(0, 0, 0, 0.5)',
      }}
    >
      <ProjectSidebarHeader collapsed={collapsed} glowColor={glowColor} onToggle={toggleCollapsed} />

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 scrollbar-none">
        <div className="flex flex-col gap-0.5">
          {!collapsed && (
            <span className="text-[9px] font-semibold uppercase tracking-widest px-2 py-1" style={{ color: 'var(--primary)', opacity: 0.5 }}>
              Views
            </span>
          )}
          {VIEW_TABS.map(({ id, icon: Icon, label }) => {
            const isActive = activeTab === id
            return (
              <motion.button
                key={id}
                whileTap={{ scale: 0.97 }}
                onClick={() => onTabChange(id)}
                className={cn(
                  'group relative w-full flex items-center gap-2.5 rounded-lg px-2 py-2',
                  'text-left text-sm font-medium overflow-hidden',
                  'transition-all duration-200',
                  isActive
                    ? 'bg-white/[0.08] translate-x-1 text-white'
                    : 'text-white/50 hover:text-white/80 hover:translate-x-0.5',
                  collapsed && 'justify-center px-0'
                )}
                style={
                  isActive
                    ? { borderLeft: '3px solid var(--primary)' }
                    : { borderLeft: '3px solid transparent' }
                }
              >
                <span
                  className={cn(
                    'absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none',
                    'before:absolute before:inset-0 before:translate-x-[-100%] before:group-hover:translate-x-[100%]',
                    'before:bg-gradient-to-r before:from-transparent before:via-white/[0.04] before:to-transparent',
                    'before:transition-transform before:duration-500 before:ease-in-out'
                  )}
                />
                <Icon
                  className="shrink-0 w-3.5 h-3.5"
                  style={{ color: isActive ? 'var(--primary)' : 'rgba(255, 255, 255, 0.3)' }}
                />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-1 truncate min-w-0"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            )
          })}
        </div>

        {!collapsed && siblings.realmName && siblings.projects.length > 0 && (
          <>
            <div className="mx-1 my-3 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.2 }} />
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <Folder className="w-3 h-3" style={{ color: 'var(--primary)', opacity: 0.5 }} />
                <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--primary)', opacity: 0.5 }}>
                  {siblings.realmName}
                </span>
              </div>
              <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
                {siblings.projects.map((p) => (
                  <motion.button
                    key={p.id}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => router.push(`/project/${p.id}`)}
                    className={cn(
                      'group relative w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5',
                      'text-left text-xs overflow-hidden',
                      'transition-all duration-200',
                      'text-white/40 hover:text-white/80 hover:translate-x-0.5 hover:bg-white/[0.04]'
                    )}
                  >
                    <div
                      className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center ring-1 ring-white/10"
                      style={{ background: 'rgba(255, 255, 255, 0.06)' }}
                    >
                      <span className="text-[8px] font-medium text-white/50">{p.name.charAt(0)}</span>
                    </div>
                    <span className="flex-1 truncate min-w-0">{p.name}</span>
                  </motion.button>
                ))}
              </div>
            </div>
          </>
        )}
      </nav>

      <div className="mx-3 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.2 }} />

      <BottomSection user={user} collapsed={collapsed} onSignOut={onSignOut} />
    </aside>
  )
}

function ProjectSidebarHeader({
  collapsed,
  glowColor,
  onToggle,
}: {
  collapsed: boolean
  glowColor: string
  onToggle: () => void
}) {
  return (
    <div className="shrink-0 flex flex-col" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
      <div
        className={cn(
          'flex items-center justify-between px-4 py-4',
          collapsed && 'px-2 py-3 justify-center'
        )}
      >
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2"
            >
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        {collapsed && (
          <Link
            href="/dashboard"
            className="flex items-center justify-center w-7 h-7 rounded-xl text-white/40 hover:text-white/70 transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </Link>
        )}

        <button
          onClick={onToggle}
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-xl',
            'border transition-all duration-300',
            collapsed && 'w-7 h-7'
          )}
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            color: 'var(--primary)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = `0 0 20px ${glowColor}`
            e.currentTarget.style.borderColor = 'var(--primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none'
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
          }}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

function BottomSection({
  user,
  collapsed,
  onSignOut,
}: {
  user: ProjectSidebarProps['user']
  collapsed: boolean
  onSignOut: () => void
}) {
  return (
    <div className="shrink-0">
      <div className="mx-2 h-px bg-white/[0.06]" />
      <div className={cn('flex items-center justify-center gap-1 px-2 py-2', collapsed && 'flex-col')} style={{ color: 'var(--primary)' }}>
        <BetaFeaturesButton />
        <HelpButton />
        <StatsButton />
        <SettingsButton />
        <UnhideButton />
      </div>
      <div className="mx-2 h-px bg-white/[0.06]" />
      <div
        className={cn(
          'flex items-center gap-2.5 px-2 py-3',
          collapsed && 'flex-col gap-1.5 py-2'
        )}
      >
        <div className="shrink-0 w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center bg-white/[0.08] border border-white/[0.1]">
          {user.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={user.image} alt={user.name ?? ''} referrerPolicy="no-referrer" className="w-7 h-7 object-cover" />
          ) : (
            <User className="w-3.5 h-3.5 text-white/40" />
          )}
        </div>

        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 min-w-0 overflow-hidden"
            >
              <p className="text-xs font-medium text-white/70 truncate">
                {user.name ?? user.email ?? 'User'}
              </p>
              <p className="text-[10px] text-white/30 truncate capitalize">{user.role}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={onSignOut}
          className="shrink-0 p-1.5 rounded-lg text-white/30 hover:text-red-400/80 hover:bg-red-500/[0.08] transition-all duration-200"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
        </motion.button>
      </div>
    </div>
  )
}

function UnhideButton() {
  const { hiddenProjectIds, hiddenRealmIds, unhideAll } = useSidebarStore()
  const count = hiddenProjectIds.length + hiddenRealmIds.length
  if (count === 0) return null

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      onClick={unhideAll}
      className="relative p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      title={`${count} hidden item${count > 1 ? 's' : ''} — click to unhide all`}
    >
      <Eye className="w-4 h-4" />
      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] font-bold text-white flex items-center justify-center">
        {count}
      </span>
    </motion.button>
  )
}
