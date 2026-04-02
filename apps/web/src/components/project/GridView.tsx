'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Clock, Trash2, Pencil, Palette, Users, GripVertical } from 'lucide-react'
import Link from 'next/link'
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, horizontalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { GlowCard } from '@/components/ui/GlowCard'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { deleteProject, setProjectGroup } from '@/lib/actions/projects'
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
import { timeAgo } from '@/lib/utils/timeAgo'
import { ProjectContextMenu, type RealmInfo } from './ProjectContextMenu'
import type { ProjectWithStats } from './types'

interface GridViewProps {
  projects: ProjectWithStats[]
  onEdit: (project: ProjectWithStats) => void
  onDelete?: (id: string) => void
  onShare?: (project: ProjectWithStats) => void
  onGroupChange?: (projectId: string, newGroup: string | null) => void
  realms?: RealmInfo[]
  projectRealmMap?: Record<string, string[]>
  onToggleRealm?: (projectId: string, realmId: string) => void
  layout?: 'scroll' | 'wrap'
  onLayoutChange?: (layout: 'scroll' | 'wrap') => void
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
    .map(([label, items]) => [label, items.sort((a, b) => a.name.localeCompare(b.name))] as [string, ProjectWithStats[]])
}

function SortableProjectCard({ project, children }: { project: ProjectWithStats; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    data: { type: 'project', project },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40 z-50')}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

export function GridView({ projects, onEdit, onDelete, onShare, onGroupChange, realms, projectRealmMap, onToggleRealm, layout: controlledLayout }: GridViewProps) {
  const { glowIntensity, projectColors, setProjectColor, shortcuts } = useThemeStore()
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)
  const [colorPickerProjectId, setColorPickerProjectId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: ProjectWithStats } | null>(null)
  const layout = controlledLayout ?? 'wrap'
  const [groupOrder, setGroupOrder] = useState<string[]>([])
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [projectOrder, setProjectOrder] = useState<Record<string, string[]>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem('aeon-project-order') || '{}') } catch { return {} }
  })
  const projectListRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const groups = useMemo(() => {
    const base = groupProjects(projects)
    return base.map(([label, items]) => {
      const order = projectOrder[label]
      if (!order || order.length === 0) return [label, items] as [string, ProjectWithStats[]]
      const ordered: ProjectWithStats[] = []
      for (const id of order) {
        const found = items.find((p) => p.id === id)
        if (found) ordered.push(found)
      }
      for (const p of items) {
        if (!order.includes(p.id)) ordered.push(p)
      }
      return [label, ordered] as [string, ProjectWithStats[]]
    })
  }, [projects, projectOrder])

  useEffect(() => {
    const computedKeys = groups.map(([label]) => label)
    const stored = localStorage.getItem('aeon-group-order')
    let parsed: string[] = []
    try { parsed = stored ? JSON.parse(stored) : [] } catch { parsed = [] }
    const validStored = parsed.filter((k) => computedKeys.includes(k))
    const missing = computedKeys.filter((k) => !validStored.includes(k))
    setGroupOrder([...validStored, ...missing])
  }, [groups])

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
      if (e.key.toLowerCase() === 'e' && hoveredProjectId) {
        e.preventDefault()
        const project = projects.find((p) => p.id === hoveredProjectId)
        if (project) onEdit(project)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hoveredProjectId, shortcuts, projects, onEdit])

  const handleColorChange = useCallback((projectId: string, color: string) => {
    setProjectColor(projectId, color)
  }, [setProjectColor])

  const handleDelete = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (deletingId) return
    setPendingDeleteId(projectId)
  }

  const confirmDelete = async () => {
    if (!pendingDeleteId) return
    const projectId = pendingDeleteId
    setPendingDeleteId(null)
    setDeletingId(projectId)
    onDelete?.(projectId)
    try {
      await deleteProject(projectId)
    } catch {
      setDeletingId(null)
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveProjectId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveProjectId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeProject = projects.find((p) => p.id === active.id)
    const overProject = projects.find((p) => p.id === over.id)
    if (!activeProject || !overProject) return

    const srcGroup = activeProject.group || 'General'
    const dstGroup = overProject.group || 'General'

    if (srcGroup === dstGroup) {
      const currentItems = groups.find(([l]) => l === dstGroup)?.[1] || []
      const ids = currentItems.map((p) => p.id)
      const oldIdx = ids.indexOf(active.id as string)
      const newIdx = ids.indexOf(over.id as string)
      if (oldIdx === -1 || newIdx === -1) return
      const reordered = [...ids]
      reordered.splice(oldIdx, 1)
      reordered.splice(newIdx, 0, active.id as string)
      const next = { ...projectOrder, [dstGroup]: reordered }
      setProjectOrder(next)
      localStorage.setItem('aeon-project-order', JSON.stringify(next))
    } else {
      const newGroup = dstGroup === 'General' ? null : dstGroup
      onGroupChange?.(active.id as string, newGroup)
      setProjectGroup(active.id as string, newGroup).catch(() => {})
    }
  }

  const renderCard = (project: ProjectWithStats) => {
    const projectColor = (projectColors[project.id] || 'purple') as AccentColor
    return (
      <SortableProjectCard key={project.id} project={project}>
        <div
          className={cn('relative w-72', layout === 'scroll' && 'shrink-0')}
          data-project-id={project.id}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, project })
          }}
        >
          <Link href={`/project/${project.id}`} draggable={false}>
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
                      className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--primary)] hover:bg-white/10 transition-colors"
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
                      className="p-1.5 rounded-lg text-slate-500 transition-colors hover:bg-white/10"
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--primary)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '')}
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
                    <Clock className="w-3 h-3" />
                    {timeAgo(project.updatedAt)}
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
      </SortableProjectCard>
    )
  }

  const allProjectIds = useMemo(() => {
    return groups.flatMap(([, items]) => items.map((p) => p.id))
  }, [groups])

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div ref={projectListRef} className="space-y-6">
        <SortableContext items={allProjectIds} strategy={layout === 'scroll' ? horizontalListSortingStrategy : rectSortingStrategy}>
          {groupOrder
            .map((label) => groups.find(([l]) => l === label) as [string, ProjectWithStats[]] | undefined)
            .filter((g): g is [string, ProjectWithStats[]] => g !== undefined)
            .map(([label, groupItems]) => (
              <div
                key={label}
                onDragOver={(e) => { e.preventDefault(); if (!activeProjectId) setDragOverGroup(label) }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (!draggedGroup || draggedGroup === label) { setDragOverGroup(null); return }
                  setGroupOrder((prev) => {
                    const next = prev.filter((g) => g !== draggedGroup)
                    const idx = next.indexOf(label)
                    next.splice(idx, 0, draggedGroup)
                    localStorage.setItem('aeon-group-order', JSON.stringify(next))
                    return next
                  })
                  setDraggedGroup(null)
                  setDragOverGroup(null)
                }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverGroup(null) }}
                className={cn(
                  dragOverGroup === label && draggedGroup && draggedGroup !== label && 'border-t-2 border-[color:var(--primary)]/60',
                )}
              >
                {groups.length > 1 && (
                  <div
                    className="flex items-center gap-2 mb-3 cursor-grab active:cursor-grabbing group/header"
                    draggable
                    onDragStart={() => setDraggedGroup(label)}
                    onDragEnd={() => { setDraggedGroup(null); setDragOverGroup(null) }}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-slate-700 group-hover/header:text-slate-500 transition-colors shrink-0" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">{label}</h3>
                    <span className="text-[10px] text-slate-600">{groupItems.length}</span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                  </div>
                )}
                <div className={layout === 'scroll' ? 'flex gap-4 overflow-x-auto max-w-full pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent' : 'flex flex-wrap gap-4'}>
                  {groupItems.map(renderCard)}
                </div>
              </div>
            ))}
        </SortableContext>
      </div>
      <DragOverlay>
        {activeProject && (
          <div className="w-72 opacity-80 rotate-2">
            <GlowCard accentColor={(projectColors[activeProject.id] || 'purple') as AccentColor} glowIntensity="md" showAccentLine>
              <div className="p-3">
                <h3 className="text-sm font-semibold text-white truncate">{activeProject.name}</h3>
              </div>
            </GlowCard>
          </div>
        )}
      </DragOverlay>
      {contextMenu && realms && (
        <ProjectContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          projectId={contextMenu.project.id}
          projectName={contextMenu.project.name}
          realms={realms}
          projectRealmIds={projectRealmMap?.[contextMenu.project.id] ?? []}
          onClose={() => setContextMenu(null)}
          onEdit={() => onEdit(contextMenu.project)}
          onShare={() => onShare?.(contextMenu.project)}
          onDelete={() => { setContextMenu(null); setPendingDeleteId(contextMenu.project.id) }}
          onToggleRealm={(realmId) => onToggleRealm?.(contextMenu.project.id, realmId)}
        />
      )}
      <ConfirmModal
        isOpen={!!pendingDeleteId}
        title="Delete project?"
        message="All tasks will be permanently removed. This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </DndContext>
  )
}
