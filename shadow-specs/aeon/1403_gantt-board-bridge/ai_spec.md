# Gantt-Board Bridge -- AI Spec

**Date:** 14.03.2026 | **Package:** aeon

---

## Implementation Order

1. Schema changes (DB foundation)
2. Validators
3. Data layer (ganttViews, bridge)
4. Server actions (ganttViews, bridge, modify board/gantt/checklist)
5. Store updates (boardStore, ganttStore)
6. UI: GanttViewSelector component
7. UI: TaskSizeBadge component
8. UI: Size input in TaskEditModal
9. UI: Push-to-Gantt in TaskContextMenu and TaskEditModal
10. UI: TimelineHeader AM/PM slots
11. UI: GanttChart bridge-aware rendering
12. UI: ProjectContent wiring

---

## Step 1: Schema Changes

**File:** `src/lib/db/schema.ts`

### 1a. Add `ganttViews` table (after `rows` table)

**After line 64 (closing of `rows` table), add:**

```typescript
export const ganttViews = pgTable('gantt_views', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  groupBy: varchar('group_by', { length: 20 }).default('column').notNull(),
  filters: jsonb('filters').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### 1b. Add `ganttViewId` to `rows` table

**Current `rows` table (lines 57-64):**

```typescript
export const rows = pgTable('rows', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  orderIndex: integer('order_index').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

**New `rows` table:**

```typescript
export const rows = pgTable('rows', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  ganttViewId: uuid('gantt_view_id').references(() => ganttViews.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  orderIndex: integer('order_index').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

**Ordering note:** `ganttViews` must be defined BEFORE `rows` in the file because `rows` references it. Move the `ganttViews` definition to be right before `rows`.

### 1c. Add `size` to `boardTasks` table

**Add after `onTimeline` line (line 103):**

```typescript
size: integer('size'),
```

Wait -- `size` needs to be a decimal for half-day increments (0.5, 1, 1.5...). Drizzle's `integer` only handles whole numbers. Use a workaround: store as integer representing half-days. So `size: 1` = 0.5 days, `size: 2` = 1 day, `size: 3` = 1.5 days, etc.

Actually, simpler approach: use `varchar` to store the numeric value, or use `real`/`numeric`. Drizzle supports `real`:

```typescript
import { pgTable, uuid, varchar, text, timestamp, integer, boolean, jsonb, primaryKey, real } from 'drizzle-orm/pg-core'
```

Then add to `boardTasks`:

```typescript
size: real('size'),
```

This allows 0.5, 1.0, 1.5 etc. natively.

### 1d. Add `boardTaskId` to `ganttTasks` table

The existing `boardTasks.ganttTaskId` FK points from board -> gantt. We also need the reverse lookup. Add to `ganttTasks`:

```typescript
boardTaskId: uuid('board_task_id').references(() => boardTasks.id, { onDelete: 'cascade' }),
```

This creates a bidirectional link. When a board task is deleted, its linked gantt task is also deleted via this cascade. When a gantt task is deleted, `boardTasks.ganttTaskId` is set to null (existing behavior).

**Circular FK note:** `boardTasks` references `ganttTasks` (line 95) and now `ganttTasks` references `boardTasks`. Drizzle handles circular references via the arrow function in `references(() => ...)`, so this works.

### 1e. Add type exports

```typescript
export type GanttView = typeof ganttViews.$inferSelect
```

### Full schema changes summary

```typescript
import { pgTable, uuid, varchar, text, timestamp, integer, boolean, jsonb, primaryKey, real } from 'drizzle-orm/pg-core'

// ... existing tables ...

export const ganttViews = pgTable('gantt_views', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  groupBy: varchar('group_by', { length: 20 }).default('column').notNull(),
  filters: jsonb('filters').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// rows table gains ganttViewId
// boardTasks table gains size (real)
// ganttTasks table gains boardTaskId (FK cascade)
```

**Validation:** Run `npx drizzle-kit generate` to create migration. Verify migration SQL creates correct columns and constraints.

---

## Step 2: Validators

**File:** `src/lib/data/validators.ts`

### 2a. Add ganttView schemas

```typescript
export const createGanttViewSchema = z.object({
  name: z.string().trim().min(1).max(255),
  groupBy: z.enum(['column', 'label', 'dependency', 'priority']).default('column'),
  filters: z.record(z.unknown()).default({}),
})

export const updateGanttViewSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  groupBy: z.enum(['column', 'label', 'dependency', 'priority']).optional(),
  filters: z.record(z.unknown()).optional(),
})

export type CreateGanttViewInput = z.infer<typeof createGanttViewSchema>
export type UpdateGanttViewInput = z.infer<typeof updateGanttViewSchema>
```

### 2b. Add `size` to task schemas

**In `createTaskSchema` (line 37-48), add after `onTimeline`:**

```typescript
size: z.number().min(0.5).max(20).multipleOf(0.5).nullable().optional(),
```

**In `updateTaskSchema` (line 50-61), add after `onTimeline`:**

```typescript
size: z.number().min(0.5).max(20).multipleOf(0.5).nullable().optional(),
```

### 2c. Add `boardTaskId` to gantt task schemas

**In `createGanttTaskSchema`, add:**

```typescript
boardTaskId: z.string().uuid().optional(),
```

**In `updateGanttTaskSchema`, add:**

```typescript
boardTaskId: z.string().uuid().nullable().optional(),
```

**Validation:** Import and test schema validation with sample data including size=0.5, size=3, size=null.

---

## Step 3: Data Layer -- Gantt Views

**New file:** `src/lib/data/ganttViews.ts`

```typescript
import { db } from '@/lib/db'
import { ganttViews } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import type { CreateGanttViewInput, UpdateGanttViewInput } from './validators'

export async function findGanttViews(projectId: string) {
  return db
    .select()
    .from(ganttViews)
    .where(eq(ganttViews.projectId, projectId))
    .orderBy(asc(ganttViews.createdAt))
}

export async function findGanttViewById(viewId: string, projectId: string) {
  const [view] = await db
    .select()
    .from(ganttViews)
    .where(and(eq(ganttViews.id, viewId), eq(ganttViews.projectId, projectId)))

  return view || null
}

export async function createGanttView(
  projectId: string,
  data: CreateGanttViewInput,
  clientId?: string
) {
  const [view] = await db
    .insert(ganttViews)
    .values({
      ...(clientId ? { id: clientId } : {}),
      projectId,
      name: data.name,
      groupBy: data.groupBy,
      filters: data.filters,
    })
    .returning()

  return view
}

export async function updateGanttView(
  viewId: string,
  projectId: string,
  data: UpdateGanttViewInput
) {
  const updates: Partial<typeof ganttViews.$inferInsert> = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.groupBy !== undefined) updates.groupBy = data.groupBy
  if (data.filters !== undefined) updates.filters = data.filters

  const [view] = await db
    .update(ganttViews)
    .set(updates)
    .where(and(eq(ganttViews.id, viewId), eq(ganttViews.projectId, projectId)))
    .returning()

  return view || null
}

export async function deleteGanttView(viewId: string, projectId: string) {
  const [deleted] = await db
    .delete(ganttViews)
    .where(and(eq(ganttViews.id, viewId), eq(ganttViews.projectId, projectId)))
    .returning({ id: ganttViews.id })

  return !!deleted
}
```

**Validation:** Pattern matches existing data layer files (gantt.ts, tasks.ts). Uses same import/return style.

---

## Step 4: Data Layer -- Bridge Operations

**New file:** `src/lib/data/bridge.ts`

```typescript
import { db } from '@/lib/db'
import { boardTasks, ganttTasks, boardColumns, labels, taskLabels, taskDependencies, rows, checklistItems } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'

const PRIORITY_DURATION_DAYS: Record<string, number> = {
  urgent: 0.5,
  high: 1,
  medium: 1.5,
  low: 2.5,
}

export function computeDuration(size: number | null, priority: string): number {
  if (size !== null && size > 0) return size
  return PRIORITY_DURATION_DAYS[priority] ?? 1.5
}

export function computeStartDate(
  existingStartDate: Date | null,
  predecessorEndDate: Date | null
): Date {
  if (existingStartDate) return existingStartDate
  if (predecessorEndDate) return predecessorEndDate
  return new Date()
}

export function computeEndDate(startDate: Date, durationDays: number): Date {
  const ms = durationDays * 24 * 60 * 60 * 1000
  return new Date(startDate.getTime() + ms)
}

export async function pushTaskToGantt(
  boardTaskId: string,
  projectId: string,
  ganttViewId: string,
  rowId: string,
  ganttTaskClientId: string
) {
  const [boardTask] = await db
    .select()
    .from(boardTasks)
    .where(and(eq(boardTasks.id, boardTaskId), eq(boardTasks.projectId, projectId)))

  if (!boardTask) throw new Error('Board task not found')
  if (boardTask.ganttTaskId) throw new Error('Task already on Gantt')

  const duration = computeDuration(boardTask.size, boardTask.priority)
  const start = computeStartDate(boardTask.startDate, null)
  const end = boardTask.endDate || computeEndDate(start, duration)

  const [ganttTask] = await db
    .insert(ganttTasks)
    .values({
      id: ganttTaskClientId,
      projectId,
      rowId,
      boardTaskId,
      name: boardTask.name,
      startDate: start,
      endDate: end,
      color: boardTask.color,
      progress: boardTask.status === 'done' ? 100 : 0,
    })
    .returning()

  await db
    .update(boardTasks)
    .set({
      ganttTaskId: ganttTask.id,
      onTimeline: true,
      startDate: start,
      endDate: end,
      updatedAt: new Date(),
    })
    .where(eq(boardTasks.id, boardTaskId))

  return ganttTask
}

export async function syncBoardStatusToGantt(boardTaskId: string, newStatus: string) {
  const [boardTask] = await db
    .select({ ganttTaskId: boardTasks.ganttTaskId })
    .from(boardTasks)
    .where(eq(boardTasks.id, boardTaskId))

  if (!boardTask?.ganttTaskId) return

  if (newStatus === 'done') {
    await db
      .update(ganttTasks)
      .set({ progress: 100, updatedAt: new Date() })
      .where(eq(ganttTasks.id, boardTask.ganttTaskId))
  } else {
    const summary = await getChecklistProgress(boardTaskId)
    await db
      .update(ganttTasks)
      .set({ progress: summary, updatedAt: new Date() })
      .where(eq(ganttTasks.id, boardTask.ganttTaskId))
  }
}

export async function syncGanttDatesToBoard(ganttTaskId: string, startDate: Date, endDate: Date) {
  const [ganttTask] = await db
    .select({ boardTaskId: ganttTasks.boardTaskId })
    .from(ganttTasks)
    .where(eq(ganttTasks.id, ganttTaskId))

  if (!ganttTask?.boardTaskId) return

  await db
    .update(boardTasks)
    .set({ startDate, endDate, updatedAt: new Date() })
    .where(eq(boardTasks.id, ganttTask.boardTaskId))
}

export async function syncChecklistToGanttProgress(taskId: string) {
  const [boardTask] = await db
    .select({ ganttTaskId: boardTasks.ganttTaskId, status: boardTasks.status })
    .from(boardTasks)
    .where(eq(boardTasks.id, taskId))

  if (!boardTask?.ganttTaskId) return
  if (boardTask.status === 'done') return

  const progress = await getChecklistProgress(taskId)
  await db
    .update(ganttTasks)
    .set({ progress, updatedAt: new Date() })
    .where(eq(ganttTasks.id, boardTask.ganttTaskId))
}

async function getChecklistProgress(taskId: string): Promise<number> {
  const items = await db
    .select({ state: checklistItems.state })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))

  if (items.length === 0) return 0
  const checked = items.filter((i) => i.state === 'checked').length
  return Math.round((checked / items.length) * 100)
}

export async function deleteLinkedGanttTask(boardTaskId: string) {
  const [boardTask] = await db
    .select({ ganttTaskId: boardTasks.ganttTaskId })
    .from(boardTasks)
    .where(eq(boardTasks.id, boardTaskId))

  if (boardTask?.ganttTaskId) {
    await db.delete(ganttTasks).where(eq(ganttTasks.id, boardTask.ganttTaskId))
  }
}

export type GroupByMode = 'column' | 'label' | 'dependency' | 'priority'

export async function generateRowsForView(
  projectId: string,
  ganttViewId: string,
  groupBy: GroupByMode
): Promise<{ id: string; name: string; color: string; orderIndex: number }[]> {
  switch (groupBy) {
    case 'column':
      return generateRowsByColumn(projectId, ganttViewId)
    case 'label':
      return generateRowsByLabel(projectId, ganttViewId)
    case 'priority':
      return generateRowsByPriority(projectId, ganttViewId)
    case 'dependency':
      return generateRowsByDependencyChain(projectId, ganttViewId)
  }
}

async function generateRowsByColumn(projectId: string, ganttViewId: string) {
  const columns = await db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(boardColumns.orderIndex)

  const rowValues = columns.map((col, i) => ({
    projectId,
    ganttViewId,
    name: col.name,
    color: col.color,
    orderIndex: i,
  }))

  if (rowValues.length === 0) return []

  const created = await db.insert(rows).values(rowValues).returning()
  return created
}

async function generateRowsByLabel(projectId: string, ganttViewId: string) {
  const projectLabels = await db
    .select()
    .from(labels)
    .where(eq(labels.projectId, projectId))

  const rowValues = [
    ...projectLabels.map((l, i) => ({
      projectId,
      ganttViewId,
      name: l.name,
      color: l.color,
      orderIndex: i,
    })),
    {
      projectId,
      ganttViewId,
      name: 'Untagged',
      color: 'slate' as string,
      orderIndex: projectLabels.length,
    },
  ]

  const created = await db.insert(rows).values(rowValues).returning()
  return created
}

async function generateRowsByPriority(projectId: string, ganttViewId: string) {
  const priorities = [
    { name: 'Urgent', color: 'red' },
    { name: 'High', color: 'orange' },
    { name: 'Medium', color: 'blue' },
    { name: 'Low', color: 'slate' },
  ]

  const rowValues = priorities.map((p, i) => ({
    projectId,
    ganttViewId,
    name: p.name,
    color: p.color,
    orderIndex: i,
  }))

  const created = await db.insert(rows).values(rowValues).returning()
  return created
}

async function generateRowsByDependencyChain(projectId: string, ganttViewId: string) {
  const deps = await db
    .select()
    .from(taskDependencies)
    .innerJoin(boardTasks, eq(boardTasks.id, taskDependencies.blockerTaskId))
    .where(eq(boardTasks.projectId, projectId))

  const tasks = await db
    .select({ id: boardTasks.id, name: boardTasks.name })
    .from(boardTasks)
    .where(eq(boardTasks.projectId, projectId))

  const hasBlocker = new Set<string>()
  const graph = new Map<string, string[]>()
  for (const dep of deps) {
    hasBlocker.add(dep.task_dependencies.blockedTaskId)
    const children = graph.get(dep.task_dependencies.blockerTaskId) || []
    children.push(dep.task_dependencies.blockedTaskId)
    graph.set(dep.task_dependencies.blockerTaskId, children)
  }

  const rootTasks = tasks.filter((t) => !hasBlocker.has(t.id))
  const visited = new Set<string>()
  const chains: { rootName: string; taskIds: string[] }[] = []

  for (const root of rootTasks) {
    if (visited.has(root.id)) continue
    const chain: string[] = []
    const queue = [root.id]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      chain.push(current)
      const children = graph.get(current) || []
      queue.push(...children)
    }
    chains.push({ rootName: root.name, taskIds: chain })
  }

  const independentTasks = tasks.filter((t) => !visited.has(t.id))
  if (independentTasks.length > 0) {
    chains.push({ rootName: 'Independent', taskIds: independentTasks.map((t) => t.id) })
  }

  const rowValues = chains.map((chain, i) => ({
    projectId,
    ganttViewId,
    name: chain.rootName,
    color: 'purple' as string,
    orderIndex: i,
  }))

  if (rowValues.length === 0) return []

  const created = await db.insert(rows).values(rowValues).returning()
  return created
}

export async function findRowTargetForTask(
  boardTaskId: string,
  projectId: string,
  ganttViewId: string,
  groupBy: GroupByMode
): Promise<string | null> {
  const viewRows = await db
    .select()
    .from(rows)
    .where(and(eq(rows.projectId, projectId), eq(rows.ganttViewId, ganttViewId)))

  if (viewRows.length === 0) return null

  const [boardTask] = await db
    .select()
    .from(boardTasks)
    .where(eq(boardTasks.id, boardTaskId))

  if (!boardTask) return null

  switch (groupBy) {
    case 'column': {
      const [col] = boardTask.columnId
        ? await db.select().from(boardColumns).where(eq(boardColumns.id, boardTask.columnId))
        : []
      if (!col) return viewRows[0].id
      const match = viewRows.find((r) => r.name === col.name)
      return match?.id ?? viewRows[0].id
    }
    case 'label': {
      const tl = await db
        .select({ labelId: taskLabels.labelId })
        .from(taskLabels)
        .where(eq(taskLabels.taskId, boardTaskId))

      if (tl.length === 0) {
        const untagged = viewRows.find((r) => r.name === 'Untagged')
        return untagged?.id ?? viewRows[viewRows.length - 1].id
      }

      const [firstLabel] = await db
        .select()
        .from(labels)
        .where(eq(labels.id, tl[0].labelId))

      if (!firstLabel) return viewRows[0].id
      const match = viewRows.find((r) => r.name === firstLabel.name)
      return match?.id ?? viewRows[0].id
    }
    case 'priority': {
      const priorityNameMap: Record<string, string> = {
        urgent: 'Urgent',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
      }
      const name = priorityNameMap[boardTask.priority] ?? 'Medium'
      const match = viewRows.find((r) => r.name === name)
      return match?.id ?? viewRows[0].id
    }
    case 'dependency': {
      return viewRows[0].id
    }
  }
}
```

**Validation:** Each function is independently testable. `pushTaskToGantt` creates a gantt task and links it back. `syncBoardStatusToGantt` updates progress. `syncGanttDatesToBoard` updates board dates. Row generation covers all four modes.

---

## Step 5: Server Actions -- Gantt Views

**New file:** `src/lib/actions/ganttViews.ts`

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  findGanttViews as _findGanttViews,
  createGanttView as _createGanttView,
  updateGanttView as _updateGanttView,
  deleteGanttView as _deleteGanttView,
} from '@/lib/data/ganttViews'
import {
  generateRowsForView,
  type GroupByMode,
} from '@/lib/data/bridge'

export async function getGanttViews(projectId: string) {
  await requireOwnership(projectId)
  return _findGanttViews(projectId)
}

export async function createGanttView(data: {
  id: string
  projectId: string
  name: string
  groupBy: string
  filters?: Record<string, unknown>
}) {
  await requireOwnership(data.projectId)

  const view = await _createGanttView(
    data.projectId,
    {
      name: data.name,
      groupBy: data.groupBy as GroupByMode,
      filters: data.filters ?? {},
    },
    data.id
  )

  await generateRowsForView(data.projectId, view.id, data.groupBy as GroupByMode)

  revalidatePath(`/project/${data.projectId}`)
  return view
}

export async function updateGanttView(
  viewId: string,
  projectId: string,
  data: { name?: string; groupBy?: string; filters?: Record<string, unknown> }
) {
  await requireOwnership(projectId)
  const view = await _updateGanttView(viewId, projectId, data)
  revalidatePath(`/project/${projectId}`)
  return view
}

export async function deleteGanttView(viewId: string, projectId: string) {
  await requireOwnership(projectId)
  await _deleteGanttView(viewId, projectId)
  revalidatePath(`/project/${projectId}`)
}
```

---

## Step 6: Server Actions -- Bridge

**New file:** `src/lib/actions/bridge.ts`

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  pushTaskToGantt as _pushTaskToGantt,
  findRowTargetForTask,
} from '@/lib/data/bridge'
import { findGanttViewById } from '@/lib/data/ganttViews'

export async function pushToGantt(data: {
  boardTaskId: string
  projectId: string
  ganttViewId: string
  ganttTaskId: string
  rowId?: string
}) {
  await requireOwnership(data.projectId)

  let rowId = data.rowId
  if (!rowId) {
    const view = await findGanttViewById(data.ganttViewId, data.projectId)
    if (!view) throw new Error('Gantt view not found')
    const targetRowId = await findRowTargetForTask(
      data.boardTaskId,
      data.projectId,
      data.ganttViewId,
      view.groupBy as 'column' | 'label' | 'dependency' | 'priority'
    )
    if (!targetRowId) throw new Error('No rows available in this Gantt view')
    rowId = targetRowId
  }

  const ganttTask = await _pushTaskToGantt(
    data.boardTaskId,
    data.projectId,
    data.ganttViewId,
    rowId,
    data.ganttTaskId
  )

  revalidatePath(`/project/${data.projectId}`)
  return ganttTask
}
```

---

## Step 7: Modify Existing Server Actions

### 7a. Board actions -- sync on status change

**File:** `src/lib/actions/board.ts`

**Add import at top:**

```typescript
import { syncBoardStatusToGantt, deleteLinkedGanttTask } from '@/lib/data/bridge'
```

**In `updateBoardTask` function, after `const task = await _updateTask(...)` (line 73-84), add:**

```typescript
  if (data.status) {
    syncBoardStatusToGantt(taskId, data.status).catch(() => {})
  }
```

**In `deleteBoardTask` function, before `await _deleteTask(...)` (line 92), add:**

```typescript
  await deleteLinkedGanttTask(taskId)
```

**Add `size` to `createBoardTask` and `updateBoardTask` parameter types:**

In `createBoardTask` data parameter, add:
```typescript
  size?: number | null
```

In `updateBoardTask` data parameter, add:
```typescript
  size?: number | null
```

In `createBoardTask` body, add to the object passed to `_createTask`:
```typescript
  size: data.size,
```

In `updateBoardTask` body, add to the cast:
```typescript
  size: data.size,
```

### 7b. Gantt actions -- sync on bar drag

**File:** `src/lib/actions/gantt.ts`

**Add import:**

```typescript
import { syncGanttDatesToBoard } from '@/lib/data/bridge'
```

**In `updateGanttTask`, after `const task = await _updateGanttTask(...)`, add:**

```typescript
  if (data.startDate && data.endDate) {
    syncGanttDatesToBoard(taskId, new Date(data.startDate), new Date(data.endDate)).catch(() => {})
  }
```

### 7c. Checklist actions -- sync progress

**File:** `src/lib/actions/checklist.ts`

**Add import:**

```typescript
import { syncChecklistToGanttProgress } from '@/lib/data/bridge'
```

**In `updateChecklistItem`, at the end (after the db.update call, before revalidatePath), add:**

```typescript
  syncChecklistToGanttProgress(taskId).catch(() => {})
```

**In `createChecklistItem`, at the end, add:**

```typescript
  syncChecklistToGanttProgress(data.taskId).catch(() => {})
```

**In `deleteChecklistItem`, at the end, add:**

```typescript
  syncChecklistToGanttProgress(taskId).catch(() => {})
```

---

## Step 8: Data Layer -- Tasks (add size support)

**File:** `src/lib/data/tasks.ts`

**In `createTask` function, add to `baseValues`:**

```typescript
size: data.size ?? null,
```

**In `updateTask` function, add after the `endDate` handling (line 95):**

```typescript
if (data.size !== undefined) updates.size = data.size
```

---

## Step 9: Validators -- Task schemas (add size)

Already covered in Step 2b. Also update the `CreateTaskInput` and `UpdateTaskInput` types -- they auto-infer from the schema.

---

## Step 10: Store Updates

### 10a. Board Store

**File:** `src/lib/store/boardStore.ts`

**Add `size` to `BoardTask` interface (after `onTimeline`):**

```typescript
interface BoardTask {
  id: string
  projectId: string
  name: string
  description?: string
  columnId?: string
  status: string
  priority: Priority
  color: string
  labels: string[]
  startDate?: string
  endDate?: string
  onTimeline: boolean
  ganttTaskId?: string | null
  size?: number | null
  orderIndex: number
}
```

### 10b. Gantt Store

**File:** `src/lib/store/ganttStore.ts`

**Add to `GanttTask` interface:**

```typescript
interface GanttTask {
  id: string
  projectId: string
  rowId: string | null
  name: string
  description?: string
  startDate: string
  endDate: string
  color: string
  progress: number
  dependencies: string[]
  boardTaskId?: string | null
}
```

**Add view management to state:**

```typescript
interface GanttView {
  id: string
  projectId: string
  name: string
  groupBy: string
  filters: Record<string, unknown>
}

interface GanttState {
  tasks: GanttTask[]
  rows: Row[]
  views: GanttView[]
  activeViewId: string | null
  selectedTaskId: string | null
  isDirty: boolean
  timeScale: 'day' | 'week' | 'month'

  setTasks: (tasks: GanttTask[]) => void
  addTask: (task: GanttTask) => void
  updateTask: (id: string, updates: Partial<GanttTask>) => void
  removeTask: (id: string) => void

  setRows: (rows: Row[]) => void
  addRow: (row: Row) => void
  updateRow: (id: string, updates: Partial<Row>) => void
  removeRow: (id: string) => void
  reorderRows: (projectId: string, fromIndex: number, toIndex: number) => void

  setViews: (views: GanttView[]) => void
  addView: (view: GanttView) => void
  removeView: (id: string) => void
  setActiveViewId: (id: string | null) => void

  selectTask: (id: string | null) => void
  setTimeScale: (scale: 'day' | 'week' | 'month') => void
  markClean: () => void
}
```

**Add to store implementation (inside `create`):**

```typescript
views: [],
activeViewId: null,

setViews: (views) => set({ views }),
addView: (view) => set((s) => ({ views: [...s.views, view] })),
removeView: (id) => set((s) => ({
  views: s.views.filter((v) => v.id !== id),
  activeViewId: s.activeViewId === id ? null : s.activeViewId,
})),
setActiveViewId: (id) => set({ activeViewId: id }),
```

**Update `partialize`:**

```typescript
partialize: (s) => ({ tasks: s.tasks, rows: s.rows, timeScale: s.timeScale, views: s.views, activeViewId: s.activeViewId }),
```

---

## Step 11: GanttViewSelector Component

**New file:** `src/components/gantt/GanttViewSelector.tsx`

```typescript
'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useGanttStore } from '@/lib/store/ganttStore'
import { generateId } from '@/lib/utils/colors'

const GROUP_BY_OPTIONS = [
  { value: 'column', label: 'By Column' },
  { value: 'label', label: 'By Label' },
  { value: 'priority', label: 'By Priority' },
  { value: 'dependency', label: 'By Dependency Chain' },
] as const

interface GanttViewSelectorProps {
  projectId: string
  onViewCreate: (view: {
    id: string
    projectId: string
    name: string
    groupBy: string
  }) => void
  onViewDelete: (viewId: string) => void
}

export function GanttViewSelector({ projectId, onViewCreate, onViewDelete }: GanttViewSelectorProps) {
  const { views, activeViewId, setActiveViewId } = useGanttStore()
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroupBy, setNewGroupBy] = useState<string>('column')

  const activeView = views.find((v) => v.id === activeViewId)

  const handleCreate = () => {
    if (!newName.trim()) return
    const id = generateId()
    onViewCreate({
      id,
      projectId,
      name: newName.trim(),
      groupBy: newGroupBy,
    })
    setNewName('')
    setNewGroupBy('column')
    setIsCreating(false)
    setIsOpen(false)
    setActiveViewId(id)
  }

  const handleDelete = (viewId: string) => {
    onViewDelete(viewId)
    if (activeViewId === viewId) {
      const remaining = views.filter((v) => v.id !== viewId)
      setActiveViewId(remaining[0]?.id ?? null)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
          'bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300'
        )}
      >
        {activeView?.name ?? 'Select View'}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setIsCreating(false) }} />
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.95 }}
              className="absolute left-0 top-full mt-2 z-50 w-64 rounded-xl bg-black/90 backdrop-blur-xl border border-white/10 shadow-xl overflow-hidden"
            >
              {views.length > 0 && (
                <div className="p-1">
                  {views.map((view) => (
                    <div
                      key={view.id}
                      className={cn(
                        'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
                        view.id === activeViewId
                          ? 'bg-cyan-500/20 text-cyan-400'
                          : 'text-slate-300 hover:bg-white/10'
                      )}
                      onClick={() => { setActiveViewId(view.id); setIsOpen(false) }}
                    >
                      <div>
                        <div className="text-sm font-medium">{view.name}</div>
                        <div className="text-xs text-slate-500">{view.groupBy}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(view.id) }}
                        className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-white/10 p-2">
                {isCreating ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="View name..."
                      className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    />
                    <div className="grid grid-cols-2 gap-1">
                      {GROUP_BY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setNewGroupBy(opt.value)}
                          className={cn(
                            'px-2 py-1 rounded-md text-xs font-medium transition-all',
                            newGroupBy === opt.value
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                              : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={handleCreate}
                        disabled={!newName.trim()}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 text-xs font-medium border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50 transition-all"
                      >
                        Create
                      </button>
                      <button
                        onClick={() => setIsCreating(false)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 text-xs border border-white/10 hover:bg-white/10 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsCreating(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    New View
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
```

---

## Step 12: TaskSizeBadge Component

**New file:** `src/components/board/TaskSizeBadge.tsx`

```typescript
'use client'

import { cn } from '@/lib/utils/cn'

interface TaskSizeBadgeProps {
  size: number | null | undefined
  className?: string
}

export function TaskSizeBadge({ size, className }: TaskSizeBadgeProps) {
  if (!size) return null

  const label = size % 1 === 0 ? `${size}d` : `${size}d`

  return (
    <span
      className={cn(
        'px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium',
        'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20',
        className
      )}
    >
      {label}
    </span>
  )
}
```

---

## Step 13: Size Input in TaskEditModal

**File:** `src/components/board/TaskEditModal.tsx`

### 13a. Add size to FormData interface

```typescript
interface FormData {
  name: string
  description: string
  color: string
  priority: typeof PRIORITIES[number]
  size: number | null
}
```

### 13b. Add size input in the form

**After the priority buttons section (after the closing `</div>` of the `flex items-center gap-3` div, around line 341), add:**

```typescript
<div>
  <label className="block text-sm text-slate-400 mb-1.5">Size (days)</label>
  <div className="flex items-center gap-2">
    <input
      type="number"
      value={formData.size ?? ''}
      onChange={(e) => {
        const val = e.target.value ? parseFloat(e.target.value) : null
        onFormChange({ ...formData, size: val })
      }}
      placeholder="Auto"
      step={0.5}
      min={0.5}
      max={20}
      className={cn(
        'w-24 px-3 py-2 rounded-lg',
        'bg-white/5 border border-white/10',
        'text-white placeholder-slate-500 text-sm',
        'focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
        'transition-all duration-200'
      )}
    />
    <span className="text-xs text-slate-500">
      {formData.size
        ? `${formData.size} day${formData.size !== 1 ? 's' : ''}`
        : `Auto (${formData.priority === 'urgent' ? '0.5d' : formData.priority === 'high' ? '1d' : formData.priority === 'medium' ? '1.5d' : '2.5d'})`
      }
    </span>
  </div>
</div>
```

### 13c. Add Push-to-Gantt button (editing mode only)

**After the dependency section (around line 416), add:**

```typescript
{editingTaskId && !tasks.find((t) => t.id === editingTaskId)?.onTimeline && (
  <div className="pt-4 border-t border-white/10">
    <button
      onClick={() => onPushToGantt?.(editingTaskId)}
      className={cn(
        'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg',
        'bg-cyan-500/10 border border-cyan-500/20',
        'text-cyan-400 text-sm font-medium',
        'hover:bg-cyan-500/20 transition-all duration-200'
      )}
    >
      <Calendar className="w-4 h-4" />
      Push to Gantt
    </button>
  </div>
)}
```

**Add `onPushToGantt` to `TaskEditModalProps`:**

```typescript
onPushToGantt?: (taskId: string) => void
```

**Add `Calendar` to the lucide-react import at the top.**

---

## Step 14: Push-to-Gantt in TaskContextMenu

**File:** `src/components/board/TaskContextMenu.tsx`

Examine the existing file structure and add a "Push to Gantt" option. The context menu should check if `onTimeline` is false and show the option.

**Add prop:**

```typescript
onPushToGantt?: (taskId: string) => void
```

**Add menu item (before delete option):**

```typescript
{!task.onTimeline && onPushToGantt && (
  <button
    onClick={() => { onPushToGantt(task.id); onClose() }}
    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 rounded-lg transition-colors"
  >
    <Calendar className="w-4 h-4 text-cyan-400" />
    Push to Gantt
  </button>
)}
```

---

## Step 15: SortableTaskCard -- Show Size Badge

**File:** `src/components/board/SortableTaskCard.tsx`

**Add to task interface:**

```typescript
size?: number | null
```

**Import TaskSizeBadge:**

```typescript
import { TaskSizeBadge } from './TaskSizeBadge'
```

**In the footer area (line 237, inside the `flex items-center gap-2 ml-auto` div), add before the date display:**

```typescript
<TaskSizeBadge size={task.size} />
```

---

## Step 16: TimelineHeader AM/PM Slots

**File:** `src/components/gantt/TimelineHeader.tsx`

**For `day` timeScale, modify the column generation to show AM/PM sub-slots:**

```typescript
case 'day':
  return eachDayOfInterval({ start: startDate, end: endDate }).map((date) => ({
    date,
    label: format(date, 'EEE d'),
    subLabel: format(date, 'MMM'),
    halfDaySlots: ['AM', 'PM'],
  }))
```

**In the render, for day scale, show two sub-columns per day:**

This requires modifying the header to render half-width sub-columns when timeScale is 'day'. The cellWidth for 'day' should be doubled (120px) to accommodate two 60px half-day slots.

**Updated CELL_WIDTHS in GanttChart.tsx:**

```typescript
const CELL_WIDTHS = { day: 120, week: 100, month: 150 }
```

**Updated TimelineHeader for day scale:**

When timeScale is 'day', each column renders with two sub-cells:

```typescript
{columns.map((col, i) => (
  <div
    key={i}
    className={cn(
      'flex-shrink-0 border-r border-white/5 text-center',
      i % 2 === 0 && 'bg-white/[0.02]'
    )}
    style={{ width: cellWidth }}
  >
    <div className="px-2 py-1 border-b border-white/5">
      <div className="text-xs text-slate-500">{col.subLabel}</div>
      <div className="text-sm font-medium text-slate-300">{col.label}</div>
    </div>
    {timeScale === 'day' && (
      <div className="flex">
        <div className="flex-1 text-[10px] text-slate-600 py-0.5 border-r border-white/5">AM</div>
        <div className="flex-1 text-[10px] text-slate-600 py-0.5">PM</div>
      </div>
    )}
  </div>
))}
```

---

## Step 17: GanttChart Bridge-Aware Rendering

**File:** `src/components/gantt/GanttChart.tsx`

### 17a. Filter rows by active view

```typescript
const { tasks, rows, views, activeViewId, timeScale, updateTask } = useGanttStore()

const activeView = views.find((v) => v.id === activeViewId)

const projectRows = rows
  .filter((r) => {
    if (!r.projectId) return false
    if (r.projectId !== projectId) return false
    return true
  })
  .sort((a, b) => a.orderIndex - b.orderIndex)
```

Note: Rows are filtered by `ganttViewId` at load time from the server, not in the store. The store holds only rows for the active view. This filtering happens in ProjectContent.

### 17b. Half-day snapping for drag

In `handleDragEnd`, when timeScale is 'day', snap to half-day increments:

```typescript
const handleDragEnd = useCallback((event: DragEndEvent) => {
  const { active, over, delta } = event
  if (!over) return

  const task = projectTasks.find((t) => t.id === active.id)
  if (!task) return

  let daysMoved: number
  if (timeScale === 'day') {
    const halfDaysMoved = Math.round((delta.x / (cellWidth / 2)))
    daysMoved = halfDaysMoved * 0.5
  } else {
    const daysPerCell = timeScale === 'week' ? 7 : 30
    daysMoved = Math.round((delta.x / cellWidth) * daysPerCell)
  }

  if (daysMoved !== 0) {
    const msPerDay = 24 * 60 * 60 * 1000
    const newStart = new Date(new Date(task.startDate).getTime() + daysMoved * msPerDay)
    const newEnd = new Date(new Date(task.endDate).getTime() + daysMoved * msPerDay)
    const dateUpdates = {
      startDate: newStart.toISOString(),
      endDate: newEnd.toISOString(),
    }
    updateTask(task.id, dateUpdates)
    onTaskUpdate?.(task.id, dateUpdates)
  }

  if (over.data.current?.type === 'row' && over.id !== task.rowId) {
    const rowUpdate = { rowId: over.id as string }
    updateTask(task.id, rowUpdate)
    onTaskUpdate?.(task.id, rowUpdate)
  }
}, [projectTasks, updateTask, onTaskUpdate, cellWidth, timeScale])
```

### 17c. Add GanttViewSelector to GanttChart header area

The GanttViewSelector is rendered in the ProjectContent header, not inside GanttChart. See Step 19.

---

## Step 18: Add `ganttViewId` to Row interface in ganttStore

**File:** `src/lib/store/ganttStore.ts`

```typescript
interface Row {
  id: string
  projectId: string
  ganttViewId?: string | null
  name: string
  color: string
  orderIndex: number
}
```

---

## Step 19: ProjectContent Wiring

**File:** `src/app/project/[id]/ProjectContent.tsx`

### 19a. Add imports

```typescript
import { getGanttViews, createGanttView as createGanttViewAction, deleteGanttView as deleteGanttViewAction } from '@/lib/actions/ganttViews'
import { pushToGantt } from '@/lib/actions/bridge'
import { GanttViewSelector } from '@/components/gantt/GanttViewSelector'
```

### 19b. Load gantt views in the useEffect

**In the `loadGantt` promise chain, add `getGanttViews`:**

```typescript
const loadGantt = Promise.all([
  getRows(project.id),
  getGanttTasks(project.id),
  getGanttViews(project.id),
])
  .then(([dbRows, dbGanttTasks, dbViews]) => {
    setRows(dbRows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      ganttViewId: r.ganttViewId,
      name: r.name,
      color: r.color,
      orderIndex: r.orderIndex,
    })))
    setGanttTasks(dbGanttTasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      rowId: t.rowId || '',
      name: t.name,
      description: t.description || undefined,
      startDate: t.startDate.toISOString(),
      endDate: t.endDate.toISOString(),
      color: t.color,
      progress: t.progress,
      dependencies: [],
      boardTaskId: t.boardTaskId || null,
    })))
    const { setViews, setActiveViewId } = useGanttStore.getState()
    setViews(dbViews.map((v) => ({
      id: v.id,
      projectId: v.projectId,
      name: v.name,
      groupBy: v.groupBy,
      filters: (v.filters ?? {}) as Record<string, unknown>,
    })))
    if (dbViews.length > 0 && !useGanttStore.getState().activeViewId) {
      setActiveViewId(dbViews[0].id)
    }
  })
```

### 19c. Add handlers

```typescript
const handleGanttViewCreate = useCallback((view: {
  id: string
  projectId: string
  name: string
  groupBy: string
}) => {
  const { addView } = useGanttStore.getState()
  addView({ ...view, filters: {} })
  createGanttViewAction(view).then(() => {
    setLoadKey((k) => k + 1)
  }).catch((err) => console.error('Failed to create gantt view:', err))
}, [])

const handleGanttViewDelete = useCallback((viewId: string) => {
  const { removeView } = useGanttStore.getState()
  removeView(viewId)
  deleteGanttViewAction(viewId, project.id).catch((err) => console.error('Failed to delete gantt view:', err))
}, [project.id])

const handlePushToGantt = useCallback((boardTaskId: string) => {
  const { activeViewId } = useGanttStore.getState()
  if (!activeViewId) {
    console.error('No active Gantt view selected')
    return
  }
  const ganttTaskId = crypto.randomUUID()
  const { updateTask: updateBoardTaskStore } = useBoardStore.getState()
  updateBoardTaskStore(boardTaskId, { onTimeline: true, ganttTaskId })

  pushToGantt({
    boardTaskId,
    projectId: project.id,
    ganttViewId: activeViewId,
    ganttTaskId,
  }).then((ganttTask) => {
    if (ganttTask) {
      const { addTask } = useGanttStore.getState()
      addTask({
        id: ganttTask.id,
        projectId: ganttTask.projectId,
        rowId: ganttTask.rowId || '',
        name: ganttTask.name,
        startDate: ganttTask.startDate.toISOString(),
        endDate: ganttTask.endDate.toISOString(),
        color: ganttTask.color,
        progress: ganttTask.progress,
        dependencies: [],
        boardTaskId: boardTaskId,
      })
    }
  }).catch((err) => {
    console.error('Failed to push to gantt:', err)
    updateBoardTaskStore(boardTaskId, { onTimeline: false, ganttTaskId: null })
  })
}, [project.id])
```

### 19d. Update header for Gantt tab

**Replace the existing `{activeTab === 'gantt' && <TimeScaleSelector />}` with:**

```typescript
{activeTab === 'gantt' && (
  <>
    <GanttViewSelector
      projectId={project.id}
      onViewCreate={handleGanttViewCreate}
      onViewDelete={handleGanttViewDelete}
    />
    <TimeScaleSelector />
  </>
)}
```

### 19e. Pass `onPushToGantt` to TaskBoard

```typescript
<TaskBoard
  projectId={project.id}
  // ... existing props ...
  onPushToGantt={handlePushToGantt}
/>
```

This requires TaskBoard to accept and forward the `onPushToGantt` prop to TaskEditModal and TaskContextMenu.

### 19f. Update board task mapping to include size

In the `loadBoard` task mapping (around line 93), add:

```typescript
size: t.size ?? null,
ganttTaskId: t.ganttTaskId ?? null,
```

---

## Step 20: TaskBoard Prop Threading

**File:** `src/components/board/TaskBoard.tsx`

**Add to TaskBoardProps interface:**

```typescript
onPushToGantt?: (taskId: string) => void
```

**Pass through to TaskEditModal and to SortableTaskCard (which passes to TaskContextMenu).**

---

## Step 21: Database Migration

Run after all schema changes:

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

**Expected SQL:**

```sql
CREATE TABLE "gantt_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "group_by" varchar(20) NOT NULL DEFAULT 'column',
  "filters" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "rows" ADD COLUMN "gantt_view_id" uuid REFERENCES "gantt_views"("id") ON DELETE CASCADE;
ALTER TABLE "board_tasks" ADD COLUMN "size" real;
ALTER TABLE "gantt_tasks" ADD COLUMN "board_task_id" uuid REFERENCES "board_tasks"("id") ON DELETE CASCADE;
```

**Validation:** Run migration on dev database. Verify all existing data is preserved (new columns are nullable). Verify FK constraints work: delete a board task, confirm linked gantt task is cascade-deleted via `boardTaskId` FK.

---

## Edge Cases

1. **Task already on Gantt**: `pushTaskToGantt` checks `ganttTaskId` and throws. UI should disable the button when `onTimeline` is true.

2. **No Gantt view selected**: `handlePushToGantt` checks `activeViewId` before proceeding. Show a toast or console warning.

3. **Empty board when creating view**: `generateRowsForView` handles empty arrays gracefully (returns empty for columns/labels, creates nothing for dependency chains).

4. **Gantt task deleted directly**: When a gantt task with `boardTaskId` is deleted, the `onDelete: cascade` on `ganttTasks.boardTaskId` would try to delete the board task -- but that's the REVERSE of what we want. We need `onDelete: SET NULL` on `ganttTasks.boardTaskId`, not cascade. Let me correct this:

   ```typescript
   boardTaskId: uuid('board_task_id').references(() => boardTasks.id, { onDelete: 'set null' }),
   ```

   The cascade direction should be: deleting a BOARD task cascades to delete the GANTT task. This is handled by the `deleteLinkedGanttTask` function in Step 7a, not by FK. The `ganttTasks.boardTaskId` FK with `onDelete: 'set null'` means: if the board task is deleted, the gantt task's `boardTaskId` becomes null (it becomes an orphaned gantt-only task). But we DON'T want that either -- we want the gantt task deleted.

   **Resolution**: Keep `onDelete: 'cascade'` on `ganttTasks.boardTaskId`. This means deleting a board task will cascade-delete any gantt task that references it. This is the correct behavior. The `deleteLinkedGanttTask` function becomes unnecessary (the FK cascade handles it), but keeping it provides belt-and-suspenders safety.

5. **Circular FK concern**: `boardTasks.ganttTaskId -> ganttTasks.id` (onDelete: set null) and `ganttTasks.boardTaskId -> boardTasks.id` (onDelete: cascade). Deleting a board task: FK cascade deletes the gantt task, then the board task's `ganttTaskId` is irrelevant because the board task is being deleted. No circular issue. Deleting a gantt task: FK sets `boardTasks.ganttTaskId` to null, board task survives. Correct.

6. **Multiple views, same task**: A board task can only be on ONE gantt task (1:1 via `ganttTaskId`). If the user wants the same task on multiple views, we'd need a many-to-many. For V1, restrict to one Gantt view per board task. The "Push to Gantt" button is disabled once `onTimeline` is true.

7. **Row regeneration**: If the user adds a new column after creating a "By Column" view, the new column won't have a row. Add a "Regenerate Rows" action that deletes existing view rows and recreates them. This can be a V2 enhancement -- for now, rows are generated at view creation time.

8. **Checklist progress edge case**: If a task has 0 checklist items and status is not 'done', progress should be 0 (not NaN from 0/0 division). Handled by the `if (items.length === 0) return 0` guard in `getChecklistProgress`.

9. **Half-day date arithmetic**: When `size = 0.5`, the gantt bar should span 12 hours. `computeEndDate(start, 0.5)` adds 12 hours of milliseconds. This is correct for timestamp storage.

---

## Testing Strategy

### Unit Tests (logic functions)
- `computeDuration(null, 'urgent')` returns 0.5
- `computeDuration(3, 'urgent')` returns 3 (size overrides priority)
- `computeStartDate(null, null)` returns today
- `computeStartDate(existingDate, null)` returns existingDate
- `computeEndDate(start, 0.5)` returns start + 12 hours
- `getChecklistProgress` with 3/5 checked returns 60

### Integration Tests (server actions)
- Create gantt view -> verify rows generated
- Push task to gantt -> verify both board and gantt tasks linked
- Update board task status to 'done' -> verify gantt progress = 100
- Drag gantt bar -> verify board task dates updated
- Toggle checklist item -> verify gantt progress updated
- Delete board task -> verify gantt task cascade-deleted

### UI Tests (manual)
- Create "By Column" view -> 4 rows appear matching board columns
- Push a task -> task bar appears in correct row
- Switch between views -> rows/tasks change
- Size badge visible on card when size is set
- AM/PM slots visible in day scale
- Half-day snapping works when dragging in day scale
