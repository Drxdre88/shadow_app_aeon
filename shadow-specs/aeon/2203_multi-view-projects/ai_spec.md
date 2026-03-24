# Multi-View Project Selector - Implementation Spec

---

## Step 0: Install Dependency

```bash
npm install react-force-graph-2d
```

**Validation:** `package.json` contains `react-force-graph-2d` in dependencies.

---

## Step 0b: Add `group` Field to Projects (DB Migration)

**File:** `src/lib/db/schema.ts`

Add to the `projects` table definition:

```typescript
group: text('group'),
```

This is a nullable text field. `null` or empty string = "General" group.

**Migration:** Run `npx drizzle-kit generate` then `npx drizzle-kit push` (or `migrate` depending on workflow).

**File:** `src/lib/data/projects.ts`

Add these functions:

```typescript
export async function setProjectGroup(projectId: string, group: string | null) {
  await db
    .update(projects)
    .set({ group: group || null })
    .where(eq(projects.id, projectId))
}

export async function renameGroup(userId: string, oldName: string, newName: string) {
  await db
    .update(projects)
    .set({ group: newName })
    .where(and(eq(projects.userId, userId), eq(projects.group, oldName)))
}
```

**File:** `src/lib/actions/projects.ts`

Add server actions:

```typescript
export async function setProjectGroup(projectId: string, group: string | null) {
  const userId = await requireAuth()
  return _setProjectGroup(projectId, group)
}

export async function renameProjectGroup(oldName: string, newName: string) {
  const userId = await requireAuth()
  return _renameGroup(userId, oldName, newName)
}
```

**Why:** Fluid grouping requires only a string field, not a rigid entity. Renaming cascades via a single UPDATE WHERE. Projects without a group default to "General" in the UI layer, not the DB — this lets `null` mean "never grouped" which the UI renders as General.

---

## Step 1: Add `findProjectsWithStats` Data Query

**File:** `src/lib/data/projects.ts`

**Add after existing `findProjects` function (line ~25):**

```typescript
export async function findProjectsWithStats(userId: string) {
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      timeScale: projects.timeScale,
      startDate: projects.startDate,
      endDate: projects.endDate,
      settings: projects.settings,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      userId: projects.userId,
      group: projects.group,
      totalTasks: sql<number>`coalesce((
        select count(*)::int from board_tasks
        where board_tasks.project_id = ${projects.id}
      ), 0)`,
      doneTasks: sql<number>`coalesce((
        select count(*)::int from board_tasks
        where board_tasks.project_id = ${projects.id}
        and board_tasks.status = 'done'
      ), 0)`,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt))

  return projectRows.map((row) => ({
    ...row,
    completionPct: row.totalTasks > 0 ? Math.round((row.doneTasks / row.totalTasks) * 100) : 0,
  }))
}
```

**Why:** Single query with correlated subqueries avoids N+1. Returns everything the views need.

**Validation:** Verify the query returns projects with `totalTasks`, `doneTasks`, and `completionPct` fields.

---

## Step 2: Add Server Action

**File:** `src/lib/actions/projects.ts`

**Add import at top:**

```typescript
import {
  findProjects as _findProjects,
  findProjectsWithStats as _findProjectsWithStats,
  createProject as _createProject,
  updateProject as _updateProject,
  deleteProject as _deleteProject,
} from '@/lib/data/projects'
```

**Add after `getProjects` function:**

```typescript
export async function getProjectsWithStats() {
  const userId = await requireAuth()
  return _findProjectsWithStats(userId)
}
```

**Validation:** Call from dashboard page, verify stats fields are present.

---

## Step 3: Update Dashboard Page to Fetch Stats

**File:** `src/app/dashboard/page.tsx`

**Replace contents:**

```typescript
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getProjectsWithStats } from '@/lib/actions/projects'
import DashboardContent from './DashboardContent'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const projects = await getProjectsWithStats()

  return <DashboardContent user={session.user} projects={projects} />
}
```

**Why:** Switch to stats-enriched query at the page level so all views get the data.

---

## Step 4: Create `useViewPreference` Hook

**File:** `src/components/project/useViewPreference.ts` (NEW)

```typescript
'use client'

import { useState, useCallback, useEffect } from 'react'

export type ProjectViewMode = 'grid' | 'tree' | 'constellation'

const STORAGE_KEY = 'aeon-project-view'

export function useViewPreference(): [ProjectViewMode, (mode: ProjectViewMode) => void] {
  const [view, setViewState] = useState<ProjectViewMode>('grid')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ProjectViewMode | null
    if (stored && ['grid', 'tree', 'constellation'].includes(stored)) {
      setViewState(stored)
    }
  }, [])

  const setView = useCallback((mode: ProjectViewMode) => {
    setViewState(mode)
    localStorage.setItem(STORAGE_KEY, mode)
  }, [])

  return [view, setView]
}
```

**Why:** Simple hook isolates localStorage concern. SSR-safe with useEffect hydration.

**Validation:** Switch views, refresh page, view should persist.

---

## Step 5: Create `GridView` Component

**File:** `src/components/project/GridView.tsx` (NEW)

This is the polished version of the current project cards, extracted from DashboardContent.

```typescript
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Calendar, Trash2, Pencil, Palette } from 'lucide-react'
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
  resolveColor,
} from '@/lib/utils/colors'
import { cn } from '@/lib/utils/cn'
import type { ProjectWithStats } from './types'

interface GridViewProps {
  projects: ProjectWithStats[]
  onEdit: (project: ProjectWithStats) => void
}

export function GridView({ projects, onEdit }: GridViewProps) {
  const router = useRouter()
  const { glowIntensity, projectColors, setProjectColor, shortcuts } = useThemeStore()
  const mult = glowIntensity / 75
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)
  const [colorPickerProjectId, setColorPickerProjectId] = useState<string | null>(null)
  const projectListRef = useRef<HTMLDivElement>(null)

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
    if (!confirm('Delete this project? All tasks will be permanently removed.')) return
    await deleteProject(projectId)
    router.refresh()
  }

  return (
    <div ref={projectListRef} className="flex flex-wrap gap-4">
      {projects.map((project) => {
        const projectColor = (projectColors[project.id] || 'purple') as AccentColor
        return (
          <div key={project.id} className="relative w-full sm:w-72" data-project-id={project.id}>
            <Link href={`/project/${project.id}`}>
              <GlowCard accentColor={projectColor} glowIntensity="sm" showAccentLine hover>
                <div className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-semibold text-white truncate">{project.name}</h3>
                    <div className="flex items-center gap-0.5">
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setColorPickerProjectId((prev) => prev === project.id ? null : project.id)
                        }}
                        className="p-1.5 rounded-lg text-[var(--text-dim)] hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                      >
                        <Palette className="w-3.5 h-3.5" />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(project) }}
                        className="p-1.5 rounded-lg text-[var(--text-dim)] hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => handleDelete(e, project.id)}
                        className="p-1.5 rounded-lg text-[var(--text-dim)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>
                  </div>
                  {project.description && (
                    <p className="text-xs text-[var(--text-dim)] mt-1 line-clamp-2">{project.description}</p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${project.completionPct}%`,
                          backgroundColor: colorConfig[projectColor]?.hex ?? projectColor,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-[var(--text-dim)] tabular-nums w-8 text-right">
                      {project.completionPct}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-[var(--text-muted)]">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(project.startDate).toLocaleDateString()}
                    </span>
                    <span className="text-[var(--text-dim)]">
                      {project.totalTasks} task{project.totalTasks !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </GlowCard>
            </Link>
            {colorPickerProjectId === project.id && (() => {
              const recent = getRecentColors()
              return (
                <div className="absolute top-full left-0 mt-2 z-50 p-3 rounded-xl backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.6)] space-y-2">
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
                  {recent.length > 0 && (
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
                  )}
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
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}
```

**Why:** Direct extraction from DashboardContent with added progress bar and task count stats. Color picker logic preserved exactly.

**Validation:** Grid view should look identical to current dashboard project cards, plus progress bar and task count.

---

## Step 6: Create Shared Types

**File:** `src/components/project/types.ts` (NEW)

```typescript
import type { Project } from '@/lib/db/schema'

export interface ProjectWithStats extends Project {
  group: string | null
  totalTasks: number
  doneTasks: number
  completionPct: number
}
```

**Why:** Shared type used across all three views and the switcher.

---

## Step 7: Create `TreeView` Component

**File:** `src/components/project/TreeView.tsx` (NEW)

```typescript
'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, FolderOpen, Folder, LayoutGrid } from 'lucide-react'
import Link from 'next/link'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, type AccentColor, resolveColor } from '@/lib/utils/colors'
import type { ProjectWithStats } from './types'

interface TreeViewProps {
  projects: ProjectWithStats[]
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

export function TreeView({ projects }: TreeViewProps) {
  const { projectColors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(groupByFluidGroup(projects).map((g) => g.label))
  )
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const groups = groupByFluidGroup(projects)
  const allItems: { type: 'group'; label: string; index: number }[] | { type: 'project'; project: ProjectWithStats; groupLabel: string; index: number }[] = []
  const flatItems: Array<{ type: 'group'; label: string } | { type: 'project'; project: ProjectWithStats; groupLabel: string }> = []

  for (const group of groups) {
    flatItems.push({ type: 'group', label: group.label })
    if (expandedGroups.has(group.label)) {
      for (const project of group.projects) {
        flatItems.push({ type: 'project', project, groupLabel: group.label })
      }
    }
  }

  const toggleGroup = useCallback((label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

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
          <div key={group.label}>
            <button
              onClick={() => toggleGroup(group.label)}
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
              <span className="text-sm font-medium text-[var(--text-secondary)]">{group.label}</span>
              <span className="ml-auto text-[10px] text-[var(--text-dim)] tabular-nums">
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
                  {group.projects.map((project, pi) => {
                    const projectColor = (projectColors[project.id] || 'purple') as AccentColor
                    const resolved = resolveColor(projectColor)
                    const itemFlatIdx = flatItems.findIndex(
                      (f) => f.type === 'project' && f.project.id === project.id
                    )
                    return (
                      <Link key={project.id} href={`/project/${project.id}`}>
                        <div
                          className={`flex items-center gap-2 pl-11 pr-4 py-2 transition-colors hover:bg-white/5 group ${
                            focusedIndex === itemFlatIdx ? 'bg-white/10' : ''
                          }`}
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
                          <div className="flex items-center gap-2 ml-2">
                            <div className="w-16 h-1 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${project.completionPct}%`,
                                  backgroundColor: resolved.hex,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-[var(--text-dim)] tabular-nums w-12 text-right">
                              {project.totalTasks} tasks
                            </span>
                          </div>
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
    </div>
  )
}
```

**Why:** Groups projects by the `group` field (fluid string, not rigid entity). Ungrouped projects land in "General". Keyboard navigation with arrow keys + enter. Connecting lines give VS Code tree feel. Collapse animations via framer-motion.

**Fluid Grouping Interactions (add to TreeView):**
- Double-click group header label to inline-edit group name. On blur/enter, call `renameProjectGroup(oldName, newName)` server action. All projects in that group auto-cascade.
- Drag a project row to a different group header to re-assign. On drop, call `setProjectGroup(projectId, targetGroupLabel)`.
- Right-click group header > "New Group" inserts an empty group header with editable name.
- "General" group cannot be renamed or deleted (it's the catch-all).

**Validation:**
- Arrow keys navigate up/down, Enter toggles group expand
- Collapse/expand is animated
- Progress bars show correct percentages
- Clicking a project navigates to `/project/[id]`
- Double-click group name to rename, all projects in group follow
- Drag project to different group header to re-assign

---

## Step 8: Create `ConstellationView` Component

**File:** `src/components/project/ConstellationView.tsx` (NEW)

```typescript
'use client'

import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useThemeStore } from '@/stores/themeStore'
import { resolveColor, type AccentColor } from '@/lib/utils/colors'
import type { ProjectWithStats } from './types'

interface ConstellationViewProps {
  projects: ProjectWithStats[]
}

interface GraphNode {
  id: string
  name: string
  val: number
  color: string
  glow: string
  completionPct: number
  totalTasks: number
}

interface GraphLink {
  source: string
  target: string
}

export function ConstellationView({ projects }: ConstellationViewProps) {
  const router = useRouter()
  const { projectColors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 })
  const [ForceGraph, setForceGraph] = useState<any>(null)

  useEffect(() => {
    import('react-force-graph-2d').then((mod) => {
      setForceGraph(() => mod.default)
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height: Math.max(height, 400) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = projects.map((p) => {
      const colorKey = (projectColors[p.id] || 'purple') as AccentColor
      const resolved = resolveColor(colorKey)
      return {
        id: p.id,
        name: p.name,
        val: Math.max(3, Math.sqrt(p.totalTasks + 1) * 4),
        color: resolved.hex,
        glow: resolved.glow,
        completionPct: p.completionPct,
        totalTasks: p.totalTasks,
      }
    })

    const links: GraphLink[] = []
    const byGroup = new Map<string, string[]>()
    for (const p of projects) {
      const key = p.group || 'General'
      if (!byGroup.has(key)) byGroup.set(key, [])
      byGroup.get(key)!.push(p.id)
    }
    for (const ids of byGroup.values()) {
      for (let i = 0; i < ids.length - 1; i++) {
        links.push({ source: ids[i], target: ids[i + 1] })
      }
    }

    return { nodes, links }
  }, [projects, projectColors])

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const { x, y, name, val, color, glow, completionPct } = node as GraphNode & { x: number; y: number }
    const radius = val

    if (glowIntensity > 0) {
      ctx.beginPath()
      ctx.arc(x, y, radius + 4 * mult, 0, 2 * Math.PI)
      const gradient = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius + 8 * mult)
      gradient.addColorStop(0, glow)
      gradient.addColorStop(1, 'transparent')
      ctx.fillStyle = gradient
      ctx.fill()
    }

    if (completionPct > 0 && completionPct < 100) {
      ctx.beginPath()
      ctx.arc(x, y, radius + 1, -Math.PI / 2, -Math.PI / 2 + (2 * Math.PI * completionPct / 100))
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.arc(x, y, radius, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.85
    ctx.fill()
    ctx.globalAlpha = 1

    if (globalScale > 1.2) {
      ctx.font = `${Math.max(10, 12 / globalScale)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.fillText(name, x, y + radius + 4)
    }
  }, [glowIntensity, mult])

  const handleNodeClick = useCallback((node: any) => {
    router.push(`/project/${node.id}`)
  }, [router])

  const linkColor = useCallback(() => 'rgba(255, 255, 255, 0.06)', [])

  if (!ForceGraph) {
    return (
      <div ref={containerRef} className="w-full h-[500px] rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
        <div className="text-[var(--text-dim)] text-sm">Loading constellation...</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full h-[500px] rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden relative">
      <ForceGraph
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.val + 4, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        onNodeClick={handleNodeClick}
        linkColor={linkColor}
        linkWidth={0.5}
        linkDirectionalParticles={0}
        backgroundColor="transparent"
        cooldownTicks={100}
        nodeLabel={(node: any) => `${node.name} (${node.totalTasks} tasks, ${node.completionPct}%)`}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />
      <div className="absolute bottom-3 right-3 text-[10px] text-[var(--text-dim)] bg-black/40 px-2 py-1 rounded-md backdrop-blur-sm">
        Scroll to zoom, drag to pan, click to open
      </div>
    </div>
  )
}
```

**Why:** Dynamic import of `react-force-graph-2d` to avoid SSR issues (canvas). Nodes sized by task count. Glow intensity respects global theme setting. `cooldownTicks=100` stops simulation after initial layout to save CPU. Links connect projects in same `group` (gravitational clustering — nodes with same group naturally pull together). Custom canvas paint adds glow halos and progress arcs. When a project's group changes, `graphData` recalculates and the force simulation re-runs — nodes visually migrate between clusters with smooth animation.

**Validation:**
- Nodes appear as colored circles with glow halos
- Scroll zooms, drag pans
- Clicking a node navigates to project
- Hover shows tooltip with name/stats
- Labels appear when zoomed in past 1.2x

---

## Step 9: Create `ProjectViewSwitcher` Component

**File:** `src/components/project/ProjectViewSwitcher.tsx` (NEW)

```typescript
'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LayoutGrid, GitBranch, Sparkles } from 'lucide-react'
import { useViewPreference, type ProjectViewMode } from './useViewPreference'
import { GridView } from './GridView'
import { TreeView } from './TreeView'
import { ConstellationView } from './ConstellationView'
import type { ProjectWithStats } from './types'

interface ProjectViewSwitcherProps {
  projects: ProjectWithStats[]
  onEdit: (project: ProjectWithStats) => void
}

const VIEW_OPTIONS: { value: ProjectViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'tree', label: 'Tree', icon: GitBranch },
  { value: 'constellation', label: 'Stars', icon: Sparkles },
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

export function ProjectViewSwitcher({ projects, onEdit }: ProjectViewSwitcherProps) {
  const [view, setView] = useViewPreference()
  const isMobile = useIsMobile()
  const effectiveView = isMobile && view === 'constellation' ? 'grid' : view

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
          {effectiveView === 'grid' && <GridView projects={projects} onEdit={onEdit} />}
          {effectiveView === 'tree' && <TreeView projects={projects} />}
          {effectiveView === 'constellation' && <ConstellationView projects={projects} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
```

**Why:** SegmentedControl built from scratch (no extra dependency) with framer-motion `layoutId` for the sliding indicator. AnimatePresence provides crossfade. Mobile auto-fallback.

**Validation:**
- Clicking each segment switches view with crossfade
- Sliding indicator follows active selection
- On mobile (<768px), constellation auto-falls back to grid
- Label text hidden on small screens, icons always visible

---

## Step 10: Refactor `DashboardContent.tsx`

**File:** `src/app/dashboard/DashboardContent.tsx`

**Replace the entire file with this slimmed version:**

```typescript
'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Plus, LogOut, Eye, Crown, FolderOpen } from 'lucide-react'
import Image from 'next/image'
import aeonLogo from '@/assets/aeon.png'
import Link from 'next/link'
import { SettingsButton } from '@/components/ui/SettingsModal'
import { HelpButton } from '@/components/ui/HelpModal'
import { GlowCard } from '@/components/ui/GlowCard'
import { NeonButton } from '@/components/ui/NeonButton'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { EditProjectModal } from '@/components/project/EditProjectModal'
import { ProjectViewSwitcher } from '@/components/project/ProjectViewSwitcher'
import { GlassStage } from '@/components/ui/GlassStage'
import { useThemeStore } from '@/stores/themeStore'
import type { ProjectWithStats } from '@/components/project/types'

interface DashboardContentProps {
  user: {
    id: string
    role: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
  projects: ProjectWithStats[]
}

export default function DashboardContent({ user, projects }: DashboardContentProps) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectWithStats | null>(null)
  const isAdmin = user.role === 'admin'
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  return (
    <div className="min-h-screen">
      <GlassStage
        blobConfig={{
          blobs: [
            { position: 'top-[10%] right-[15%]', size: 'w-[500px] h-[500px]', color: 'glow', opacity: 0.12 },
            { position: 'bottom-[20%] left-[10%]', size: 'w-[400px] h-[400px]', color: 'primary', opacity: 0.08, delay: 7 },
          ]
        }}
      />

      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="px-3 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Image
              src={aeonLogo}
              alt="Aeon"
              width={28}
              height={28}
              className="rounded"
              style={{ filter: `drop-shadow(0 0 ${6 * mult}px var(--glow-color))` }}
            />
            <span
              className="text-xl font-bold"
              style={{
                color: '#8a8f98',
                textShadow: '0 0 10px rgba(138, 143, 152, 0.3)',
              }}
            >
              Aeon
            </span>
            {isAdmin && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                <Crown className="w-3 h-3" />
                Admin
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <HelpButton />
            <SettingsButton />
            <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-4 border-l border-white/10">
              {user.image ? (
                <img
                  src={user.image}
                  alt={user.name || ''}
                  className="w-8 h-8 rounded-full border border-white/20"
                  style={{
                    boxShadow: glowIntensity > 0
                      ? `0 0 ${10 * mult}px ${2 * mult}px var(--glow-color)`
                      : undefined,
                  }}
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center text-xs font-semibold"
                  style={{
                    background: 'var(--primary-muted)',
                    color: 'var(--text-secondary)',
                    boxShadow: glowIntensity > 0
                      ? `0 0 ${10 * mult}px ${2 * mult}px var(--glow-color)`
                      : undefined,
                  }}
                >
                  {(user.name || user.email || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm text-[var(--text-muted)] hidden sm:block">
                {user.name || user.email}
              </span>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => signOut({ callbackUrl: '/' })}
                className="p-2 rounded-lg text-[var(--text-dim)] hover:text-[var(--error)] hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-6 py-4 sm:py-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            Welcome back, {user.name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-[var(--text-muted)]">
            Manage your projects and timelines
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex flex-wrap gap-4 mb-10"
        >
          <div onClick={() => setShowCreateModal(true)} className="w-full sm:w-64">
            <GlowCard accentColor="purple" glowIntensity="sm" showAccentLine hover>
              <div className="flex items-center gap-3 p-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/15">
                  <Plus className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">New Project</h3>
                  <p className="text-xs text-[var(--text-dim)]">Create timeline & board</p>
                </div>
              </div>
            </GlowCard>
          </div>

          <Link href="/demo" className="w-full sm:w-64">
            <GlowCard accentColor="cyan" glowIntensity="sm" showAccentLine hover>
              <div className="flex items-center gap-3 p-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-500/15">
                  <Eye className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">View Demo</h3>
                  <p className="text-xs text-[var(--text-dim)]">Explore sample project</p>
                </div>
              </div>
            </GlowCard>
          </Link>

          <div className="w-full sm:w-64">
            <GlowCard accentColor="green" glowIntensity="sm" showAccentLine>
              <div className="flex items-center gap-3 p-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/15">
                  <FolderOpen className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{projects.length} Project{projects.length !== 1 ? 's' : ''}</h3>
                  <p className="text-xs text-[var(--text-dim)]">{projects.length === 0 ? 'Get started below' : 'Active'}</p>
                </div>
              </div>
            </GlowCard>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]">
              <p className="text-[var(--text-muted)] mb-1">No projects yet</p>
              <p className="text-sm text-[var(--text-dim)] mb-6">Create your first project to get started</p>
              <NeonButton color="purple" glowIntensity="md" onClick={() => setShowCreateModal(true)}>
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create First Project
                </span>
              </NeonButton>
            </div>
          ) : (
            <ProjectViewSwitcher projects={projects} onEdit={setEditingProject} />
          )}
        </motion.div>
      </main>

      <CreateProjectModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      {editingProject && (
        <EditProjectModal
          isOpen={true}
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />
      )}
    </div>
  )
}
```

**Key changes from original:**
- Removed all project card rendering logic (moved to GridView)
- Removed color picker state/logic (moved to GridView)
- Removed hover tracking state/effects (moved to GridView)
- Added `ProjectViewSwitcher` import and usage
- Changed `Project` type to `ProjectWithStats`
- Removed `Calendar, LayoutGrid, Trash2, Pencil, Palette` imports (no longer needed here)
- Removed `useRouter`, `useRef`, `useEffect`, `useCallback` imports (no longer needed here)
- Removed `deleteProject`, color utils imports
- Result: ~170 lines (down from 415)

**Validation:** Dashboard should render identically in Grid view. Switching to Tree/Constellation should work.

---

## Step 11: Handle Type Compatibility with EditProjectModal

The `EditProjectModal` currently expects a `Project` type. `ProjectWithStats` extends `Project`, so it will be compatible. However, verify the `EditProjectModal` props interface accepts the extended type.

If `EditProjectModal` has a strict `project: Project` prop, it will still work because `ProjectWithStats extends Project` means it's structurally compatible in TypeScript.

**Validation:** TypeScript compilation should pass without errors on the `editingProject` state.

---

## Validation Checkpoints

### After Step 2 (Server Action)
```typescript
const projects = await getProjectsWithStats()
console.log(projects[0].totalTasks, projects[0].completionPct)
```

### After Step 5 (GridView)
- Grid view should match current dashboard exactly, plus progress bar
- Color picker should work identically

### After Step 7 (TreeView)
- Projects grouped by timeScale
- Arrow keys navigate, Enter toggles groups
- Expand/collapse animated

### After Step 8 (ConstellationView)
- Force graph renders without SSR errors
- Nodes glow, click navigates
- Scroll zooms, drag pans

### After Step 10 (Full Integration)
- All three views switchable
- View persists across refresh
- No TypeScript errors
- DashboardContent.tsx < 200 lines
- All new files < 300 lines

---

## Testing Strategy

**Manual Testing:**
1. Create 5+ projects (some with groups, some ungrouped)
2. Add tasks to projects (varying counts)
3. Complete some tasks to verify progress percentages
4. Switch between all three views
5. Refresh page to verify localStorage persistence
6. Resize browser to mobile width, verify constellation falls back to grid
7. Test keyboard navigation in tree view
8. Double-click group name in tree view, rename it, verify all projects cascade
9. Drag a project to a different group in tree view
10. Verify constellation nodes animate when group changes

**Edge Cases:**
- 0 projects (empty state should show, no view switcher)
- All projects ungrouped (single "General" group in tree, one cluster in constellation)
- 1 project (constellation with single node)
- Project with 0 tasks (0% progress, small node in constellation)
- Very long project names (truncation in tree and grid)

**Performance:**
- 50+ projects in constellation view (should remain smooth with cooldownTicks=100)
- Rapid view switching (AnimatePresence should handle exit/enter correctly)

---

## File Size Estimates

| File | Estimated Lines |
|------|-----------------|
| `ProjectViewSwitcher.tsx` | ~85 |
| `GridView.tsx` | ~180 |
| `TreeView.tsx` | ~160 |
| `ConstellationView.tsx` | ~150 |
| `useViewPreference.ts` | ~20 |
| `types.ts` | ~8 |
| `DashboardContent.tsx` (refactored) | ~170 |

All within the 300-line limit.
