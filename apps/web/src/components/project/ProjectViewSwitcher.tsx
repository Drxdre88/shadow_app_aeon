'use client'

import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LayoutGrid, GitBranch, Orbit } from 'lucide-react'
import type { ProjectViewMode } from './useViewPreference'
import { GridView } from './GridView'
import { TreeView } from './TreeView'
import { SpaceView } from './SpaceView'
import type { ProjectWithStats } from './types'

interface ProjectViewSwitcherProps {
  projects: ProjectWithStats[]
  onEdit: (project: ProjectWithStats) => void
  onDelete?: (id: string) => void
  onShare?: (project: ProjectWithStats) => void
  onGroupChange?: (projectId: string, newGroup: string | null) => void
  view: ProjectViewMode
  onViewChange: (mode: ProjectViewMode) => void
  layout?: 'scroll' | 'wrap'
  onLayoutChange?: (layout: 'scroll' | 'wrap') => void
}

export const VIEW_OPTIONS: { value: ProjectViewMode; label: string; icon: ComponentType<{ className?: string }> }[] = [
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

export function ProjectViewSwitcher({ projects, onEdit, onDelete, onShare, onGroupChange, view, onViewChange, layout: controlledLayout, onLayoutChange }: ProjectViewSwitcherProps) {
  const isMobile = useIsMobile()
  const effectiveView = isMobile && view === 'space' ? 'grid' : view

  return (
    <div>
      <AnimatePresence mode="wait">
        <motion.div
          key={effectiveView}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {effectiveView === 'grid' && <GridView projects={projects} onEdit={onEdit} onDelete={onDelete} onShare={onShare} onGroupChange={onGroupChange} layout={controlledLayout} onLayoutChange={onLayoutChange} />}
          {effectiveView === 'tree' && <TreeView projects={projects} />}
          {effectiveView === 'space' && <SpaceView projects={projects} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
