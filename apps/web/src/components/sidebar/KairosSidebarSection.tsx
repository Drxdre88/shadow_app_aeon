'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Wrench, BookMarked } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { KairosLearnModal, type KairosLearnTab } from '@/components/ui/kairos/KairosLearnModal'
import { KAIROS_VERSION_SHORT } from '@/lib/kairos/version'

// Slim Kairos entry that lives between the realm/nav body and the
// "New Project / New Realm" actions. Renders as:
//   faint glowing divider
//   Kairos version pill (links to /kairos)
//   Setup + Guide child buttons (open KairosLearnModal)
//   faint glowing divider
export function KairosSidebarSection({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname()
  const active = pathname?.startsWith('/kairos') ?? false
  const [modal, setModal] = useState<KairosLearnTab | null>(null)

  return (
    <div className="shrink-0">
      <GlowDivider />

      <div className={cn('flex items-center justify-center px-2 pt-2.5 pb-2', collapsed && 'px-1')}>
        <Link href="/kairos" aria-label="Open Kairos" className="block outline-none">
          <motion.div
            className={cn(
              'rounded-full backdrop-blur-md font-medium uppercase select-none',
              collapsed
                ? 'w-8 h-8 flex items-center justify-center text-[10px] tracking-[0.06em]'
                : 'px-4 py-1.5 text-[11px] tracking-[0.32em]',
            )}
            style={{
              background: 'rgba(8, 6, 18, 0.55)',
              border: '1px solid var(--primary)',
              color: 'var(--primary)',
              textShadow: '0 0 6px var(--glow-color, rgba(139,92,246,0.45))',
            }}
            animate={{
              boxShadow: active
                ? [
                    '0 0 14px var(--glow-color, rgba(139,92,246,0.45)), inset 0 0 8px var(--glow-color, rgba(139,92,246,0.45))',
                    '0 0 22px var(--glow-color, rgba(139,92,246,0.7)), inset 0 0 12px var(--glow-color, rgba(139,92,246,0.5))',
                    '0 0 14px var(--glow-color, rgba(139,92,246,0.45)), inset 0 0 8px var(--glow-color, rgba(139,92,246,0.45))',
                  ]
                : [
                    '0 0 4px var(--glow-color, rgba(139,92,246,0.3)), inset 0 0 3px var(--glow-color, rgba(139,92,246,0.25))',
                    '0 0 16px var(--glow-color, rgba(139,92,246,0.55)), inset 0 0 8px var(--glow-color, rgba(139,92,246,0.4))',
                    '0 0 4px var(--glow-color, rgba(139,92,246,0.3)), inset 0 0 3px var(--glow-color, rgba(139,92,246,0.25))',
                  ],
            }}
            transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            {collapsed ? 'K' : `Kairos ${KAIROS_VERSION_SHORT}`}
          </motion.div>
        </Link>
      </div>

      <div className={cn('flex flex-col gap-1 px-2 pb-2.5', collapsed && 'items-center px-1')}>
        <ChildButton
          icon={<Wrench className="w-3.5 h-3.5" />}
          label="Setup"
          onClick={() => setModal('setup')}
          collapsed={collapsed}
        />
        <ChildButton
          icon={<BookMarked className="w-3.5 h-3.5" />}
          label="Guide"
          onClick={() => setModal('guide')}
          collapsed={collapsed}
        />
      </div>

      <GlowDivider />

      <KairosLearnModal
        isOpen={modal !== null}
        defaultTab={modal ?? 'setup'}
        onClose={() => setModal(null)}
      />
    </div>
  )
}

function GlowDivider() {
  return (
    <div
      className="mx-3 h-px"
      style={{
        background: 'linear-gradient(90deg, transparent, var(--primary), transparent)',
        opacity: 0.2,
      }}
    />
  )
}

function ChildButton({
  icon, label, onClick, collapsed,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  collapsed: boolean
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg text-[11px] font-semibold transition-all',
        collapsed ? 'w-8 h-8 justify-center px-0 py-0' : 'w-full px-3 py-1.5',
        'text-white/55 hover:text-white bg-white/[0.03] hover:bg-white/[0.08]',
      )}
      aria-label={label}
    >
      {icon}
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.18 }}
            className="whitespace-nowrap"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}
