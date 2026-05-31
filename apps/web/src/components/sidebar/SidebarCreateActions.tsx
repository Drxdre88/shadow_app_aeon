'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Orbit, Sparkles } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import { useThemeStore } from '@/stores/themeStore'
import { useKairosStore } from '@/stores/kairosStore'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal'
import { CreateDominionModal } from '@/components/kairos/CreateDominionModal'
import { createGroup } from '@/lib/actions/workspaces'

// Self-contained "New Project / New Realm" actions for sidebars that don't
// own the modal state. On /kairos the actions swap to a single "New Dominion"
// — the sidebar's contextual, projects and realms aren't the active surface.
export function SidebarCreateActions({ collapsed }: { collapsed: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const onKairos = pathname?.startsWith('/kairos') ?? false
  const colors = useThemeStore((s) => s.colors)
  const glowColor = colors?.glow ?? 'rgba(139, 92, 246, 0.4)'
  const triggerKairosRefresh = useKairosStore((s) => s.triggerRefresh)

  const [projectOpen, setProjectOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [dominionOpen, setDominionOpen] = useState(false)

  return (
    <>
      <div className={cn('flex flex-col gap-1.5 px-2 py-3', collapsed && 'items-center')}>
        {onKairos ? (
          <ActionButton
            icon={<Sparkles className="w-3.5 h-3.5 shrink-0" />}
            label="New Dominion"
            collapsed={collapsed}
            glowColor={glowColor}
            onClick={() => setDominionOpen(true)}
          />
        ) : (
          <>
            <ActionButton
              icon={<Plus className="w-3.5 h-3.5 shrink-0" />}
              label="New Project"
              collapsed={collapsed}
              glowColor={glowColor}
              onClick={() => setProjectOpen(true)}
            />
            <ActionButton
              icon={<Orbit className="w-3.5 h-3.5 shrink-0" />}
              label="New Realm"
              collapsed={collapsed}
              glowColor={glowColor}
              onClick={() => setWorkspaceOpen(true)}
              variant="subtle"
            />
          </>
        )}
      </div>

      <CreateProjectModal
        isOpen={projectOpen}
        onClose={() => setProjectOpen(false)}
        onProjectCreated={() => {
          setProjectOpen(false)
          router.refresh()
        }}
      />

      <CreateWorkspaceModal
        isOpen={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        onCreate={async (name, color, icon) => {
          await createGroup({ name, color, icon })
          setWorkspaceOpen(false)
          router.refresh()
        }}
      />

      <CreateDominionModal
        isOpen={dominionOpen}
        onClose={() => setDominionOpen(false)}
        onCreated={() => {
          setDominionOpen(false)
          triggerKairosRefresh()
          router.refresh()
        }}
      />
    </>
  )
}

function ActionButton({
  icon,
  label,
  collapsed,
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
          : 'text-white/40 hover:text-white/70 hover:bg-white/[0.06]',
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
