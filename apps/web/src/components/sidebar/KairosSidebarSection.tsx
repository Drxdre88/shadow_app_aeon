'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'

// Slim Kairos entry that lives between the realm/nav body and the
// "New Project / New Realm" actions in both AppSidebar and ProjectSidebar.
// Renders as: faint glowing divider → Kairos 0.1 pill → faint glowing divider.
export function KairosSidebarSection({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname()
  const active = pathname?.startsWith('/kairos') ?? false

  return (
    <div className="shrink-0">
      <div
        className="mx-3 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.2 }}
      />
      <div className={cn('flex items-center justify-center px-2 py-2.5', collapsed && 'px-1')}>
        <Link
          href="/kairos"
          aria-label="Open Kairos"
          className="block outline-none"
        >
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
            {collapsed ? 'K' : 'Kairos 0.1'}
          </motion.div>
        </Link>
      </div>
      <div
        className="mx-3 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.2 }}
      />
    </div>
  )
}
