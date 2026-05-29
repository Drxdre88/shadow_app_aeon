'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import aeonLogo from '@/assets/aeon.png'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { cn } from '@/lib/utils/cn'
import { motion, AnimatePresence } from 'framer-motion'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { StatsButton } from '@/components/ui/StatsModal'
import { BetaFeaturesButton } from '@/components/ui/BetaFeaturesModal'
import { ChangelogButton } from '@/components/ui/ChangelogModal'
import { AdvisoryFeed } from '@/components/kairos/AdvisoryFeed'
import { LiveSessionsButton } from '@/components/kairos/LiveSessionsButton'
import { DailyBriefingButton } from '@/components/hyperspace/DailyBriefingButton'
import { EodReflectionButton } from '@/components/hyperspace/EodReflectionButton'
import {
  Plus,
  Orbit,
  LogOut,
  ChevronRight,
  Menu,
  User,
  Eye,
  StickyNote,
  Home,
} from 'lucide-react'
import { RealmList } from '@/components/sidebar/RealmList'
import { KairosSidebarSection } from '@/components/sidebar/KairosSidebarSection'
import { SidebarCreateActions } from '@/components/sidebar/SidebarCreateActions'
import { KairosSidebarContent } from '@/components/sidebar/KairosSidebarContent'

interface AppSidebarProps {
  user: { name?: string | null; email?: string | null; image?: string | null; role: string }
  realms: Array<{
    id: string
    name: string
    color: string
    icon: string | null
    isPersonal: boolean
    isOwner: boolean
    projectCount: number
    memberCount: number
  }>
  onCreateProject?: () => void
  onCreateWorkspace?: () => void
  onOpenSettings?: (realm: { id: string; name: string; color?: string; icon?: string | null; isOwner: boolean; isPersonal: boolean }) => void
  onSignOut: () => void
}

export function AppSidebar({
  user,
  realms,
  onCreateProject,
  onCreateWorkspace,
  onOpenSettings,
  onSignOut,
}: AppSidebarProps) {
  const colors = useThemeStore((s) => s.colors)
  const { collapsed, activeRealmId, toggleCollapsed, setActiveRealm, maybeAutoCollapseForViewport } = useSidebarStore()
  const pathname = usePathname()
  const onKairos = pathname?.startsWith('/kairos') ?? false

  useEffect(() => {
    maybeAutoCollapseForViewport()
  }, [maybeAutoCollapseForViewport])

  const glowColor = colors?.glow ?? 'rgba(139, 92, 246, 0.4)'

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
      <Header
        collapsed={collapsed}
        glowColor={glowColor}
        onToggle={toggleCollapsed}
        onKairos={onKairos}
      />

      <HomeSection collapsed={collapsed} glowColor={glowColor} pathname={pathname} />

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 scrollbar-none">
        {onKairos ? (
          <KairosSidebarContent collapsed={collapsed} />
        ) : (
          <RealmList
            realms={realms}
            activeRealmId={activeRealmId}
            collapsed={collapsed}
            onSelect={setActiveRealm}
            onOpenSettings={onOpenSettings ?? (() => {})}
          />
        )}
      </nav>

      <KairosSidebarSection collapsed={collapsed} />

      {onCreateProject && onCreateWorkspace ? (
        <ActionButtons
          collapsed={collapsed}
          glowColor={glowColor}
          onCreateProject={onCreateProject}
          onCreateWorkspace={onCreateWorkspace}
        />
      ) : (
        <SidebarCreateActions collapsed={collapsed} />
      )}

      <BottomSection
        user={user}
        collapsed={collapsed}
        onSignOut={onSignOut}
      />
    </aside>
  )
}

function Header({
  collapsed,
  glowColor,
  onToggle,
  onKairos,
}: {
  collapsed: boolean
  glowColor: string
  onToggle: () => void
  onKairos: boolean
}) {
  return (
    <div className="shrink-0 flex flex-col">
      <div
        className={cn(
          'flex items-center justify-between px-4 py-4',
          collapsed && 'px-2 py-3 justify-center'
        )}
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
      >
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2 }}
              className="text-xl font-bold tracking-[0.35em] flex items-baseline gap-1"
              style={{ color: 'var(--primary)' }}
            >
              <span style={{ textShadow: `0 0 20px ${glowColor}, 0 0 40px ${glowColor}` }}>AEON</span>
              {onKairos && (
                <>
                  <span style={{ opacity: 0.5 }}>:</span>
                  <motion.span
                    animate={{
                      textShadow: [
                        `0 0 8px ${glowColor}, 0 0 16px ${glowColor}`,
                        `0 0 20px ${glowColor}, 0 0 36px ${glowColor}, 0 0 56px ${glowColor}`,
                        `0 0 8px ${glowColor}, 0 0 16px ${glowColor}`,
                      ],
                    }}
                    transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    KAIROS
                  </motion.span>
                </>
              )}
            </motion.span>
          )}
        </AnimatePresence>
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
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <Menu className="w-4 h-4" />
        )}
      </button>
    </div>

      <div className={cn('flex justify-center py-4', collapsed && 'py-2')}>
        <motion.div
          whileHover={{ scale: 1.05 }}
          className="relative rounded-2xl overflow-hidden shrink-0"
          style={{
            width: collapsed ? 40 : 90,
            height: collapsed ? 40 : 90,
            border: '2px solid var(--primary)',
            boxShadow: `0 0 25px ${glowColor}, 0 0 50px ${glowColor}`,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <Image
            src={aeonLogo}
            alt="Aeon"
            fill
            className="object-cover"
            priority
          />
        </motion.div>
      </div>

      <div className="mx-3 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.3 }} />
    </div>
  )
}

function ActionButtons({
  collapsed,
  glowColor,
  onCreateProject,
  onCreateWorkspace,
}: {
  collapsed: boolean
  glowColor: string
  onCreateProject: () => void
  onCreateWorkspace: () => void
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 px-2 py-3', collapsed && 'items-center')}>
      <ActionButton
        icon={<Plus className="w-3.5 h-3.5 shrink-0" />}
        label="New Project"
        collapsed={collapsed}
        glowColor={glowColor}
        onClick={onCreateProject}
      />
      <ActionButton
        icon={<Orbit className="w-3.5 h-3.5 shrink-0" />}
        label="New Realm"
        collapsed={collapsed}
        glowColor={glowColor}
        onClick={onCreateWorkspace}
        variant="subtle"
      />
    </div>
  )
}

function ActionButton({
  icon,
  label,
  collapsed,
  glowColor,
  onClick,
  variant = 'primary',
}: {
  icon: React.ReactNode
  label: string
  collapsed: boolean
  glowColor: string
  onClick: () => void
  variant?: 'primary' | 'subtle'
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg text-xs font-semibold transition-all duration-200',
        collapsed ? 'w-9 h-9 justify-center p-0' : 'w-full px-3 py-2',
        variant === 'primary'
          ? 'bg-white/[0.08] hover:bg-white/[0.14] text-white/70 hover:text-white'
          : 'text-white/40 hover:text-white/70 hover:bg-white/[0.06]'
      )}
      style={
        variant === 'primary'
          ? { boxShadow: `0 0 0 1px rgba(255,255,255,0.08), 0 2px 12px rgba(0,0,0,0.3)` }
          : undefined
      }
    >
      {icon}
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="whitespace-nowrap overflow-hidden"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

function BottomSection({
  user,
  collapsed,
  onSignOut,
}: {
  user: AppSidebarProps['user']
  collapsed: boolean
  onSignOut: () => void
}) {
  return (
    <div className="shrink-0">
      <div className="mx-2 h-px bg-white/[0.06]" />
      {collapsed ? (
        <div className="flex flex-col items-center justify-center gap-1 px-2 py-2" style={{ color: 'var(--primary)' }}>
          <NotesButton />
          <DailyBriefingButton />
          <AdvisoryFeed />
          <EodReflectionButton />
          <LiveSessionsButton />
          <ChangelogButton />
          <BetaFeaturesButton />
          <HelpButton />
          <StatsButton />
          <SettingsButton />
          <UnhideButton collapsed={collapsed} />
        </div>
      ) : (
        <div className="px-2 py-2" style={{ color: 'var(--primary)' }}>
          <div className="flex items-center justify-center gap-1">
            <NotesButton />
            <DailyBriefingButton />
            <AdvisoryFeed />
            <EodReflectionButton />
            <LiveSessionsButton />
          </div>
          <div
            className="my-1.5 h-px mx-6"
            style={{
              background:
                'linear-gradient(to right, transparent, color-mix(in oklab, var(--primary) 55%, transparent), transparent)',
              boxShadow:
                '0 0 6px color-mix(in oklab, var(--primary) 40%, transparent)',
            }}
          />
          <div className="flex items-center justify-center gap-1">
            <ChangelogButton />
            <BetaFeaturesButton />
            <HelpButton />
            <StatsButton />
            <SettingsButton />
            <UnhideButton collapsed={collapsed} />
          </div>
        </div>
      )}
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

function HomeSection({ collapsed, glowColor, pathname }: { collapsed: boolean; glowColor: string; pathname: string | null }) {
  const isHome = pathname === '/dashboard' || pathname?.startsWith('/dashboard') || false
  return (
    <div className={cn('px-2 pt-2 shrink-0', collapsed && 'px-1.5')}>
      <Link
        href="/dashboard"
        title="Home — your dashboard"
        className={cn(
          'group relative flex items-center gap-2.5 rounded-xl transition-all duration-200 overflow-hidden',
          collapsed ? 'w-9 h-9 justify-center mx-auto' : 'w-full px-3 py-2.5',
        )}
        style={{
          background: isHome
            ? 'linear-gradient(135deg, color-mix(in oklab, var(--primary) 28%, transparent), color-mix(in oklab, var(--primary) 8%, transparent))'
            : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))',
          border: isHome
            ? '1px solid color-mix(in oklab, var(--primary) 55%, transparent)'
            : '1px solid rgba(255,255,255,0.08)',
          boxShadow: isHome
            ? `0 0 18px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.08)`
            : 'inset 0 1px 0 rgba(255,255,255,0.04)',
          color: isHome ? 'var(--primary)' : 'rgba(255,255,255,0.78)',
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle at 0% 50%, color-mix(in oklab, var(--primary) 20%, transparent), transparent 60%)`,
          }}
        />
        <Home className="w-4 h-4 shrink-0 relative" style={{ filter: isHome ? `drop-shadow(0 0 6px ${glowColor})` : 'none' }} />
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.18 }}
              className="text-xs font-semibold tracking-[0.16em] uppercase relative"
            >
              Home
            </motion.span>
          )}
        </AnimatePresence>
        {!collapsed && (
          <span
            aria-hidden
            className="ml-auto w-1.5 h-1.5 rounded-full relative"
            style={{
              background: isHome ? 'var(--primary)' : 'transparent',
              boxShadow: isHome ? `0 0 8px ${glowColor}` : 'none',
            }}
          />
        )}
      </Link>
      <div
        className="mt-2 mx-1 h-px"
        style={{
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.10), transparent)',
        }}
      />
    </div>
  )
}

function NotesButton() {
  return (
    <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
      <Link
        href="/notes"
        title="Notes — your memory bento"
        className="block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <StickyNote className="w-4 h-4" />
      </Link>
    </motion.div>
  )
}

function UnhideButton({ collapsed }: { collapsed: boolean }) {
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
