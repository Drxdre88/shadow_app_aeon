'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Folder } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { getProjects } from '@/lib/actions/projects'
import { useThemeStore } from '@/stores/themeStore'

interface ProjectSwitcherProps {
  currentProjectId: string
  projectName: string
  glowColor: string
}

interface ProjectEntry {
  id: string
  name: string
  group: string | null
  planetImage: string | null
}

export function ProjectSwitcher({ currentProjectId, projectName, glowColor }: ProjectSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { glowIntensity, projectColors, colors } = useThemeStore()
  const mult = glowIntensity / 75

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (isOpen && !loaded) {
      getProjects().then((p) => {
        setProjects(p.map((proj) => ({
          id: proj.id,
          name: proj.name,
          group: proj.group,
          planetImage: proj.planetImage,
        })))
        setLoaded(true)
      })
    }
  }, [isOpen, loaded])

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [isOpen])

  const handleSelect = (projectId: string) => {
    setIsOpen(false)
    if (projectId !== currentProjectId) {
      router.push(`/project/${projectId}`)
    }
  }

  const otherProjects = projects.filter((p) => p.id !== currentProjectId)
  const grouped = otherProjects.reduce<Record<string, ProjectEntry[]>>((acc, p) => {
    const key = p.group || 'Ungrouped'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})
  const groupNames = Object.keys(grouped).sort((a, b) => {
    if (a === 'Ungrouped') return 1
    if (b === 'Ungrouped') return -1
    return a.localeCompare(b)
  })

  // eslint-disable-next-line react-hooks/refs
  const rect = buttonRef.current?.getBoundingClientRect()

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 group cursor-pointer"
      >
        <span
          className="text-sm sm:text-lg font-bold truncate max-w-[120px] sm:max-w-[240px] animate-pulse-glow"
          style={{
            color: glowColor,
            textShadow: `0 0 ${8 * mult}px ${glowColor}, 0 0 ${20 * mult}px ${glowColor}40`,
            animationDuration: '3s',
          }}
        >
          {projectName}
        </span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
          style={{ color: glowColor }}
        />
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {isOpen && rect && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="fixed z-[100] min-w-[280px] max-w-[360px] rounded-2xl overflow-hidden"
              style={{
                top: rect.bottom + 8,
                left: Math.max(8, rect.left),
                backgroundColor: 'rgba(12, 12, 22, 0.95)',
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: `0 0 ${24 * mult}px ${glowColor}15, 0 8px 32px rgba(0,0,0,0.5)`,
                backdropFilter: 'blur(24px)',
              }}
            >
              <div
                className="absolute top-0 left-4 right-4 h-[1px]"
                style={{
                  background: `linear-gradient(90deg, transparent, ${glowColor}60, transparent)`,
                }}
              />

              <div className="px-4 py-3 border-b border-white/[0.06]">
                <span className="text-[10px] uppercase tracking-wider text-slate-600 font-medium">Switch Project</span>
              </div>

              <div className="max-h-[360px] overflow-y-auto py-1">
                {!loaded && (
                  <div className="px-4 py-6 text-center">
                    <div className="w-5 h-5 rounded-full animate-spin mx-auto" style={{ border: '2px solid color-mix(in srgb, var(--primary) 30%, transparent)', borderTopColor: 'var(--primary)' }} />
                  </div>
                )}
                {loaded && otherProjects.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-slate-600">No other projects</div>
                )}
                {groupNames.map((groupName) => (
                  <div key={groupName}>
                    <div className="px-4 pt-3 pb-1">
                      <span className="text-[10px] uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                        <Folder className="w-3 h-3" />
                        {groupName}
                      </span>
                    </div>
                    {grouped[groupName].map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelect(p.id)}
                        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.04] transition-all text-left group/item"
                      >
                        {(() => {
                          const pColor = projectColors[p.id] || colors.glowColor || 'rgba(139, 92, 246, 0.5)'
                          return (
                            <div
                              className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center ring-1 ring-white/10 group-hover/item:ring-white/20 transition-all"
                              style={{
                                background: `radial-gradient(circle at 30% 30%, ${pColor}40, ${pColor}15)`,
                                boxShadow: `0 0 ${8 * mult}px ${pColor}50, inset 0 0 ${6 * mult}px ${pColor}30`,
                              }}
                            >
                              <span className="text-[10px] font-medium" style={{ color: pColor }}>{p.name.charAt(0)}</span>
                            </div>
                          )
                        })()}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-300 truncate group-hover/item:text-white transition-colors">{p.name}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              <div className="px-4 py-2 border-t border-white/[0.06]">
                <span className="text-[10px] text-slate-700 flex items-center gap-1">
                  <kbd className="border border-white/10 rounded px-1">Ctrl+K</kbd> search all
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
