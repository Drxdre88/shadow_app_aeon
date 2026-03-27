'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Calendar, Trash2, Pencil, Palette, Users } from 'lucide-react'
import Link from 'next/link'
import { GlowCard } from '@/components/ui/GlowCard'
import { deleteProject } from '@/lib/actions/projects'
import { useThemeStore } from '@/stores/themeStore'
import {
  ACCENT_COLORS,
  PALETTE_COLORS,
  type AccentColor,
  colorConfig,
  getRecentColors,
  addRecentColor,
} from '@/lib/utils/colors'
import { cn } from '@/lib/utils/cn'
import type { ProjectWithStats } from './types'

interface GridViewProps {
  projects: ProjectWithStats[]
  onEdit: (project: ProjectWithStats) => void
  onDelete?: (id: string) => void
  onShare?: (project: ProjectWithStats) => void
}

function groupProjects(projects: ProjectWithStats[]) {
  const groups = new Map<string, ProjectWithStats[]>()
  for (const p of projects) {
    const key = p.group || 'General'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === 'General') return -1
      if (b === 'General') return 1
      return a.localeCompare(b)
    })
}

export function GridView({ projects, onEdit, onDelete, onShare }: GridViewProps) {
  const router = useRouter()
  const { glowIntensity, projectColors, setProjectColor, shortcuts } = useThemeStore()
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)
  const [colorPickerProjectId, setColorPickerProjectId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const projectListRef = useRef<HTMLDivElement>(null)

  const groups = useMemo(() => groupProjects(projects), [projects])

  useEffect(() => {
    const el = projectListRef.current
    if (!el) return
    const onOver = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest('[data-project-id]')
      setHoveredProjectId(card?.getAttribute('data-project-id') ?? null)
    }
    const onLeave = () => setHoveredProjectId(null)
    el.addEventListener('mouseover', onOver)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mouseover', onOver)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key.toLowerCase() === (shortcuts?.changeGlow ?? 'g') && hoveredProjectId) {
        e.preventDefault()
        setColorPickerProjectId((prev) => prev === hoveredProjectId ? null : hoveredProjectId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hoveredProjectId, shortcuts])

  const handleColorChange = useCallback((projectId: string, color: string) => {
    setProjectColor(projectId, color)
    setColorPickerProjectId(null)
  }, [setProjectColor])

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (deletingId) return
    if (!confirm('Delete this project? All tasks will be permanently removed.')) return
    setDeletingId(projectId)
    onDelete?.(projectId)
    try {
      await deleteProject(projectId)
    } catch {
      setDeletingId(null)
    }
  }

  const renderCard = (project: ProjectWithStats) => {
    const projectColor = (projectColors[project.id] || 'purple') as AccentColor
    return (
      <div key={project.id} className="relative w-72 shrink-0" data-project-id={project.id}>
        <Link href={`/project/${project.id}`}>
          <GlowCard accentColor={projectColor} glowIntensity="sm" showAccentLine hover>
            <div className="p-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-white truncate flex-1 mr-2">{project.name}</h3>
                <div className="flex items-center gap-0.5 shrink-0 rounded-lg bg-white/[0.04] px-0.5">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setColorPickerProjectId((prev) => prev === project.id ? null : project.id)
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                  >
                    <Palette className="w-3.5 h-3.5" />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(project) }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShare?.(project) }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                  >
                    <Users className="w-3.5 h-3.5" />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => handleDelete(e, project.id)}
                    disabled={deletingId === project.id}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </motion.button>
                </div>
              </div>
              {project.description && (
                <p className="text-xs text-[var(--text-dim)] mt-1 line-clamp-2">{project.description}</p>
              )}
              <div className="flex items-center mt-2 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(project.startDate).toLocaleDateString()}
                </span>
              </div>
            </div>
          </GlowCard>
        </Link>
        {colorPickerProjectId === project.id && createPortal(
          <div
            className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setColorPickerProjectId(null)}
          >
            <div
              className="p-4 rounded-xl bg-[#1a1a24]/95 backdrop-blur-xl border border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.6)] min-w-[260px] space-y-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex gap-2 flex-wrap">
                {ACCENT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => handleColorChange(project.id, c)}
                    className={cn(
                      'w-7 h-7 rounded-full border-2 transition-all hover:scale-110',
                      projectColor === c ? 'border-white scale-110' : 'border-transparent'
                    )}
                    style={{ backgroundColor: colorConfig[c].hex }}
                  />
                ))}
              </div>
              {(() => { const recent = getRecentColors(); return recent.length > 0 ? (
                <div className="border-t border-white/10 pt-2">
                  <span className="text-[10px] text-slate-500 mb-1 block">Recent</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {recent.map((hex) => (
                      <button
                        key={hex}
                        onClick={() => handleColorChange(project.id, hex)}
                        className={cn(
                          'w-6 h-6 rounded-full border-2 transition-all hover:scale-110',
                          projectColor === hex ? 'border-white scale-110' : 'border-transparent'
                        )}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>
              ) : null })()}
              <div className="border-t border-white/10 pt-2">
                <div className="grid grid-cols-7 gap-1">
                  {PALETTE_COLORS.map((hex) => (
                    <button
                      key={hex}
                      onClick={() => handleColorChange(project.id, hex)}
                      className={cn(
                        'w-6 h-6 rounded-full border-2 transition-all hover:scale-110',
                        projectColor === hex ? 'border-white scale-110' : 'border-transparent'
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>
              <div className="pt-1 border-t border-white/10">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="color"
                      value={typeof projectColor === 'string' && projectColor.startsWith('#') ? projectColor : colorConfig[projectColor]?.hex ?? '#a855f7'}
                      onChange={(e) => {
                        addRecentColor(e.target.value)
                        handleColorChange(project.id, e.target.value)
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="w-6 h-6 rounded-full border-2 border-dashed border-white/30 group-hover:border-white/60 transition-all flex items-center justify-center">
                      <Palette className="w-3 h-3 text-slate-400" />
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-500 group-hover:text-slate-300 transition-colors">Custom</span>
                </label>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    )
  }

  return (
    <div ref={projectListRef} className="space-y-6">
      {groups.map(([label, groupProjects]) => (
        <div key={label}>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">{label}</h3>
            <span className="text-[10px] text-slate-600">{groupProjects.length}</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            {groupProjects.map(renderCard)}
          </div>
        </div>
      ))}
    </div>
  )
}
