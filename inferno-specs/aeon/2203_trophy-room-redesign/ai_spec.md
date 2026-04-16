# Trophy Room Redesign -- AI Spec

**Date:** 22/03/2026
**Package:** aeon
**Ref:** human_spec.md

---

## Step 1: Create `trophy-utils.ts` -- Grouping Helper Functions

**File:** `src/components/trophy/trophy-utils.ts` (new file, ~120 lines)

**Purpose:** Pure utility functions for grouping TaskVault arrays. No React, no side effects.

```typescript
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  format,
  isToday,
  isThisWeek,
  isThisMonth,
} from 'date-fns'
import type { TaskVault } from '@/lib/db/schema'

export type ViewMode = 'timeline' | 'priority' | 'label'
export type DateGranularity = 'day' | 'week' | 'month'

export interface GroupedSection {
  key: string
  label: string
  count: number
  tasks: TaskVault[]
}

export function groupByTimeline(
  tasks: TaskVault[],
  granularity: DateGranularity
): GroupedSection[] {
  const buckets = new Map<string, TaskVault[]>()

  for (const task of tasks) {
    const date = new Date(task.archivedAt)
    let key: string
    let label: string

    if (granularity === 'day') {
      if (isToday(date)) {
        key = 'today'
        label = 'Today'
      } else {
        const start = startOfDay(date)
        key = start.toISOString()
        label = format(date, 'EEEE, d MMMM yyyy')
      }
    } else if (granularity === 'week') {
      if (isThisWeek(date, { weekStartsOn: 1 })) {
        key = 'this-week'
        label = 'This Week'
      } else {
        const start = startOfWeek(date, { weekStartsOn: 1 })
        key = start.toISOString()
        label = `Week of ${format(start, 'd MMM yyyy')}`
      }
    } else {
      if (isToday(date) || isThisWeek(date, { weekStartsOn: 1 })) {
        if (isToday(date)) {
          key = 'today'
          label = 'Today'
        } else {
          key = 'this-week'
          label = 'This Week'
        }
      } else if (isThisMonth(date)) {
        key = 'this-month'
        label = 'Earlier this Month'
      } else {
        const start = startOfMonth(date)
        key = start.toISOString()
        label = format(date, 'MMMM yyyy')
      }
    }

    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(task)
  }

  return Array.from(buckets.entries()).map(([key, tasks]) => ({
    key,
    label: buckets.size > 0 ? tasks[0] ? getLabelForKey(key, tasks[0], granularity) : key : key,
    count: tasks.length,
    tasks,
  }))
}

function getLabelForKey(key: string, task: TaskVault, granularity: DateGranularity): string {
  if (key === 'today') return 'Today'
  if (key === 'this-week') return 'This Week'
  if (key === 'this-month') return 'Earlier this Month'
  const date = new Date(task.archivedAt)
  if (granularity === 'day') return format(date, 'EEEE, d MMMM yyyy')
  if (granularity === 'week') return `Week of ${format(startOfWeek(date, { weekStartsOn: 1 }), 'd MMM yyyy')}`
  return format(date, 'MMMM yyyy')
}
```

Wait -- the above has a redundancy issue with labels computed twice. Simplify. The label should be computed inline during bucketing. Revised clean version:

```typescript
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  format,
  isToday,
  isThisWeek,
  isThisMonth,
} from 'date-fns'
import type { TaskVault } from '@/lib/db/schema'

export type ViewMode = 'timeline' | 'priority' | 'label'
export type DateGranularity = 'day' | 'week' | 'month'

export interface GroupedSection {
  key: string
  label: string
  tasks: TaskVault[]
}

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const
const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

function getTimelineBucket(
  date: Date,
  granularity: DateGranularity
): { key: string; label: string } {
  if (granularity === 'day') {
    if (isToday(date)) return { key: 'today', label: 'Today' }
    const start = startOfDay(date)
    return { key: start.toISOString(), label: format(date, 'EEEE, d MMMM yyyy') }
  }

  if (granularity === 'week') {
    if (isThisWeek(date, { weekStartsOn: 1 }))
      return { key: 'this-week', label: 'This Week' }
    const start = startOfWeek(date, { weekStartsOn: 1 })
    return { key: start.toISOString(), label: `Week of ${format(start, 'd MMM yyyy')}` }
  }

  if (isToday(date)) return { key: 'today', label: 'Today' }
  if (isThisWeek(date, { weekStartsOn: 1 }))
    return { key: 'this-week', label: 'This Week' }
  if (isThisMonth(date))
    return { key: 'this-month', label: 'Earlier this Month' }
  const start = startOfMonth(date)
  return { key: start.toISOString(), label: format(date, 'MMMM yyyy') }
}

export function groupByTimeline(
  tasks: TaskVault[],
  granularity: DateGranularity
): GroupedSection[] {
  const map = new Map<string, { label: string; tasks: TaskVault[] }>()

  for (const task of tasks) {
    const { key, label } = getTimelineBucket(new Date(task.archivedAt), granularity)
    if (!map.has(key)) map.set(key, { label, tasks: [] })
    map.get(key)!.tasks.push(task)
  }

  return Array.from(map.entries()).map(([key, { label, tasks }]) => ({
    key,
    label,
    tasks,
  }))
}

export function groupByPriority(tasks: TaskVault[]): GroupedSection[] {
  const map = new Map<string, TaskVault[]>()
  for (const p of PRIORITY_ORDER) map.set(p, [])

  for (const task of tasks) {
    const p = task.priority ?? 'medium'
    if (!map.has(p)) map.set(p, [])
    map.get(p)!.push(task)
  }

  return PRIORITY_ORDER.map((p) => ({
    key: p,
    label: PRIORITY_LABELS[p],
    tasks: map.get(p) ?? [],
  }))
}

export function groupByLabel(tasks: TaskVault[]): GroupedSection[] {
  const map = new Map<string, { label: string; color: string; tasks: TaskVault[] }>()
  const unlabeled: TaskVault[] = []

  for (const task of tasks) {
    const labels = (task.labelSnapshot ?? []) as Array<{ id?: string; name: string; color: string }>
    if (labels.length === 0) {
      unlabeled.push(task)
      continue
    }
    for (const lbl of labels) {
      const key = lbl.name.toLowerCase()
      if (!map.has(key)) map.set(key, { label: lbl.name, color: lbl.color, tasks: [] })
      map.get(key)!.tasks.push(task)
    }
  }

  const sections: GroupedSection[] = Array.from(map.entries()).map(([key, { label, tasks }]) => ({
    key,
    label,
    tasks,
  }))

  sections.sort((a, b) => b.tasks.length - a.tasks.length)

  if (unlabeled.length > 0) {
    sections.push({ key: 'unlabeled', label: 'Unlabeled', tasks: unlabeled })
  }

  return sections
}
```

**Validation:**
- Import and call each function with an empty array -- should return empty/all-empty sections
- `groupByPriority` always returns exactly 4 sections in order
- `groupByLabel` places multi-label tasks in multiple sections (intentional -- a task with 2 labels appears in both lanes)
- `groupByTimeline` with `month` granularity: today's task goes in "Today", yesterday's in "This Week" (if same week), etc.

---

## Step 2: Create `TrophySection.tsx` -- Collapsible Section Component

**File:** `src/components/trophy/TrophySection.tsx` (new file, ~80 lines)

**Props:**
```typescript
interface TrophySectionProps {
  label: string
  count: number
  tasks: TaskVault[]
  onRestore: (vaultId: string) => void
  defaultExpanded?: boolean
}
```

**Implementation:**

```typescript
'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { TrophyCard } from './TrophyCard'
import { cn } from '@/lib/utils/cn'
import type { TaskVault } from '@/lib/db/schema'

interface TrophySectionProps {
  label: string
  count: number
  tasks: TaskVault[]
  onRestore: (vaultId: string) => void
  defaultExpanded?: boolean
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
}

export function TrophySection({
  label,
  count,
  tasks,
  onRestore,
  defaultExpanded = true,
}: TrophySectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          'flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg',
          'hover:bg-white/[0.04] transition-colors duration-150 group'
        )}
      >
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-slate-400" />
        </motion.div>
        <span className="text-sm font-medium text-slate-300">{label}</span>
        <span className="text-xs text-slate-600 ml-1">
          {count} {count === 1 ? 'trophy' : 'trophies'}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <motion.div
              className="grid grid-cols-2 xl:grid-cols-3 gap-3 pt-2 px-1"
              variants={containerVariants}
              initial="hidden"
              animate="show"
            >
              {tasks.map((vt) => (
                <TrophyCard key={vt.id} vaultTask={vt} onRestore={onRestore} />
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

**Why this approach:**
- `defaultExpanded` prop allows first section to be open, older sections to start collapsed (reducing initial render cost)
- `AnimatePresence` + height animation gives smooth collapse without layout shift
- Stagger animation reused from original TrophyRoom for consistency
- Grid matches original 2-3 col layout

**Validation:**
- Clicking the section header toggles content visibility
- Chevron rotates 90deg when expanded
- Count badge shows correct number
- Cards render identically to current grid

---

## Step 3: Rewrite `TrophyRoom.tsx` -- New Layout with View Modes and Drawer

**File:** `src/components/trophy/TrophyRoom.tsx` (rewrite, target ~300 lines)

### 3a. New State and Imports

**Remove:** The `flex-[2]` permanent TrophyTimeline from the bottom layout.

**Add imports:**
```typescript
import { History, Clock, Tag, LayoutGrid, X } from 'lucide-react'
import { TrophySection } from './TrophySection'
import {
  groupByTimeline,
  groupByPriority,
  groupByLabel,
  type ViewMode,
  type DateGranularity,
  type GroupedSection,
} from './trophy-utils'
```

**Add state:**
```typescript
const [viewMode, setViewMode] = useState<ViewMode>('timeline')
const [dateGranularity, setDateGranularity] = useState<DateGranularity>('month')
const [drawerOpen, setDrawerOpen] = useState(false)
```

### 3b. Grouped Sections Memo

Replace the flat `filteredAndSorted` rendering with a sections memo:

```typescript
const sections = useMemo<GroupedSection[]>(() => {
  const sorted = [...filteredAndSorted]

  if (viewMode === 'timeline') {
    return groupByTimeline(sorted, dateGranularity)
  }
  if (viewMode === 'priority') {
    return groupByPriority(sorted)
  }
  return groupByLabel(sorted)
}, [filteredAndSorted, viewMode, dateGranularity])
```

**Key detail:** `filteredAndSorted` stays as-is (preserves sort/filter). The grouping functions organize already-sorted tasks into sections.

### 3c. SegmentedControl UI

Replace the area currently occupied by sort buttons row. The new toolbar contains:
1. View mode segmented control (left)
2. Date granularity toggle (visible only in timeline mode, center-left)
3. Existing sort + priority filter buttons (center)
4. Activity drawer toggle button (right)
5. Trophy count (far right)

```tsx
<div className="flex items-center gap-3 flex-wrap">
  {/* View Mode Segmented Control */}
  <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-lg p-0.5">
    {([
      { mode: 'timeline' as ViewMode, icon: Clock, label: 'Timeline' },
      { mode: 'priority' as ViewMode, icon: LayoutGrid, label: 'By Priority' },
      { mode: 'label' as ViewMode, icon: Tag, label: 'By Label' },
    ]).map(({ mode, icon: Icon, label }) => (
      <button
        key={mode}
        onClick={() => setViewMode(mode)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200',
          viewMode === mode
            ? 'bg-emerald-500/20 text-emerald-400 shadow-sm'
            : 'text-slate-400 hover:text-slate-300 hover:bg-white/[0.04]'
        )}
      >
        <Icon className="w-3.5 h-3.5" />
        {label}
      </button>
    ))}
  </div>

  {/* Date Granularity (timeline only) */}
  {viewMode === 'timeline' && (
    <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-lg p-0.5">
      {(['day', 'week', 'month'] as DateGranularity[]).map((g) => (
        <button
          key={g}
          onClick={() => setDateGranularity(g)}
          className={cn(
            'px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200',
            dateGranularity === g
              ? 'bg-white/[0.08] text-slate-200'
              : 'text-slate-500 hover:text-slate-400'
          )}
        >
          {g.charAt(0).toUpperCase() + g.slice(1)}
        </button>
      ))}
    </div>
  )}

  <div className="w-px h-4 bg-white/10 mx-1" />

  {/* Existing sort buttons (unchanged) */}
  <div className="flex items-center gap-1.5 text-xs text-slate-400">
    <SortAsc className="w-3.5 h-3.5" />
    <span>Sort</span>
  </div>
  {(['newest', 'oldest', 'priority', 'name'] as SortMode[]).map((mode) => (
    <button
      key={mode}
      onClick={() => setSortMode(mode)}
      className={cn(
        'px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200',
        sortMode === mode
          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
          : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-300 hover:bg-white/[0.07]'
      )}
    >
      {mode.charAt(0).toUpperCase() + mode.slice(1)}
    </button>
  ))}

  <div className="w-px h-4 bg-white/10 mx-1" />

  {/* Existing priority filter (unchanged) */}
  <div className="flex items-center gap-1.5 text-xs text-slate-400">
    <Filter className="w-3.5 h-3.5" />
    <span>Priority</span>
  </div>
  {(['all', 'urgent', 'high', 'medium', 'low'] as PriorityFilter[]).map((p) => (
    <button
      key={p}
      onClick={() => setPriorityFilter(p)}
      className={cn(
        'px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200',
        priorityFilter === p
          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
          : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-300 hover:bg-white/[0.07]'
      )}
    >
      {p.charAt(0).toUpperCase() + p.slice(1)}
    </button>
  ))}

  {/* Activity Drawer Toggle */}
  <button
    onClick={() => setDrawerOpen((prev) => !prev)}
    className={cn(
      'ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200',
      drawerOpen
        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
        : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-300 hover:bg-white/[0.07]'
    )}
  >
    <History className="w-3.5 h-3.5" />
    Activity
  </button>

  <span className="text-xs text-slate-500">
    {filteredAndSorted.length} / {vaultStats?.total ?? 0} trophies
  </span>
</div>
```

### 3d. Main Content Area -- Sections Replace Flat Grid

**Remove** the old `flex gap-4 flex-1` layout with `flex-[3]` grid + `flex-[2]` timeline.

**Replace with:**

```tsx
<div className="flex-1 min-h-0 overflow-y-auto relative">
  {isLoadingVault ? (
    <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
      Loading vault...
    </div>
  ) : filteredAndSorted.length === 0 ? (
    /* Same empty state as current -- unchanged */
    <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3 py-20">
      <div
        className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center"
        style={glowIntensity > 0 ? { boxShadow: `0 0 ${20 * (glowIntensity / 75)}px rgba(16,185,129,0.15)` } : undefined}
      >
        <Trophy className="w-7 h-7 opacity-30" />
      </div>
      <p className="text-sm">No trophies yet</p>
      <p className="text-xs text-slate-600">Complete tasks and send them to the vault</p>
    </div>
  ) : viewMode === 'priority' ? (
    /* Priority: horizontal swim lanes */
    <div className="grid grid-cols-4 gap-4 h-full pb-4">
      {sections.map((section) => (
        <div key={section.key} className="flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-2 py-1.5 mb-2 border-b border-white/[0.06]">
            <span className="text-sm font-medium text-slate-300">{section.label}</span>
            <span className="text-xs text-slate-600">{section.tasks.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 px-1">
            {section.tasks.map((vt) => (
              <TrophyCard key={vt.id} vaultTask={vt} onRestore={handleRestore} />
            ))}
          </div>
        </div>
      ))}
    </div>
  ) : (
    /* Timeline and Label: collapsible sections */
    <div className="pb-4">
      {sections.map((section, idx) => (
        <TrophySection
          key={section.key}
          label={section.label}
          count={section.tasks.length}
          tasks={section.tasks}
          onRestore={handleRestore}
          defaultExpanded={idx < 3}
        />
      ))}
    </div>
  )}

  {/* Activity Drawer Overlay */}
  <AnimatePresence>
    {drawerOpen && (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => setDrawerOpen(false)}
        />
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed top-0 right-0 h-full w-[400px] max-w-[90vw] z-50 bg-[#111] border-l border-white/[0.08] shadow-2xl"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
            <span className="text-sm font-semibold text-white">Activity Timeline</span>
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="h-[calc(100%-57px)]">
            <TrophyTimeline
              projectId={projectId}
              events={timelineEvents}
              onLoadMore={loadMoreTimeline}
              hasMore={hasMoreEvents}
              isLoading={isLoadingTimeline}
            />
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
</div>
```

**Why this layout approach:**
- Priority mode uses `grid-cols-4` for true swim lanes -- each lane scrolls independently
- Timeline and Label modes both use vertical collapsible sections via TrophySection
- `defaultExpanded={idx < 3}` keeps first 3 sections open, older sections collapsed for performance
- Drawer uses `fixed` positioning with backdrop overlay, independent of content scroll
- Spring animation on drawer matches existing framer-motion patterns in the project

### 3e. Mobile Responsiveness

For the priority swim lanes, add responsive breakpoint:

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 h-full pb-4">
```

This stacks swim lanes vertically on small screens, 2-col on medium, full 4-col on large.

The SegmentedControl wraps naturally via `flex-wrap` already on the toolbar.

### 3f. Full Updated Import List for TrophyRoom.tsx

```typescript
'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, Filter, SortAsc, History, Clock, Tag, LayoutGrid, X } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { getActivityFeed } from '@/lib/actions/activity'
import { getVaultTasks, getVaultStatsSA, restoreVaultTask } from '@/lib/actions/vault'
import { useBoardStore } from '@/lib/store/boardStore'
import { TrophyCard } from './TrophyCard'
import { TrophyStats } from './TrophyStats'
import { TrophyTimeline } from './TrophyTimeline'
import { TrophySection } from './TrophySection'
import {
  groupByTimeline,
  groupByPriority,
  groupByLabel,
  type ViewMode,
  type DateGranularity,
  type GroupedSection,
} from './trophy-utils'
import { cn } from '@/lib/utils/cn'
import type { ActivityEvent, TaskVault } from '@/lib/db/schema'
```

---

## Step 4: Validation Checkpoints

### After Step 1 (trophy-utils.ts):
- TypeScript compiles without errors: `npx tsc --noEmit`
- Functions are pure -- no React hooks, no imports from React

### After Step 2 (TrophySection.tsx):
- Component renders a list of TrophyCards within a collapsible container
- Clicking header toggles expanded state
- Empty tasks array renders section header with "0 trophies" but no grid

### After Step 3 (TrophyRoom.tsx):
- Default view is Timeline with Month granularity
- Switching view modes changes section layout immediately
- Sort/filter buttons still work within all views
- Activity button opens drawer from right side
- Clicking backdrop closes drawer
- Total trophy count still shows correctly
- Restore functionality still works (card removed from vault, added to board)

### Edge Cases:
- **Zero vault tasks**: Empty state shown (unchanged from current)
- **All tasks same priority**: Priority view shows all cards in one lane, others empty
- **No labels on any task**: Label view shows only "Unlabeled" section
- **Task with multiple labels**: Appears in multiple label sections (intentional duplication)
- **Large vault (500+ tasks)**: Collapsed sections prevent rendering all cards at once

---

## Step 5: Testing Strategy

### Manual Testing Checklist:
1. Load Trophy Room with existing vault data
2. Verify TrophyStats renders unchanged at top
3. Toggle between Timeline / By Priority / By Label -- verify correct grouping
4. In Timeline mode, toggle Day / Week / Month -- verify section headers update
5. Click section headers to collapse/expand
6. Click Activity button -- verify drawer slides in from right
7. Click backdrop or X to close drawer
8. Apply priority filter -- verify all view modes respect the filter
9. Change sort mode -- verify order within sections updates
10. Restore a task from any view mode -- verify card disappears and board updates
11. Test on narrow viewport (mobile) -- verify swim lanes stack, toolbar wraps

### What Must Not Break:
- TrophyCard rendering and interactions
- TrophyStats data display
- TrophyTimeline pagination (load more)
- Vault task restoration flow
- Glow theme intensity effects
- Board store integration on restore

---

## File Summary

| File | Action | Est. Lines |
|------|--------|-----------|
| `src/components/trophy/trophy-utils.ts` | Create | ~110 |
| `src/components/trophy/TrophySection.tsx` | Create | ~75 |
| `src/components/trophy/TrophyRoom.tsx` | Rewrite | ~310 |
| `src/components/trophy/TrophyCard.tsx` | No change | 177 |
| `src/components/trophy/TrophyStats.tsx` | No change | 147 |
| `src/components/trophy/TrophyTimeline.tsx` | No change | 158 |
