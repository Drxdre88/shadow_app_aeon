'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
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
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen])

  const handleSelect = (projectId: string) => {
    setIsOpen(false)
    if (projectId !== currentProjectId) {
      router.push(`/project/${projectId}`)
    }
  }

  const otherProjects = projects.filter((p) => p.id !== currentProjectId)

  return (
    <div ref={ref} className="relative">
      <button
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

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 z-50 min-w-[240px] max-w-[320px] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-xl overflow-hidden"
            style={{
              boxShadow: `0 0 ${20 * mult}px ${glowColor}20, 0 4px 24px rgba(0,0,0,0.4)`,
            }}
          >
            <div className="px-3 py-2 border-b border-white/10">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Switch Project</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto py-1">
              {!loaded && (
                <div className="px-3 py-4 text-center text-xs text-slate-500">Loading...</div>
              )}
              {loaded && otherProjects.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-slate-500">No other projects</div>
              )}
              {otherProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p.id)}
                  className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/5 transition-colors text-left"
                >
                  {p.planetImage && (
                    <img
                      src={`/planets/${p.planetImage}`}
                      alt=""
                      className="w-5 h-5 rounded-full object-cover shrink-0"
                    />
                  )}
                  {!p.planetImage && (
                    <div className="w-5 h-5 rounded-full bg-white/10 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200 truncate">{p.name}</div>
                    {p.group && (
                      <div className="text-[10px] text-slate-500 truncate">{p.group}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
