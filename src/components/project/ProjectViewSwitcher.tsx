'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LayoutGrid, GitBranch, Orbit } from 'lucide-react'
import { useViewPreference, type ProjectViewMode } from './useViewPreference'
import { GridView } from './GridView'
import { TreeView } from './TreeView'
import { SpaceView } from './SpaceView'
import type { ProjectWithStats } from './types'

interface ProjectViewSwitcherProps {
  projects: ProjectWithStats[]
  onEdit: (project: ProjectWithStats) => void
  onDelete?: (id: string) => void
  onShare?: (project: ProjectWithStats) => void
}

const VIEW_OPTIONS: { value: ProjectViewMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'tree', label: 'Tree', icon: GitBranch },
  { value: 'space', label: 'Space', icon: Orbit },
]

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isMobile
}

export function ProjectViewSwitcher({ projects, onEdit, onDelete, onShare }: ProjectViewSwitcherProps) {
  const [view, setView] = useViewPreference()
  const isMobile = useIsMobile()
  const effectiveView = isMobile && view === 'space' ? 'grid' : view

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Your Projects</h2>
        <div className="flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
          {VIEW_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const isActive = effectiveView === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setView(opt.value)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-white'
                    : 'text-[var(--text-dim)] hover:text-[var(--text-muted)]'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="view-indicator"
                    className="absolute inset-0 bg-white/10 rounded-md border border-white/10"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10 hidden sm:inline">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={effectiveView}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {effectiveView === 'grid' && <GridView projects={projects} onEdit={onEdit} onDelete={onDelete} onShare={onShare} />}
          {effectiveView === 'tree' && <TreeView projects={projects} />}
          {effectiveView === 'space' && <SpaceView projects={projects} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
