'use client'

import Image from 'next/image'
import aeonLogo from '@/assets/aeon.png'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { cn } from '@/lib/utils/cn'
import { motion, AnimatePresence } from 'framer-motion'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { StatsButton } from '@/components/ui/StatsModal'
import { BetaFeaturesButton } from '@/components/ui/BetaFeaturesModal'
import {
  Plus,
  Orbit,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  User,
} from 'lucide-react'

interface AppSidebarProps {
  user: { name?: string | null; email?: string | null; image?: string | null; role: string }
  realms: Array<{
    id: string
    name: string
    color: string
    isPersonal: boolean
    isOwner: boolean
    projectCount: number
    memberCount: number
  }>
  onCreateProject: () => void
  onCreateWorkspace: () => void
  onOpenSettings: (realm: { id: string; name: string; isOwner: boolean; isPersonal: boolean }) => void
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
  const { colors } = useThemeStore()
  const { collapsed, activeRealmId, toggleCollapsed, setActiveRealm } = useSidebarStore()

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
      />

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 scrollbar-none">
        <RealmList
          realms={realms}
          activeRealmId={activeRealmId}
          collapsed={collapsed}
          onSelect={setActiveRealm}
          onOpenSettings={onOpenSettings}
          user={user}
        />
      </nav>

      <div className="mx-3 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.2 }} />

      <ActionButtons
        collapsed={collapsed}
        glowColor={glowColor}
        onCreateProject={onCreateProject}
        onCreateWorkspace={onCreateWorkspace}
      />

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
}: {
  collapsed: boolean
  glowColor: string
  onToggle: () => void
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
              className="text-xl font-bold tracking-[0.35em]"
              style={{ color: 'var(--primary)', textShadow: `0 0 20px ${glowColor}, 0 0 40px ${glowColor}` }}
            >
              AEON
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

function RealmList({
  realms,
  activeRealmId,
  collapsed,
  onSelect,
  onOpenSettings,
}: {
  realms: AppSidebarProps['realms']
  activeRealmId: string | null
  collapsed: boolean
  onSelect: (id: string | null) => void
  onOpenSettings: AppSidebarProps['onOpenSettings']
  user: AppSidebarProps['user']
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {!collapsed && (
        <span className="text-[9px] font-semibold uppercase tracking-widest px-2 py-1" style={{ color: 'var(--primary)', opacity: 0.5 }}>
          Realms
        </span>
      )}

      <RealmPill
        id={null}
        name="All"
        color="var(--primary)"
        isPersonal={false}
        isTeam={false}
        projectCount={0}
        isActive={activeRealmId === null}
        collapsed={collapsed}
        onSelect={() => onSelect(null)}
        onOpenSettings={null}
      />

      <ul className="flex flex-col gap-0.5">
        {realms.map((realm) => (
          <RealmPill
            key={realm.id}
            id={realm.id}
            name={realm.isPersonal ? 'Personal' : realm.name}
            color={realm.color}
            isPersonal={realm.isPersonal}
            isTeam={!realm.isPersonal && realm.memberCount > 1}
            projectCount={realm.projectCount}
            isActive={activeRealmId === realm.id}
            collapsed={collapsed}
            onSelect={() => onSelect(activeRealmId === realm.id ? null : realm.id)}
            onOpenSettings={() =>
              onOpenSettings({
                id: realm.id,
                name: realm.name,
                isOwner: realm.isOwner,
                isPersonal: realm.isPersonal,
              })
            }
          />
        ))}
      </ul>
    </div>
  )
}

function RealmPill({
  name,
  color,
  isTeam,
  projectCount,
  isActive,
  collapsed,
  onSelect,
  onOpenSettings,
}: {
  id: string | null
  name: string
  color: string
  isPersonal: boolean
  isTeam: boolean
  projectCount: number
  isActive: boolean
  collapsed: boolean
  onSelect: () => void
  onOpenSettings: (() => void) | null
}) {
  return (
    <li>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onSelect}
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
            ? { borderLeft: `3px solid ${color}` }
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

        <span
          className="shrink-0 w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
        />

        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 truncate flex items-center gap-1.5 min-w-0"
            >
              <span className="truncate">{name}</span>
              {isTeam && (
                <span
                  className="shrink-0 text-[8px] font-black tracking-wider px-1.5 py-[1px] rounded-full uppercase"
                  style={{
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.3))',
                    color: 'rgba(167, 139, 250, 0.9)',
                    boxShadow: '0 0 8px rgba(139, 92, 246, 0.3), inset 0 0 4px rgba(139, 92, 246, 0.1)',
                    border: '1px solid rgba(139, 92, 246, 0.2)',
                  }}
                >
                  team
                </span>
              )}
            </motion.span>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!collapsed && projectCount > 0 && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/[0.08] text-white/40"
            >
              {projectCount}
            </motion.span>
          )}
        </AnimatePresence>

        {onOpenSettings && !collapsed && (
          <motion.div
            role="button"
            tabIndex={0}
            initial={{ opacity: 0 }}
            whileHover={{ opacity: 1 }}
            className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/[0.1] text-white/40 hover:text-white/70 transition-all cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              onOpenSettings()
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenSettings() } }}
          >
            <Settings className="w-3 h-3" />
          </motion.div>
        )}
      </motion.button>
    </li>
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
      <div className={cn('flex items-center justify-center gap-1 px-2 py-2', collapsed && 'flex-col')} style={{ color: 'var(--primary)' }}>
        <BetaFeaturesButton />
        <HelpButton />
        <StatsButton />
        <SettingsButton />
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
            <img src={user.image} alt={user.name ?? ''} className="w-7 h-7 object-cover" />
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
