# SHADOW PROWLER RECONNAISSANCE
**Mission:** Trophy Room Feature - Architectural Intelligence Report
**Date:** 14/03/2026 | **Target:** shadow_app_aeon (Next.js 16 + React 19)

---

## Mission Objective

Map all structural dependencies, data sources, animation patterns, theme capabilities, and integration points required to build a "Trophy Room" — a visually stunning display of completed task history and project achievements within the existing Aeon tab system.

---

## Structural Intelligence

### Class Architecture

**Tab System (ProjectContent.tsx)**
- State: `activeTab: 'board' | 'gantt' | 'canvas'` — a simple string union in `useState`
- Tab buttons live in a sticky `<header>` nav bar with per-tab color assignments:
  - Board: `bg-purple-500/20 text-purple-400 border border-purple-500/30`
  - Gantt: `bg-cyan-500/20 text-cyan-400 border border-cyan-500/30`
  - Canvas: `bg-amber-500/20 text-amber-400 border border-amber-500/30`
- Adding a new tab requires: (1) extend the union type, (2) add a nav button, (3) add a conditional render block in `<main>`, (4) add a Lucide icon, (5) optionally add per-tab header controls
- Each tab has a corresponding data load inside the single `useEffect` — the trophy room can load lazily (only on tab activation) or as part of the initial load

**Board Store (boardStore.ts)**
- `BoardTask` interface fields available for trophy display:
  - `id`, `name`, `description`, `status` (string — `'done'` = completed)
  - `priority: 'low' | 'medium' | 'high' | 'urgent'`
  - `color` (accent color name OR hex string)
  - `labels: string[]` (label IDs)
  - `startDate?`, `endDate?` (ISO strings)
  - `onTimeline: boolean`
  - `size?: number | null` (story-point-style sizing)
  - `updatedAt?: string` (ISO — serves as completion timestamp proxy)
  - `orderIndex`, `ganttTaskId`
- `checklistSummaries: Record<string, ChecklistSummary>` — per-task `{ checked, crossed, total }`
- Tasks with `status === 'done'` are the trophy candidates; filter in-store — no extra DB call needed for basic list

**DB Schema — boardTasks table**
- Includes: `startDate`, `endDate`, `size`, `onTimeline`, `metadata` (JSONB), `createdAt`, `updatedAt`
- `updatedAt` is updated on every `updateTask()` call — reliable as "completed at" timestamp when filtered to `status='done'`

**DB Schema — activityEvents table**
- Columns: `id`, `projectId`, `entityType`, `entityId`, `action`, `entityName`, `metadata` (JSONB), `createdAt`
- Action values: `'created' | 'updated' | 'deleted' | 'moved' | 'completed' | 'dependency_added' | 'dependency_removed' | 'label_added' | 'label_removed'`
- Entity types: `'task' | 'column' | 'dependency' | 'label' | 'gantt_task' | 'canvas_node' | 'project'`
- The `'completed'` action is emitted in `updateBoardTask()` precisely when `data.status === 'done'` — this is the trophy trigger event
- `metadata` stores `{ toColumnId }` for moves; for `'completed'` events metadata is `{}`
- `entityName` stores the task name at completion time — survives task deletion
- **Critical:** `findActivityEvents()` supports filtering by `entityType`, `entityId`, cursor-based pagination, limit — fully queryable for a trophy timeline

### Component Relationships

```
ProjectContent.tsx
  ├── GlassStage (ambient background effects)
  ├── <header> sticky nav
  │     ├── Tab buttons (board / gantt / canvas)
  │     └── Per-tab controls (Filter, Deps, Connect | GanttViewSelector | nothing for canvas)
  └── <main>
        ├── LoadingState (shimmer skeleton)
        ├── ErrorState (AlertTriangle + Retry)
        └── TabContent (conditional render per activeTab)
              ├── TaskBoard (board)
              ├── GanttChart (gantt)
              └── CanvasView (canvas, dynamic import ssr:false)
```

**Trophy Room insertion point:** Add `'trophy'` as a fourth tab. The `CanvasView` precedent proves `dynamic` imports are acceptable for new tabs. A server-fetched data layer (like `getBoardTasks` / `findActivityEvents`) is the correct pattern.

### Data Flow Patterns

**Existing Pattern for All Tabs:**
1. `useEffect` on `project.id` triggers all data loads in parallel via `Promise.all`
2. DB data mapped to normalized client shapes and pushed into Zustand stores
3. Components read from stores, fire optimistic updates, call server actions to persist

**Trophy Room Data Flow Options:**

Option A — From existing store (zero new queries):
```typescript
const completedTasks = useBoardStore(s => s.tasks.filter(t => t.status === 'done'))
```
Already loaded. Labels, checklistSummaries, and dependencies all available from the same store. Fastest path.

Option B — Activity log timeline (new server action):
```typescript
// New: src/lib/actions/activity.ts
export async function getProjectActivity(projectId: string, options?: { limit?: number; cursor?: string })
// Calls findActivityEvents() filtered to 'completed' actions
```
Gives exact completion timestamps, historical events for deleted tasks, paginated timeline.

Option C — Combined (recommended):
- Use boardStore for live completed tasks (with full metadata)
- Use activity log for the timeline/history view (time-ordered, includes deleted tasks)

### Control Flow Analysis

**Tab Activation Flow:**
```
User clicks "Trophy" → setActiveTab('trophy') → conditional render shows TrophyRoom
→ TrophyRoom mounts → useEffect fires → server action called → data set in local state
```

The trophy room does NOT need to be in the main `useEffect` bundle since it is expensive to preload. Lazy-load on tab mount is the correct pattern (same as canvas partially is).

**Completion Detection:**
- `updateBoardTask()` in `board.ts` line 95: `if (data.status === 'done')` → emits `'completed'` activity event
- The tri-state checkbox on `SortableTaskCard` drives `status` changes via `handleTriToggle`

---

## Design Pattern Detection

### Glass Morphism — Pervasive, Standardized
Used on: modals, cards, headers, context menus, filter bars.
Implementation:
```
backdrop-blur-xl bg-white/[0.03-0.10] border border-white/[0.06-0.20]
```
Trophy cards should follow this exact recipe.

### GlowCard — Primary Display Primitive
`src/components/ui/GlowCard.tsx` — motion.div wrapper with:
- `accentColor` prop maps to `colorConfig` (preset colors or hex)
- `glowIntensity: 'none' | 'sm' | 'md' | 'lg'` drives `boxShadow` brightness scaled by `glowIntensity` from themeStore
- `showAccentLine` — renders a 2px colored top bar + gradient wash
- `hover` — enables `whileHover: { scale: 1.02, y: -2 }` + `whileTap: { scale: 0.98 }`
- `selected` — ring highlight
This is the exact component to use for trophy task cards.

### Framer Motion — Consistent Patterns

**Entry animations (established canon):**
```typescript
initial={{ opacity: 0, y: 10 }}
animate={{ opacity: 1, y: 0 }}
exit={{ opacity: 0, scale: 0.9 }}
transition={{ duration: 0.2 }}
```
Used on SortableTaskCard. Use same for trophy card stagger.

**Page-level entrance (DashboardContent canon):**
```typescript
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.5, delay: 0.1 }}
```
Use for the trophy room header/stats section.

**Modal pattern (TaskEditModal):**
```typescript
// Overlay
initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
// Modal panel
initial={{ opacity: 0, scale: 0.9, y: 20 }}
animate={{ opacity: 1, scale: 1, y: 0 }}
exit={{ opacity: 0, scale: 0.9, y: 20 }}
```

**AnimatePresence usage:** All dynamic list renders use `<AnimatePresence mode="popLayout">`. KanbanColumn wraps its task list this way. Copy for trophy grid.

**layoutId pattern:** `TimeScaleSelector` uses `layoutId="timeScaleActiveTab"` for a sliding pill indicator. Can be used for trophy filter tabs.

**whileTap pattern:** `{ scale: 0.98 }` on buttons — universal across EffectsTab, NeonButton, GlowCard.

**Breathe animation:** CSS class `animate-glow-breathe` on ambient blobs and NeonButton inner glow — pulsing glow effect that can be applied to trophy highlight elements.

### GlassStage — Background Effects Engine
`src/components/ui/GlassStage.tsx`:
- Renders fixed background: radial gradients, grid overlay, grain texture, vignette
- `blobConfig.blobs[]` — positional animated glow blobs (`animate-glow-breathe`)
- Reads `glowIntensity`, `glassOpacity`, `ambientBlobs` from themeStore
- All ProjectContent tabs share the same GlassStage — no need to add another for trophy room

---

## Theme System Capabilities

### ThemeStore State (themeStore.ts)
Full visual control palette accessible via `useThemeStore()`:

| Property | Range | Use for Trophy |
|---|---|---|
| `glowIntensity` | 0-100 | Scale all glow effects (mult = value/75) |
| `glassOpacity` | 0-100 | Glass surface opacity (glass = pow(v/100, 1.5)*6) |
| `ambientBlobs` | boolean | Enable/disable background animation |
| `colors` | ThemeColors | Full theme palette object |
| `colors.glowColor` | RGBA string | Primary glow color |
| `colors.primary` | hex | Primary accent |
| `colors.accent` | hex | Secondary accent |
| `colors.chartColors[5]` | hex array | 5-color chart palette |
| `colors.success` | hex | Green (#10b981) — perfect for "done" |
| `fontFamily` | system/inter/jetbrains/etc | Applied via CSS var |

### ThemeColors Interface
11 standard themes (Standard category) + muted, highContrast, vibrant, cinematic categories.
All themes expose: `background`, `surface`, `border`, `text`, `primary`, `glowColor`, `chartColors`, `glow`, `success`, `warning`, `error`.
The `effect?` field allows special per-theme shader effects (`'matrix' | 'vulcan' | 'dracula'`).

### CSS Variable System
All themes inject CSS vars: `--glow-color`, `--primary`, `--accent`, `--background`, `--surface`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--success`, `--warning`, `--error`.
Use these directly in inline styles to be theme-reactive without reading from themeStore.

### Effect Infrastructure Available
- Drag effects: glow / ghost / lightning (visual only, not directly reusable)
- Cursor effects: 18 options including particles, trails, neon, fire, smoke, venom, plasma
- Dependency line: configurable width, glow brightness, style (solid/dashed/dotted)
- All sliders via `CompactSlider` component in `src/components/ui/settings/shared.tsx`

---

## Historical Context

**Evolution Traces:**
- `activityEvents` schema shows `'completed'` was explicitly designed as a distinct action (not just `'updated'`) — intent to surface completions was baked in from the start
- `boardTasks.metadata` JSONB column exists but is not currently populated in any visible code path — reserved for future enrichment
- `columnByOldStatus` map in ProjectContent (lines 86-93) shows migration from status-based to column-based task organization — "done" status concept predates the column system
- `triToStatus` in SortableTaskCard: `'crossed'` is a third state that sets status back to `'todo'` — not emitted as `'completed'` activity, only `'done'` status triggers completion logging
- `ganttTasks.boardTaskId` foreign key — the bridge system was added after initial board implementation

**Design Intent Signals:**
- Activity log has cursor-based pagination built in (`lt(createdAt, cursor)`) — designed for infinite scroll from day one
- `entityName` stored on activity events — designed to display task names even after deletion (tombstone support)
- `size: real` field on boardTasks — story-point sizing was anticipated but kept optional

---

## Hidden Dependencies

**Column-status coupling:**
- "Done" tasks are identified by `status === 'done'` OR by being in a column named "done"
- The `ensureDefaultColumns()` call on load creates default columns including "done"
- For trophy room filtering, query `tasks.filter(t => t.status === 'done')` — this is the canonical check, not column name

**Completion event gap:**
- `reorderBoardTasks()` moves (line 126-129 in board.ts) only emits `'moved'` events, not `'completed'`
- If a task is dragged into a "done" column via DnD, `reorderBoardTasks` is called with `status: 'done'` but `emitActivity` fires `'moved'` not `'completed'`
- Direct `updateBoardTask` with `status: 'done'` does fire `'completed'`
- The tri-state checkbox calls `onTaskUpdate` which routes through `updateBoardTask` — this DOES fire `'completed'`
- IMPLICATION: not all "done" tasks have a `'completed'` activity event — must query both `boardTasks` (for current state) and `activityEvents` (for history)

**Label IDs in store:**
- `boardTask.labels` stores label IDs (UUIDs), not label objects
- The `labels` array in boardStore holds the full label objects
- Trophy room must resolve `task.labels` → `labels.filter(l => task.labels.includes(l.id))`

**ChecklistSummary coupling:**
- `checklistSummaries` in boardStore is a flat Record keyed by taskId
- Available for any task already in the store — no additional load needed

**Dynamic import for CanvasView:**
- `CanvasView` uses `dynamic(() => import(...), { ssr: false })` because it uses browser-only APIs
- TrophyRoom does not need this treatment (no canvas/WebGL) — can be a normal import

**`requireOwnership` in all server actions:**
- Every server action calls `requireOwnership(projectId)` which checks auth session
- Any new server action for trophy room data must also call this

---

## Architectural Insights

**Why this tab system was built this way:**
The three-tab architecture (Board/Gantt/Canvas) represents three fundamentally different data models and rendering engines. Each tab has its own Zustand store (boardStore, ganttStore, canvasStore) and a separate load path in the Promise.all bundle. The pattern is intentionally flat — no routing (no URL params for active tab), just local state. This makes the tab system extremely fast to extend: add a value to the union, a nav button, and a render block. The Trophy Room fits this pattern exactly with minimal structural disruption.

**Why activityEvents was designed separately from boardTasks:**
`boardTasks` only carries current state. `activityEvents` is an append-only audit log. This separation enables the trophy room to show historical completions even for tasks that were later deleted, re-opened, or renamed — the activity log preserves the moment of completion with `entityName` and `createdAt` as stable identifiers.

**Why `glowIntensity` flows through everything:**
Every visual element that produces glow computes `mult = glowIntensity / 75` and scales all pixel values by it. This is a deliberate "master dimmer" for accessibility and performance. Any new glow effects in the trophy room MUST follow this pattern or they will break the user's settings.

**Why `GlowCard` is the primary display primitive:**
It encapsulates the glass morphism + glow + hover interaction as a single composable unit with proper TypeScript typing. It already handles the theme-reactive color resolution system (`colorConfig` for presets, hex fallback). Using it for trophy cards means zero additional CSS and automatic theme compatibility.

---

## Reconnaissance Warnings

**Risk 1 — Completion event gaps (HIGH):**
Not all done tasks have activity events. Using only activity log for trophy will miss tasks completed via drag-and-drop. Use `boardTasks` filtered by `status === 'done'` as the primary source, with activity log as supplementary timeline data.

**Risk 2 — No completion timestamp on boardTask (MEDIUM):**
`boardTasks.updatedAt` is set on EVERY update, not just completion. If a completed task's name was changed post-completion, `updatedAt` no longer reflects completion time. The `activityEvents.createdAt` for the `'completed'` action is the true completion timestamp, but (per Risk 1) this may not exist for all done tasks. Fallback: use `updatedAt` when no activity event exists.

**Risk 3 — Performance on large datasets (LOW-MEDIUM):**
`findTasks()` with `status: 'done'` filter is efficient (indexed on projectId). But `findActivityEvents()` with only `projectId` and cursor paging is O(n) without an index on `(projectId, createdAt)`. Verify migration has this index before building infinite-scroll.

**Risk 4 — Tab union type in ProjectContent (LOW):**
The type is `'board' | 'gantt' | 'canvas'` — extending to include `'trophy'` is a two-char change. No risk, just note it for the implementation spec.

**Risk 5 — GlassStage z-index (LOW):**
GlassStage has `style={{ zIndex: 0 }}` fixed. Main content uses `relative z-10`. Trophy room must follow this z-index discipline or glow elements will bleed through.

---

## Strategic Recommendations

### Recommended Architecture for Trophy Room

**Tab identifier:** `'trophy'` — color: emerald/gold (`bg-emerald-500/20 text-emerald-400 border border-emerald-500/30`)
**Lucide icon:** `Trophy` from `lucide-react`
**Data source:** Two-pronged
1. `useBoardStore(s => s.tasks.filter(t => t.status === 'done'))` for live card grid
2. New server action `getProjectActivity(projectId, { limit: 50 })` for timeline feed

**New files needed:**
- `src/components/trophy/TrophyRoom.tsx` — main container (lazy import like CanvasView)
- `src/components/trophy/TrophyCard.tsx` — GlowCard-based completed task card
- `src/components/trophy/TrophyTimeline.tsx` — activity feed with infinite scroll
- `src/components/trophy/TrophyStats.tsx` — aggregate stats (total done, by priority, by label)
- `src/lib/actions/activity.ts` — new server action: `getProjectActivity()`

**No new files needed:**
- No new store (read from boardStore + local useState for activity events)
- No schema changes (all data already exists)
- No new DB tables

**Animation recipe for trophy cards:**
```typescript
// Staggered entrance — container
const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } }
}
// Each card
const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3 } }
}
```

**Trophy card composition:**
```typescript
<GlowCard
  accentColor={task.color}       // full color system support
  glowIntensity="sm"
  showAccentLine
  hover
>
  // Emerald checkmark badge top-right (status=done indicator)
  // Task name + description
  // Priority badge (from priorityColors map)
  // Label chips (resolved from boardStore.labels)
  // Completion date (from updatedAt or activity event)
  // Checklist progress: {checked}/{total}
  // Size badge if size exists
</GlowCard>
```

**Stats panel recipe:**
Use `colors.chartColors` array from themeStore for any charts/bars. The 5-color array gives priority distribution colors natively. Emerald (`colors.success`) for the main "completed" metric.

**Timeline feed recipe:**
Reverse-chronological list using `ActivityEvent` records with `action === 'completed'`. Each entry: glow dot, task name, timestamp. Use `AnimatePresence mode="popLayout"` for new entries appearing.

**Header controls for trophy tab:**
- Sort toggle: `Most Recent / Priority / Size` (local state, no server round-trip)
- Filter pill: `All / High+ / With Labels` (filter completed tasks in-store)
- Stats toggle: expand/collapse the stats panel

### Integration Footprint in ProjectContent.tsx

Minimal changes required:
```typescript
// Line 39 — extend union
const [activeTab, setActiveTab] = useState<'board' | 'gantt' | 'canvas' | 'trophy'>('board')

// Header nav — add one button after canvas (emerald color scheme)
// Main content — add one conditional block
{activeTab === 'trophy' && (
  <TrophyRoom
    projectId={project.id}
    onTaskSelect={(taskId) => { /* optional: open TaskEditModal */ }}
  />
)}
```

TrophyRoom self-manages its data load on mount — no changes to the existing Promise.all bundle needed.

---

## Key File Locations

| Purpose | Path |
|---|---|
| Tab system | `src/app/project/[id]/ProjectContent.tsx` |
| Board store + BoardTask interface | `src/lib/store/boardStore.ts` |
| Activity data layer | `src/lib/data/activity.ts` |
| Board task data layer | `src/lib/data/tasks.ts` |
| Board server actions | `src/lib/actions/board.ts` |
| Schema (activityEvents, boardTasks) | `src/lib/db/schema.ts` |
| Theme store | `src/stores/themeStore.ts` |
| Theme configs | `src/config/themes/standard.ts` (+ muted, vibrant, cinematic, highContrast) |
| Theme types | `src/config/themes/types.ts` |
| GlowCard primitive | `src/components/ui/GlowCard.tsx` |
| GlassStage background | `src/components/ui/GlassStage.tsx` |
| NeonButton | `src/components/ui/NeonButton.tsx` |
| SortableTaskCard (card pattern) | `src/components/board/SortableTaskCard.tsx` |
| TaskEditModal (modal pattern) | `src/components/board/TaskEditModal.tsx` |
| Effects settings | `src/components/ui/settings/EffectsTab.tsx` |
