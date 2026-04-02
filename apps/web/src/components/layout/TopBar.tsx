'use client'

import { Search, LayoutGrid, GitBranch, Orbit, Rows3, LayoutGrid as GridIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'

interface TopBarProps {
  activeRealmName?: string
  view: 'grid' | 'tree' | 'space'
  onViewChange: (view: 'grid' | 'tree' | 'space') => void
  gridLayout: 'scroll' | 'wrap'
  onGridLayoutChange: (layout: 'scroll' | 'wrap') => void
  sidebarCollapsed: boolean
}

const VIEW_OPTIONS = [
  { id: 'grid' as const, icon: LayoutGrid, label: 'Grid' },
  { id: 'tree' as const, icon: GitBranch, label: 'Tree' },
  { id: 'space' as const, icon: Orbit, label: 'Space' },
]

const LAYOUT_OPTIONS = [
  { id: 'wrap' as const, icon: GridIcon, label: 'Wrap' },
  { id: 'scroll' as const, icon: Rows3, label: 'Scroll' },
]

export function TopBar({
  view,
  onViewChange,
  gridLayout,
  onGridLayoutChange,
}: TopBarProps) {
  return (
    <div
      className="sticky top-0 z-40 flex h-12 items-center gap-3 px-4"
      style={{
        background: 'rgba(10, 10, 15, 0.9)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex items-center rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {VIEW_OPTIONS.map(({ id, icon: Icon, label }) => (
            <motion.button
              key={id}
              onClick={() => onViewChange(id)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                view === id
                  ? 'text-current'
                  : 'text-white/30 hover:text-white/60'
              )}
              style={view === id ? { color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 15%, transparent)' } : undefined}
              whileTap={{ scale: 0.9 }}
              title={label}
            >
              <Icon className="h-3.5 w-3.5" />
            </motion.button>
          ))}
        </div>

        {view === 'grid' && (
          <div className="flex items-center rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {LAYOUT_OPTIONS.map(({ id, icon: Icon, label }) => (
              <motion.button
                key={id}
                onClick={() => onGridLayoutChange(id)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                  gridLayout === id
                    ? 'text-current'
                    : 'text-white/30 hover:text-white/60'
                )}
                style={gridLayout === id ? { color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 15%, transparent)' } : undefined}
                whileTap={{ scale: 0.9 }}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 flex justify-center">
        <button
          onClick={() => {
            const event = new KeyboardEvent('keydown', {
              key: 'k',
              metaKey: true,
              bubbles: true,
            })
            document.dispatchEvent(event)
          }}
          className="flex h-8 w-64 items-center gap-2 rounded-full px-3 text-xs text-white/30 transition-colors hover:bg-white/[0.06]"
          style={{ background: 'rgba(255, 255, 255, 0.04)' }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span>Search or Cmd+K...</span>
        </button>
      </div>

      <div className="w-[88px] shrink-0" />
    </div>
  )
}
