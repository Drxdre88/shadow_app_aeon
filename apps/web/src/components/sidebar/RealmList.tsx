'use client'

import { Orbit, Settings } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { REALM_ICON_MAP } from '@/components/workspace/RealmPickers'

type RealmItem = {
  id: string
  name: string
  color: string
  icon: string | null
  isPersonal: boolean
  isOwner: boolean
  projectCount: number
  memberCount: number
}

type OpenSettingsPayload = {
  id: string
  name: string
  color?: string
  icon?: string | null
  isOwner: boolean
  isPersonal: boolean
}

export function RealmList({
  realms,
  activeRealmId,
  collapsed,
  onSelect,
  onOpenSettings,
}: {
  realms: RealmItem[]
  activeRealmId: string | null
  collapsed: boolean
  onSelect: (id: string | null) => void
  onOpenSettings: (realm: OpenSettingsPayload) => void
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
        icon={null}
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
            icon={realm.icon}
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
                color: realm.color,
                icon: realm.icon,
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
  icon,
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
  icon: string | null
  isPersonal: boolean
  isTeam: boolean
  projectCount: number
  isActive: boolean
  collapsed: boolean
  onSelect: () => void
  onOpenSettings: (() => void) | null
}) {
  const IconComp = (icon && REALM_ICON_MAP[icon]) || Orbit
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

        <IconComp
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
              className="flex-1 truncate flex items-center gap-1.5 min-w-0"
            >
              <span className="truncate">{name}</span>
              {isTeam && (
                <span
                  className="shrink-0 text-[8px] font-black tracking-wider px-1.5 py-[1px] rounded-full uppercase"
                  style={{
                    background: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                    color: 'var(--primary)',
                    boxShadow: '0 0 8px color-mix(in srgb, var(--primary) 30%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)',
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
