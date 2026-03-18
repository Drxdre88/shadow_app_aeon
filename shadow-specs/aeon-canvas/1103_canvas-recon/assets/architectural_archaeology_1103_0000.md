# Architectural Reconnaissance: Aeon Canvas View
Date: 11/03/2026

## Executive Summary

Full system recon for building a ReactFlow canvas view that mirrors the board + gantt architecture.
ReactFlow is NOT yet installed. Every other convention is clearly established and must be replicated exactly.

---

## 1. Zustand Store Conventions

### Pattern: `create<State>()(persist((set) => ({...}), { name, partialize }))`

Both stores use:
- `zustand` v5.0.2 with `persist` middleware
- `partialize` to control what gets persisted (excludes volatile UI state like `isDirty`, `selectedTaskId`)
- `isDirty` flag pattern for tracking unsaved state
- `markClean()` action to reset dirty flag after DB sync
- `selectTask(id | null)` for selection state
- All mutations set `isDirty: true`
- `set*` bulk loaders (setTasks, setRows) reset `isDirty: false` - used on initial data load

### boardStore persist key: `'aeon-board'`
### ganttStore persist key: `'aeon-gantt'`
### themeStore persist key: `'aeon-theme'`

Canvas store persist key should follow: `'aeon-canvas'`

### boardStore persists: tasks, labels, dependencies, columns
### ganttStore persists: tasks, rows, timeScale

Canvas store should persist: nodes, edges, viewport (or just nodes + edges)

### Store Location: `src/lib/store/`

---

## 2. DB Schema Conventions

File: `src/lib/db/schema.ts`
ORM: Drizzle ORM with `drizzle-orm/pg-core`
DB: Neon serverless Postgres (`@neondatabase/serverless`)

### Column type patterns:
- `uuid('id').defaultRandom().primaryKey()` - all IDs
- `uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' })` - FK with cascade
- `uuid('other_id').references(() => otherTable.id, { onDelete: 'set null' })` - optional FK, set null
- `varchar('name', { length: 255 }).notNull()` - short strings
- `text('description')` - long nullable text
- `timestamp('created_at').defaultNow().notNull()` - audit timestamps
- `timestamp('updated_at').defaultNow().notNull()` - audit timestamps
- `integer('order_index').notNull()` - ordering
- `varchar('color', { length: 20 }).default('purple').notNull()` - color strings
- `jsonb('metadata').default({}).notNull()` - flexible metadata blob
- `boolean('on_timeline').default(false).notNull()` - boolean flags
- `primaryKey({ columns: [tl.col1, tl.col2] })` - composite PKs for junction tables

### Exported types pattern:
```ts
export type User = typeof users.$inferSelect
export type GanttTask = typeof ganttTasks.$inferSelect
```
Types are inferred from the table definition, not hand-written.

### Tables needed for canvas:
```
canvasNodes  - id, projectId, type, positionX, positionY, width, height, data(jsonb), color, metadata(jsonb), createdAt, updatedAt
canvasEdges  - id, projectId, sourceNodeId, targetNodeId, type, animated, style(jsonb), metadata(jsonb), createdAt, updatedAt
```

---

## 3. Server Actions Conventions

File: `src/lib/actions/board.ts`
Directive: `'use server'` at top of file

### Pattern:
1. `'use server'` directive
2. Import `revalidatePath` from `next/cache`
3. Import `requireOwnership` from `./helpers` - auth guard, called first in every action
4. Import data functions from `@/lib/data/<entity>` (aliased with underscore prefix on import)
5. Each action: `await requireOwnership(projectId)` then call data layer then `revalidatePath`
6. revalidatePath pattern: `revalidatePath(\`/project/${projectId}\`)`

### Data layer separation:
- `src/lib/actions/` = server action wrappers (auth + revalidation)
- `src/lib/data/` = pure DB query functions (no auth, no revalidation)

### Actions needed for canvas:
- `getCanvasNodes(projectId)`
- `createCanvasNode(data)`
- `updateCanvasNode(nodeId, projectId, data)`
- `deleteCanvasNode(nodeId, projectId)`
- `getCanvasEdges(projectId)`
- `createCanvasEdge(data)`
- `updateCanvasEdge(edgeId, projectId, data)`
- `deleteCanvasEdge(edgeId, projectId)`
- `bulkUpdateCanvasNodes(projectId, updates[])` - for drag-end batch saves

---

## 4. Theme/Styling System

### CSS Variables (defined in globals.css :root):
- `--background: #0a0a0f` - page background
- `--surface: rgba(15, 15, 25, 0.8)` - card/panel backgrounds
- `--surface-hover: rgba(20, 20, 35, 0.9)`
- `--border: rgba(139, 92, 246, 0.2)` - border color (theme-aware purple)
- `--border-hover: rgba(139, 92, 246, 0.4)`
- `--text: #e2e8f0`
- `--text-muted: #94a3b8`
- `--text-dim: #64748b`
- `--primary: #8b5cf6` - purple
- `--primary-hover: #a78bfa`
- `--primary-muted: rgba(139, 92, 246, 0.2)`
- `--accent: #c084fc`
- `--success: #10b981`
- `--warning: #f59e0b`
- `--error: #ef4444`
- `--glow-color: rgba(139, 92, 246, 0.5)`
- `--glow-sm/md/lg/xl/xxl` - tiered box-shadow glow values

### CSS utility classes (globals.css @layer components):
- `.glass` = `bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl`
- `.glass-hover` = `hover:bg-white/10 hover:border-white/20 transition-all duration-200`
- `.glass-surface` = gradient + backdrop blur
- `.glass-elevated` = elevated glass card with inset highlight + drop shadow
- `.glow-border-primary/cyan/pink/success` = border + box-shadow glow combos

### Tailwind custom extensions:
- Colors: `background`, `surface`, `glow.primary/secondary/accent/success/warning/danger/pink/orange`
- Box shadows: `shadow-glow-none/sm/md/lg/xl/xxl`
- Animations: `animate-glow-pulse`, `animate-glow-breathe`, `animate-fade-in`, `animate-scale-in`, `animate-glass-sweep`, `animate-glass-shimmer`, `animate-edge-draw`
- `animate-edge-draw` keyframe: strokeDashoffset 1000->0, opacity 0->1 - ALREADY DESIGNED for ReactFlow edge animation
- Backdrop blur: `backdrop-blur-xs` (2px)

### ThemeStore (src/stores/themeStore.ts):
- `glowIntensity` (0-100, default 75) - scales glow effects
- `glassOpacity` (0-100, default 50) - scales glass transparency
- `ambientBlobs` (bool) - toggles ambient background blobs
- `depLineWidth` (0.3-3) - dependency line width (reusable for canvas edges)
- `depLineGlow` (0-100) - dependency line glow intensity
- `depLineStyle: 'solid' | 'dashed' | 'dotted'` - line style

### GlassStage component:
- `fixed inset-0 pointer-events-none` background layer at z-index 0
- Renders: radial gradient blobs, grain SVG noise texture, grid lines, vignette, top highlight bar
- Props: `enableGrid` (bool), `blobConfig` ({ blobs: GlassStageBlobDef[] })
- Already used in ProjectContent - canvas view gets it for free

### Theme is dynamically switched via CSS variable injection from themes config
- Theme files in `src/config/themes/` (standard, vibrant, muted, highContrast, cinematic)

---

## 5. View Component Patterns

### TaskBoard (board view):
```tsx
'use client'
// Heavy imports: dnd-kit, store, child components
interface BoardTaskData { ... }      // local interface mirrors store type
interface TaskBoardProps {
  projectId: string
  showFilters?: boolean
  filters?: BoardFilters
  onFiltersChange?: ...
  onTaskCreate?: (task) => void      // all mutations passed as callbacks from ProjectContent
  onTaskUpdate?: ...
  onTaskDelete?: ...
  onTaskMove?: ...
  onAddDependency?: ...
  onRemoveDependency?: ...
}
```
- Component receives project-scoped data via props (callbacks) rather than calling actions directly
- ProjectContent owns all server action calls
- Store is read directly (`useBoardStore`) for display state

### GanttChart (gantt view):
```tsx
'use client'
interface GanttChartProps {
  projectId: string
  startDate: Date
  endDate: Date
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
}
// Constants defined at module level:
const CELL_WIDTHS = { day: 60, week: 100, month: 150 }
const ROW_HEIGHT = 56
// Reads store directly: useGanttStore()
// Computes derived data with useMemo (timeColumns, task positions)
// Uses dnd-kit PointerSensor with activationConstraint: { distance: 5 }
```

### Canvas component should follow: `CanvasView` with props:
```tsx
interface CanvasViewProps {
  projectId: string
  onNodeCreate?: (node: CanvasNodeData) => void
  onNodeUpdate?: (nodeId: string, updates: Partial<CanvasNodeData>) => void
  onNodeDelete?: (nodeId: string) => void
  onEdgeCreate?: (edge: CanvasEdgeData) => void
  onEdgeDelete?: (edgeId: string) => void
}
```

---

## 6. ProjectContent Integration Pattern

File: `src/app/project/[id]/ProjectContent.tsx`

```tsx
const [activeTab, setActiveTab] = useState<'board' | 'gantt'>('board')
```

Tab switching is local state in ProjectContent. To add canvas:
```tsx
const [activeTab, setActiveTab] = useState<'board' | 'gantt' | 'canvas'>('board')
```

ProjectContent owns:
- Data loading via useEffect (calls server actions, populates stores)
- All server action invocations (creates, updates, deletes)
- Tab state
- Filter state (board-specific)
- View-specific toggle state (showDepOverlay, connectMode)

Views render under: `{activeTab === 'board' && <TaskBoard ... />}`

GlassStage is rendered once at top level in ProjectContent - all views share it.

---

## 7. Key Dependencies (package.json)

Currently installed:
- `zustand: ^5.0.2`
- `@dnd-kit/core + sortable + utilities` - drag and drop (board/gantt use this)
- `framer-motion: ^11.15.0` - animations
- `drizzle-orm: ^0.37.0` + `drizzle-kit: ^0.31.8`
- `date-fns: ^4.1.0`
- `lucide-react: ^0.468.0`
- `next: ^16.1.4`, `react: 19.0.0`
- `zod: ^4.3.6`

NOT installed (needs adding for canvas):
- `reactflow` or `@xyflow/react` - the ReactFlow library

### ReactFlow package name note:
As of 2023+, ReactFlow v11+ is published as `@xyflow/react`. This is the correct package to install.
`npm install @xyflow/react`

---

## 8. File Structure to Create

```
src/
  lib/
    store/
      canvasStore.ts              # Zustand store (mirrors board/gantt pattern)
    db/
      schema.ts                   # Add canvasNodes + canvasEdges tables
    actions/
      canvas.ts                   # Server actions ('use server', requireOwnership, revalidatePath)
    data/
      canvas.ts                   # Pure DB query functions
  components/
    canvas/
      CanvasView.tsx              # Main view component (mirrors GanttChart structure)
      CanvasNode.tsx              # Custom node renderer
      CanvasEdge.tsx              # Custom edge renderer
      CanvasToolbar.tsx           # Floating toolbar (add node, zoom controls)
      CanvasNodeModal.tsx         # Node edit modal (mirrors TaskEditModal)
```

---

## 9. Architectural Hazards / Modification Risks

1. **ReactFlow CSS import required**: `import '@xyflow/react/dist/style.css'` must be added, likely in the canvas view or a layout. Conflicts with existing global styles are possible - scope carefully.

2. **ReactFlow needs explicit container dimensions**: The ReactFlow container div MUST have a defined height (not `height: auto`). Use `h-full` or explicit pixel height. Without this, the canvas renders empty.

3. **Server Component boundary**: ProjectContent is `'use client'`. Any canvas data loading should match the existing `useEffect` pattern in ProjectContent, NOT use React Server Components.

4. **Zustand persist + ReactFlow nodes**: ReactFlow node positions are floats. Persisting them in zustand is fine but the `partialize` should include nodes/edges to survive page refresh. Be careful with serialization of ReactFlow's internal node format.

5. **isDirty + auto-save**: The board/gantt pattern uses `isDirty` as a flag. For canvas, position updates on drag-end should batch-update to DB rather than updating on every pixel move. Use ReactFlow's `onNodeDragStop` event, not `onNodeDrag`.

6. **schema.ts additive only**: Adding new tables to schema.ts is safe. Never rename or remove existing columns - the board and gantt features depend on them.

7. **ProjectContent activeTab type**: Adding 'canvas' to the union type and the tab bar UI requires modifying `ProjectContent.tsx` - this file is already modified (git status shows `M`). Read full file before editing.

8. **themeStore depLine* props**: `depLineWidth`, `depLineGlow`, `depLineStyle` are already in themeStore and designed for line rendering. These should be reused for canvas edges to maintain visual consistency.

9. **`animate-edge-draw` already exists in tailwind.config.ts**: The keyframe `strokeDashoffset: 1000 -> 0` is pre-built for SVG path animation - use it for ReactFlow edge entry animation.

10. **Color system**: Node colors should use the same color string values as board tasks (`'purple' | 'blue' | 'green'` etc.) to maintain visual consistency. The `AccentColor` type from `@/lib/utils/colors` is already used in GanttChart.

---

## Strategic Recommendations

1. Install `@xyflow/react` first, verify it installs cleanly with React 19 / Next 16.
2. Create canvasStore.ts first - it's the simplest file and establishes the data shape.
3. Add schema tables and run `npm run db:push` to create them in Neon.
4. Create data layer (src/lib/data/canvas.ts) then actions layer (src/lib/actions/canvas.ts).
5. Build CanvasView.tsx as a skeleton first (just ReactFlow with background), then wire up store.
6. Integrate into ProjectContent last - adding the tab button and data loading useEffect.
7. Use ReactFlow's built-in Background component set to variant="dots" or "lines" - matches the glass grid aesthetic already in GlassStage.
8. For node styling: apply `.glass` and `.glass-elevated` CSS classes to node containers for instant visual consistency.
