'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, FolderOpen, Folder, LayoutGrid } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, resolveColor, type AccentColor } from '@/lib/utils/colors'
import { renameProjectGroup, setProjectGroup, deleteProject } from '@/lib/actions/projects'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ProjectContextMenu } from './ProjectContextMenu'
import type { ProjectWithStats } from './types'

interface TreeViewProps {
  projects: ProjectWithStats[]
  onEdit?: (project: ProjectWithStats) => void
  onDelete?: (...args: never[]) => void
  onShare?: (project: ProjectWithStats) => void
  realms?: Array<{ id: string; name: string; color: string; isPersonal: boolean }>
  projectRealmMap?: Record<string, string[]>
  onToggleRealm?: (projectId: string, realmId: string) => void
}

interface TreeNode {
  label: string
  projects: ProjectWithStats[]
}

function groupByFluidGroup(projects: ProjectWithStats[]): TreeNode[] {
  const groups = new Map<string, ProjectWithStats[]>()
  for (const p of projects) {
    const key = p.group || 'General'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }
  const generalFirst = (a: string, b: string) => {
    if (a === 'General') return -1
    if (b === 'General') return 1
    return a.localeCompare(b)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => generalFirst(a, b))
    .map(([label, prjs]) => ({ label, projects: prjs }))
}

export function TreeView({ projects, onEdit, onDelete, onShare, realms = [], projectRealmMap = {}, onToggleRealm }: TreeViewProps) {
  const router = useRouter()
  const { projectColors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(groupByFluidGroup(projects).map((g) => g.label))
  )
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [editGroupValue, setEditGroupValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: ProjectWithStats } | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const groups = useMemo(() => groupByFluidGroup(projects), [projects])

  const flatItems = useMemo(() => {
    const items: Array<{ type: 'group'; label: string } | { type: 'project'; project: ProjectWithStats; groupLabel: string }> = []
    for (const group of groups) {
      items.push({ type: 'group', label: group.label })
      if (expandedGroups.has(group.label)) {
        for (const project of group.projects) {
          items.push({ type: 'project', project, groupLabel: group.label })
        }
      }
    }
    return items
  }, [groups, expandedGroups])

  const toggleGroup = useCallback((label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const handleGroupDoubleClick = useCallback((label: string) => {
    if (label === 'General') return
    setEditingGroup(label)
    setEditGroupValue(label)
    setTimeout(() => editInputRef.current?.focus(), 0)
  }, [])

  const handleGroupRenameSubmit = useCallback(async (oldName: string) => {
    const newName = editGroupValue.trim()
    setEditingGroup(null)
    if (!newName || newName === oldName) return
    await renameProjectGroup(oldName, newName)
    router.refresh()
  }, [editGroupValue, router])

  const handleProjectDrop = useCallback(async (projectId: string, targetGroup: string) => {
    await setProjectGroup(projectId, targetGroup === 'General' ? null : targetGroup)
    router.refresh()
  }, [router])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.min(prev + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const item = flatItems[focusedIndex]
      if (!item) return
      if (item.type === 'group') toggleGroup(item.label)
    }
  }, [flatItems, focusedIndex, toggleGroup])

  return (
    <div
      className="rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {groups.map((group, gi) => {
        const isExpanded = expandedGroups.has(group.label)
        const groupFlatIdx = flatItems.findIndex((f) => f.type === 'group' && f.label === group.label)
        return (
          <div
            key={group.label}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const projectId = e.dataTransfer.getData('projectId')
              if (projectId) handleProjectDrop(projectId, group.label)
            }}
          >
            <button
              onClick={() => {
                if (editingGroup !== group.label) toggleGroup(group.label)
              }}
              className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-white/5 ${
                focusedIndex === groupFlatIdx ? 'bg-white/10' : ''
              }`}
            >
              <motion.div
                animate={{ rotate: isExpanded ? 90 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronRight className="w-3.5 h-3.5 text-[var(--text-dim)]" />
              </motion.div>
              {isExpanded
                ? <FolderOpen className="w-4 h-4 text-[var(--primary)]" />
                : <Folder className="w-4 h-4 text-[var(--text-muted)]" />
              }
              {editingGroup === group.label ? (
                <input
                  ref={editInputRef}
                  value={editGroupValue}
                  onChange={(e) => setEditGroupValue(e.target.value)}
                  onBlur={() => handleGroupRenameSubmit(group.label)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') handleGroupRenameSubmit(group.label)
                    if (e.key === 'Escape') setEditingGroup(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-b border-white/30 text-sm font-medium text-white outline-none flex-1"
                />
              ) : (
                <span
                  className="text-sm font-medium text-[var(--text-secondary)] flex-1"
                  onDoubleClick={(e) => { e.stopPropagation(); handleGroupDoubleClick(group.label) }}
                >
                  {group.label}
                </span>
              )}
              <span className="text-[10px] text-[var(--text-dim)] tabular-nums">
                {group.projects.length}
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  {group.projects.map((project) => {
                    const projectColor = (projectColors[project.id] || 'purple') as AccentColor
                    const resolved = resolveColor(projectColor)
                    const itemFlatIdx = flatItems.findIndex(
                      (f) => f.type === 'project' && f.project.id === project.id
                    )
                    return (
                      <Link key={project.id} href={`/project/${project.id}`}>
                        <div
                          data-tree-item
                          className={`flex items-center gap-2 pl-11 pr-4 py-2 transition-colors hover:bg-white/5 group cursor-pointer ${
                            focusedIndex === itemFlatIdx ? 'bg-white/10' : ''
                          }`}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('projectId', project.id)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCtxMenu({ x: e.clientX, y: e.clientY, project })
                          }}
                        >
                          <div className="relative flex items-center">
                            <div
                              className="absolute -left-5 top-1/2 w-3 h-px"
                              style={{ backgroundColor: `${resolved.hex}40` }}
                            />
                            <div
                              className="w-2.5 h-2.5 rounded-full"
                              style={{
                                backgroundColor: resolved.hex,
                                boxShadow: glowIntensity > 0
                                  ? `0 0 ${6 * mult}px ${resolved.glow}`
                                  : undefined,
                              }}
                            />
                          </div>
                          <LayoutGrid className="w-3.5 h-3.5 text-[var(--text-dim)]" />
                          <span className="text-sm text-white truncate flex-1 group-hover:text-[var(--primary)] transition-colors">
                            {project.name}
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            {gi < groups.length - 1 && <div className="border-b border-white/[0.04]" />}
          </div>
        )
      })}

      {projects.length === 0 && (
        <div className="py-12 text-center text-[var(--text-dim)] text-sm">
          No projects yet
        </div>
      )}

      {ctxMenu && (
        <ProjectContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          projectId={ctxMenu.project.id}
          projectName={ctxMenu.project.name}
          realms={realms}
          projectRealmIds={projectRealmMap[ctxMenu.project.id] ?? []}
          onClose={() => setCtxMenu(null)}
          onEdit={() => onEdit?.(ctxMenu.project)}
          onShare={() => onShare?.(ctxMenu.project)}
          onDelete={() => { setPendingDeleteId(ctxMenu.project.id); setCtxMenu(null) }}
          onToggleRealm={(realmId) => onToggleRealm?.(ctxMenu.project.id, realmId)}
        />
      )}
      <ConfirmModal
        isOpen={!!pendingDeleteId}
        title="Delete project?"
        message="All tasks will be permanently removed. This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!pendingDeleteId) return
          const id = pendingDeleteId
          setPendingDeleteId(null)
          await deleteProject(id)
          onDelete?.()
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  )
}
