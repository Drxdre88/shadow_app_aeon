'use client'

import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Home } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export function SidebarHome({ collapsed, glowColor, pathname }: { collapsed: boolean; glowColor: string; pathname: string | null }) {
  const isHome = pathname?.startsWith('/dashboard') ?? false
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
            background: 'radial-gradient(circle at 0% 50%, color-mix(in oklab, var(--primary) 20%, transparent), transparent 60%)',
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
        style={{ background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.10), transparent)' }}
      />
    </div>
  )
}
