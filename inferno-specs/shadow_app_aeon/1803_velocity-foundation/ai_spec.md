# Velocity Foundation -- AI Execution Spec

**Mission:** 1803_velocity-foundation | **Date:** 18/03/2026

---

## Phase 1: Event Infrastructure

### Step 1: Add actorId and actorType columns to schema

**File:** `src/lib/db/schema.ts`

**Current Code** (lines 191-200):
```typescript
export const activityEvents = pgTable('activity_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  entityType: varchar('entity_type', { length: 30 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  action: varchar('action', { length: 30 }).notNull(),
  entityName: varchar('entity_name', { length: 255 }),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

**New Code:**
```typescript
export const activityEvents = pgTable('activity_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  entityType: varchar('entity_type', { length: 30 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  action: varchar('action', { length: 30 }).notNull(),
  entityName: varchar('entity_name', { length: 255 }),
  metadata: jsonb('metadata').default({}).notNull(),
  actorId: varchar('actor_id', { length: 255 }),
  actorType: varchar('actor_type', { length: 10 }).default('user').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

**Why:** `actorId` is varchar (not uuid) because MCP agent uses `AEON_API_USER_ID` which may not be a UUID. `actorType` defaults to `'user'` for backwards compatibility -- all existing rows get `'user'` automatically.

**Validation:** Run `npx drizzle-kit push` -- should add two columns without data loss. Verify with `npx drizzle-kit studio`.

---

### Step 2: Update emitActivity signature

**File:** `src/lib/data/activity.ts`

**Current Code** (lines 5-24):
```typescript
export type ActivityEntityType = 'task' | 'column' | 'dependency' | 'label' | 'gantt_task' | 'canvas_node' | 'project'
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'moved' | 'completed' | 'vaulted' | 'archived' | 'restored' | 'dependency_added' | 'dependency_removed' | 'label_added' | 'label_removed'

export async function emitActivity(
  projectId: string,
  entityType: ActivityEntityType,
  entityId: string,
  action: ActivityAction,
  entityName?: string,
  metadata?: Record<string, unknown>
) {
  await db.insert(activityEvents).values({
    projectId,
    entityType,
    entityId,
    action,
    entityName: entityName ?? null,
    metadata: metadata ?? {},
  })
}
```

**New Code:**
```typescript
export type ActivityEntityType = 'task' | 'column' | 'dependency' | 'label' | 'gantt_task' | 'canvas_node' | 'project'
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'moved' | 'completed' | 'vaulted' | 'archived' | 'restored' | 'dependency_added' | 'dependency_removed' | 'label_added' | 'label_removed' | 'column_entered' | 'column_exited'
export type ActorType = 'user' | 'agent'

export async function emitActivity(
  projectId: string,
  entityType: ActivityEntityType,
  entityId: string,
  action: ActivityAction,
  entityName?: string,
  metadata?: Record<string, unknown>,
  actorId?: string,
  actorType?: ActorType
) {
  await db.insert(activityEvents).values({
    projectId,
    entityType,
    entityId,
    action,
    entityName: entityName ?? null,
    metadata: metadata ?? {},
    actorId: actorId ?? null,
    actorType: actorType ?? 'user',
  })
}
```

**Why:** New params are optional at the end -- zero changes needed to existing call sites that don't pass them. Added `column_entered` and `column_exited` action types for explicit transition tracking. Exported `ActorType` for use in MCP route.

**Validation:** TypeScript compilation should pass. All 17 existing call sites remain valid (new params are optional).

---

### Step 3: Thread userId into board.ts emitActivity calls

**File:** `src/lib/actions/board.ts`

Key pattern: `requireOwnership(projectId)` already returns `userId` (see `helpers.ts` line 12-17). Most call sites already call `requireOwnership` but don't capture the return value.

**Change 1 -- createBoardTask** (line 54, 72):

Current:
```typescript
  await requireOwnership(data.projectId)
  ...
  emitActivity(data.projectId, 'task', task.id, 'created', data.name).catch(() => {})
```

New:
```typescript
  const userId = await requireOwnership(data.projectId)
  ...
  emitActivity(data.projectId, 'task', task.id, 'created', data.name, undefined, userId).catch(() => {})
```

**Change 2 -- updateBoardTask** (lines 95, 101-107):

Current:
```typescript
  await requireOwnership(projectId)
  ...
  if (parsed.status === 'done') {
    emitActivity(projectId, 'task', taskId, 'completed', task?.name).catch(() => {})
  } else if (parsed.columnId) {
    emitActivity(projectId, 'task', taskId, 'moved', task?.name, { toColumnId: parsed.columnId }).catch(() => {})
  } else {
    emitActivity(projectId, 'task', taskId, 'updated', task?.name).catch(() => {})
  }
```

New:
```typescript
  const userId = await requireOwnership(projectId)
  ...
  if (parsed.status === 'done') {
    emitActivity(projectId, 'task', taskId, 'completed', task?.name, undefined, userId).catch(() => {})
  } else if (parsed.columnId) {
    emitActivity(projectId, 'task', taskId, 'moved', task?.name, { fromColumnId: task?.columnId, toColumnId: parsed.columnId }, userId).catch(() => {})
  } else {
    emitActivity(projectId, 'task', taskId, 'updated', task?.name, undefined, userId).catch(() => {})
  }
```

**Important:** The `task` variable (line 99, return from `_updateTask`) contains the **updated** task. We need the **pre-update** columnId for `fromColumnId`. We must fetch the task before updating.

Revised approach for updateBoardTask:
```typescript
export async function updateBoardTask(
  taskId: string,
  projectId: string,
  data: {
    name?: string
    description?: string | null
    columnId?: string
    status?: string
    priority?: string
    color?: string
    onTimeline?: boolean
    size?: number | null
    orderIndex?: number
    startDate?: string | null
    endDate?: string | null
  }
) {
  const userId = await requireOwnership(projectId)

  const parsed = updateTaskSchema.parse(data)

  let previousColumnId: string | null | undefined
  if (parsed.columnId) {
    const existing = await _findTaskById(taskId, projectId)
    previousColumnId = existing?.columnId
  }

  const task = await _updateTask(taskId, projectId, parsed)

  if (parsed.status === 'done') {
    emitActivity(projectId, 'task', taskId, 'completed', task?.name, undefined, userId).catch(() => {})
  } else if (parsed.columnId) {
    emitActivity(projectId, 'task', taskId, 'moved', task?.name, { fromColumnId: previousColumnId, toColumnId: parsed.columnId }, userId).catch(() => {})
  } else {
    emitActivity(projectId, 'task', taskId, 'updated', task?.name, undefined, userId).catch(() => {})
  }

  if (parsed.status) {
    syncBoardStatusToGantt(taskId, parsed.status).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
  return task
}
```

Note: `_findTaskById` is already imported in board.ts (line 8).

**Change 3 -- deleteBoardTask** (lines 117-120):

Current:
```typescript
  await requireOwnership(projectId)
  const taskToDelete = await _findTaskById(taskId, projectId)
  emitActivity(projectId, 'task', taskId, 'deleted', taskToDelete?.name).catch(() => {})
```

New:
```typescript
  const userId = await requireOwnership(projectId)
  const taskToDelete = await _findTaskById(taskId, projectId)
  emitActivity(projectId, 'task', taskId, 'deleted', taskToDelete?.name, undefined, userId).catch(() => {})
```

**Change 4 -- reorderBoardTasks** (lines 126-143):

Current:
```typescript
export async function reorderBoardTasks(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[]
) {
  await requireOwnership(projectId)
  const parsed = updates.map(u => reorderTaskEntrySchema.parse(u))
  await _reorderTasks(projectId, parsed)
  const moves = updates.filter(u => u.columnId)
  for (const move of moves) {
    emitActivity(projectId, 'task', move.id, 'moved', move.name, { toColumnId: move.columnId }).catch(() => {})
  }
  for (const u of updates) {
    if (u.status === 'done') {
      emitActivity(projectId, 'task', u.id, 'completed', u.name, { via: 'drag' }).catch(() => {})
    }
  }
  revalidatePath(`/project/${projectId}`)
}
```

New (capturing fromColumnId requires fetching tasks before reorder):
```typescript
export async function reorderBoardTasks(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[]
) {
  const userId = await requireOwnership(projectId)

  const movingIds = updates.filter(u => u.columnId).map(u => u.id)
  let previousColumns = new Map<string, string | null>()
  if (movingIds.length > 0) {
    const allTasks = await _findTasks(projectId)
    for (const t of allTasks) {
      if (movingIds.includes(t.id)) {
        previousColumns.set(t.id, t.columnId)
      }
    }
  }

  const parsed = updates.map(u => reorderTaskEntrySchema.parse(u))
  await _reorderTasks(projectId, parsed)

  const moves = updates.filter(u => u.columnId)
  for (const move of moves) {
    emitActivity(projectId, 'task', move.id, 'moved', move.name, {
      fromColumnId: previousColumns.get(move.id) ?? null,
      toColumnId: move.columnId,
    }, userId).catch(() => {})
  }
  for (const u of updates) {
    if (u.status === 'done') {
      emitActivity(projectId, 'task', u.id, 'completed', u.name, { via: 'drag' }, userId).catch(() => {})
    }
  }
  revalidatePath(`/project/${projectId}`)
}
```

Note: `_findTasks` is already imported in board.ts (used in `archiveColumnTasks`). `_findTasks` is imported as `findTasks as _findTasks` on line 6. Verify this import exists; it does not exist in the current imports. Actually looking at line 6-17:

```typescript
import {
  findTasks as _findTasks,        // line 6 -- YES, already imported
  findTaskById as _findTaskById,
  ...
}
```

Confirmed: `_findTasks` is available.

**Change 5 -- archiveBoardTask** (lines 145-153):

Current:
```typescript
  await requireOwnership(projectId)
```

New:
```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'task', taskId, 'archived', task.name, undefined, userId).catch(() => {})
```

**Change 6 -- restoreBoardTask** (lines 155-163):

Same pattern:
```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'task', taskId, 'restored', task.name, undefined, userId).catch(() => {})
```

**Change 7 -- archiveColumnTasks** (lines 170-180):

```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'task', task.id, 'archived', task.name, undefined, userId).catch(() => {})
```

**Validation:** TypeScript compiles. Run app, create/move/delete a task -- verify new events in DB have `actorId` populated and `actorType = 'user'`.

---

### Step 4: Thread userId into dependencies.ts

**File:** `src/lib/actions/dependencies.ts`

**Change 1 -- addTaskDependency** (line 19, 29):

Current:
```typescript
  await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'dependency', parsed.blockerTaskId, 'dependency_added', undefined, {
```

New:
```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'dependency', parsed.blockerTaskId, 'dependency_added', undefined, {
    blockerTaskId: parsed.blockerTaskId,
    blockedTaskId: parsed.blockedTaskId,
  }, userId).catch(() => {})
```

**Change 2 -- removeTaskDependency** (line 41, 43):

Current:
```typescript
  await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'dependency', blockerTaskId, 'dependency_removed', undefined, {
```

New:
```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'dependency', blockerTaskId, 'dependency_removed', undefined, {
    blockerTaskId,
    blockedTaskId,
  }, userId).catch(() => {})
```

---

### Step 5: Thread userId into labels.ts

**File:** `src/lib/actions/labels.ts`

**Change 1 -- addLabelToTask** (line 49, 52):

Current:
```typescript
  await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'label', taskId, 'label_added', undefined, { labelId, taskId }).catch(() => {})
```

New:
```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'label', taskId, 'label_added', undefined, { labelId, taskId }, userId).catch(() => {})
```

**Change 2 -- removeLabelFromTask** (line 57, 59):

Same pattern:
```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'label', taskId, 'label_removed', undefined, { labelId, taskId }, userId).catch(() => {})
```

---

### Step 6: Thread userId into vault.ts

**File:** `src/lib/actions/vault.ts`

**Change 1 -- sendToVault** (line 31, 36):

Current:
```typescript
  await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'task', taskId, 'vaulted', taskName ?? vaulted.name).catch(() => {})
```

New:
```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'task', taskId, 'vaulted', taskName ?? vaulted.name, undefined, userId).catch(() => {})
```

**Change 2 -- sendBatchToVault** (line 47, 55):

```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'task', entry.taskId, 'vaulted', entry.taskName, undefined, userId).catch(() => {})
```

**Change 3 -- restoreVaultTask** (line 63, 66):

```typescript
  const userId = await requireOwnership(projectId)
  ...
  emitActivity(projectId, 'task', restored.id, 'restored', restored.name, undefined, userId).catch(() => {})
```

---

### Step 7: Add emitActivity to MCP server mutating tools

**File:** `src/app/api/[transport]/route.ts`

**New import** (add after line 49):
```typescript
import { emitActivity } from '@/lib/data/activity'
```

The MCP server uses `userId()` helper (line 51-54) which returns `AEON_API_USER_ID`. This becomes the `actorId`, with `actorType: 'agent'`.

For each mutating tool, add an `emitActivity` call with `.catch(() => {})` after the mutation. Pattern:

```typescript
emitActivity(projectId, entityType, entityId, action, entityName, metadata, userId(), 'agent').catch(() => {})
```

**Mutating tools to instrument (14 total):**

1. **create_project** (line 90-100):
```typescript
async (input) => {
  const project = await createProject(userId(), input)
  emitActivity(project.id, 'project', project.id, 'created', project.name, undefined, userId(), 'agent').catch(() => {})
  return ok(project)
}
```

2. **update_project** (line 102-114):
```typescript
async ({ projectId, ...data }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const project = await updateProject(projectId, userId(), data)
  if (project) {
    emitActivity(projectId, 'project', projectId, 'updated', project.name, undefined, userId(), 'agent').catch(() => {})
  }
  return project ? ok(project) : notFound('Project')
}
```

3. **delete_project** (line 116-127):
```typescript
async ({ projectId }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const deleted = await deleteProject(projectId, userId())
  if (deleted) {
    emitActivity(projectId, 'project', projectId, 'deleted', undefined, undefined, userId(), 'agent').catch(() => {})
  }
  return deleted ? ok({ deleted: true }) : notFound('Project')
}
```

4. **create_column** (line 139-149):
```typescript
async ({ projectId, ...data }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const col = await createColumn(projectId, data)
  emitActivity(projectId, 'column', col.id, 'created', col.name, undefined, userId(), 'agent').catch(() => {})
  return ok(col)
}
```

5. **update_column** (line 152-165):
```typescript
async ({ projectId, columnId, ...data }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const col = await updateColumn(columnId, projectId, data)
  if (col) {
    emitActivity(projectId, 'column', columnId, 'updated', col.name, undefined, userId(), 'agent').catch(() => {})
  }
  return col ? ok(col) : notFound('Column')
}
```

6. **delete_column** (line 167-179):
```typescript
async ({ projectId, columnId }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const deleted = await deleteColumnData(columnId, projectId)
  if (deleted) {
    emitActivity(projectId, 'column', columnId, 'deleted', undefined, undefined, userId(), 'agent').catch(() => {})
  }
  return deleted ? ok({ deleted: true }) : notFound('Column')
}
```

7. **create_task** (line 214-235):
```typescript
async ({ projectId, columnId, ...data }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const task = await createTask(projectId, {
    ...data,
    columnId,
    status: data.status ?? 'todo',
    priority: data.priority ?? 'medium',
    color: data.color ?? 'purple',
  })
  emitActivity(projectId, 'task', task.id, 'created', task.name, undefined, userId(), 'agent').catch(() => {})
  return ok(task)
}
```

8. **update_task** (line 237-254):
```typescript
async ({ projectId, taskId, columnId, ...data }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const task = await updateTask(taskId, projectId, { ...data, columnId })
  if (task) {
    const action = data.status === 'done' ? 'completed' : columnId ? 'moved' : 'updated'
    const meta = columnId ? { toColumnId: columnId } : undefined
    emitActivity(projectId, 'task', taskId, action, task.name, meta, userId(), 'agent').catch(() => {})
  }
  return task ? ok(task) : notFound('Task')
}
```

9. **delete_task** (line 256-268):
```typescript
async ({ projectId, taskId }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const deleted = await deleteTask(taskId, projectId)
  if (deleted) {
    emitActivity(projectId, 'task', taskId, 'deleted', undefined, undefined, userId(), 'agent').catch(() => {})
  }
  return deleted ? ok({ deleted: true }) : notFound('Task')
}
```

10. **add_dependency** (line 336-355):
```typescript
async ({ projectId, blockerTaskId, blockedTaskId }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  if (blockerTaskId === blockedTaskId) {
    return { content: [{ type: 'text' as const, text: 'A task cannot depend on itself' }], isError: true as const }
  }
  if (await wouldCreateCycle(blockerTaskId, blockedTaskId, projectId)) {
    return { content: [{ type: 'text' as const, text: 'Would create a circular dependency' }], isError: true as const }
  }
  await addDependency(blockerTaskId, blockedTaskId, projectId)
  emitActivity(projectId, 'dependency', blockerTaskId, 'dependency_added', undefined, { blockerTaskId, blockedTaskId }, userId(), 'agent').catch(() => {})
  return ok({ added: true, blockerTaskId, blockedTaskId })
}
```

11. **remove_dependency** (line 357-370):
```typescript
async ({ projectId, blockerTaskId, blockedTaskId }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  await removeDependency(blockerTaskId, blockedTaskId, projectId)
  emitActivity(projectId, 'dependency', blockerTaskId, 'dependency_removed', undefined, { blockerTaskId, blockedTaskId }, userId(), 'agent').catch(() => {})
  return ok({ removed: true })
}
```

12. **add_label_to_task** (line 417-430):
```typescript
async ({ projectId, taskId, labelId }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  await addLabelToTask(taskId, labelId, projectId)
  emitActivity(projectId, 'label', taskId, 'label_added', undefined, { labelId, taskId }, userId(), 'agent').catch(() => {})
  return ok({ added: true, taskId, labelId })
}
```

13. **remove_label_from_task** (line 432-445):
```typescript
async ({ projectId, taskId, labelId }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  await removeLabelFromTask(taskId, labelId, projectId)
  emitActivity(projectId, 'label', taskId, 'label_removed', undefined, { labelId, taskId }, userId(), 'agent').catch(() => {})
  return ok({ removed: true })
}
```

14. **batch_create_tasks** (line 508-530):
```typescript
async ({ projectId, tasks }) => {
  if (!await requireOwnership(projectId)) return notFound('Project')
  const created = await createTasksBatch(projectId, tasks)
  for (const t of created) {
    emitActivity(projectId, 'task', t.id, 'created', t.name, undefined, userId(), 'agent').catch(() => {})
  }
  return ok({ created: created.length, tasks: created.map((t) => ({ id: t.id, name: t.name })) })
}
```

**Note on setup_board:** This tool creates columns, labels, and tasks in bulk. Rather than emitting individual events for each (which could be 50+ events), emit a single summary event:

```typescript
emitActivity(projectId, 'project', projectId, 'updated', undefined, {
  via: 'setup_board',
  columns: columnMap.size,
  labels: labelMap.size,
  tasks: taskCount,
}, userId(), 'agent').catch(() => {})
```

Add this before the final `return ok(...)` in setup_board.

**Validation:** Use MCP client to create a task. Check DB: `actorType` should be `'agent'`, `actorId` should match `AEON_API_USER_ID`.

---

### Step 8: Run database migration

```bash
npx drizzle-kit push
```

This adds `actor_id` (varchar, nullable) and `actor_type` (varchar, NOT NULL, default 'user') to the `activity_events` table. Existing rows get `actor_type = 'user'` and `actor_id = NULL`.

---

## Phase 2: Velocity Data Layer

### Step 9: Create velocity.ts data layer

**File:** `src/lib/data/velocity.ts` (NEW)

```typescript
import { db } from '@/lib/db'
import { activityEvents, taskVault, boardColumns } from '@/lib/db/schema'
import { eq, and, gte, sql, desc } from 'drizzle-orm'

export type VelocityRange = '7d' | '30d' | '90d' | 'all'

function rangeToDate(range: VelocityRange): Date | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

export async function getCompletionVelocity(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)
  const interval = range === '7d' ? 'day' : range === '30d' ? 'day' : 'week'

  const conditions = [
    eq(activityEvents.projectId, projectId),
    sql`${activityEvents.action} IN ('completed', 'vaulted')`,
  ]
  if (since) {
    conditions.push(gte(activityEvents.createdAt, since))
  }

  const rows = await db
    .select({
      period: sql<string>`date_trunc(${sql.raw(`'${interval}'`)}, ${activityEvents.createdAt})::date::text`,
      count: sql<number>`count(DISTINCT ${activityEvents.entityId})::int`,
    })
    .from(activityEvents)
    .where(and(...conditions))
    .groupBy(sql`date_trunc(${sql.raw(`'${interval}'`)}, ${activityEvents.createdAt})`)
    .orderBy(sql`date_trunc(${sql.raw(`'${interval}'`)}, ${activityEvents.createdAt})`)

  return rows
}

export async function getCycleTimeStats(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)

  const conditions = [eq(taskVault.projectId, projectId)]
  if (since) {
    conditions.push(gte(taskVault.archivedAt, since))
  }

  const [result] = await db
    .select({
      avgDays: sql<number>`avg(${taskVault.daysTaken})`,
      medianDays: sql<number>`percentile_cont(0.5) within group (order by ${taskVault.daysTaken})`,
      p95Days: sql<number>`percentile_cont(0.95) within group (order by ${taskVault.daysTaken})`,
      totalCompleted: sql<number>`count(*)::int`,
    })
    .from(taskVault)
    .where(and(...conditions, sql`${taskVault.daysTaken} IS NOT NULL`))

  return {
    avgDays: result?.avgDays ? Math.round(result.avgDays * 10) / 10 : null,
    medianDays: result?.medianDays ? Math.round(result.medianDays * 10) / 10 : null,
    p95Days: result?.p95Days ? Math.round(result.p95Days * 10) / 10 : null,
    totalCompleted: result?.totalCompleted ?? 0,
  }
}

export async function getColumnDwellTimes(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)

  const conditions = [
    eq(activityEvents.projectId, projectId),
    eq(activityEvents.action, 'moved'),
  ]
  if (since) {
    conditions.push(gte(activityEvents.createdAt, since))
  }

  const movedEvents = await db
    .select({
      entityId: activityEvents.entityId,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(and(...conditions))
    .orderBy(activityEvents.entityId, activityEvents.createdAt)

  const columns = await db
    .select({ id: boardColumns.id, name: boardColumns.name })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))

  const columnNameMap = new Map(columns.map(c => [c.id, c.name]))
  const dwellAccum = new Map<string, number[]>()

  let prevEvent: { entityId: string; toColumnId: string; time: Date } | null = null

  for (const ev of movedEvents) {
    const meta = ev.metadata as Record<string, unknown>
    const toCol = meta?.toColumnId as string | undefined
    const fromCol = meta?.fromColumnId as string | undefined

    if (prevEvent && prevEvent.entityId === ev.entityId && fromCol) {
      const dwellMs = new Date(ev.createdAt).getTime() - prevEvent.time.getTime()
      const dwellHours = dwellMs / (1000 * 60 * 60)
      const colName = columnNameMap.get(fromCol) ?? fromCol
      if (!dwellAccum.has(colName)) dwellAccum.set(colName, [])
      dwellAccum.get(colName)!.push(dwellHours)
    }

    prevEvent = toCol
      ? { entityId: ev.entityId, toColumnId: toCol, time: new Date(ev.createdAt) }
      : null
  }

  return Array.from(dwellAccum.entries()).map(([column, hours]) => ({
    column,
    avgHours: Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10,
    count: hours.length,
  }))
}

export async function getActivityHeatmap(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)

  const conditions = [
    eq(activityEvents.projectId, projectId),
    sql`${activityEvents.action} IN ('completed', 'vaulted')`,
  ]
  if (since) {
    conditions.push(gte(activityEvents.createdAt, since))
  }

  const rows = await db
    .select({
      dayOfWeek: sql<number>`extract(dow from ${activityEvents.createdAt})::int`,
      hourOfDay: sql<number>`extract(hour from ${activityEvents.createdAt})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(activityEvents)
    .where(and(...conditions))
    .groupBy(
      sql`extract(dow from ${activityEvents.createdAt})`,
      sql`extract(hour from ${activityEvents.createdAt})`
    )

  return rows
}

export async function getPriorityBreakdown(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)

  const conditions = [eq(taskVault.projectId, projectId)]
  if (since) {
    conditions.push(gte(taskVault.archivedAt, since))
  }

  const rows = await db
    .select({
      priority: taskVault.priority,
      count: sql<number>`count(*)::int`,
      avgDays: sql<number>`avg(${taskVault.daysTaken})`,
    })
    .from(taskVault)
    .where(and(...conditions))
    .groupBy(taskVault.priority)

  return rows.map(r => ({
    priority: r.priority,
    count: r.count,
    avgDays: r.avgDays ? Math.round(r.avgDays * 10) / 10 : null,
  }))
}

export async function getVelocityStats(projectId: string, range: VelocityRange = '30d') {
  const [velocity, cycleTime, dwellTimes, heatmap, priorities] = await Promise.all([
    getCompletionVelocity(projectId, range),
    getCycleTimeStats(projectId, range),
    getColumnDwellTimes(projectId, range),
    getActivityHeatmap(projectId, range),
    getPriorityBreakdown(projectId, range),
  ])

  return { velocity, cycleTime, dwellTimes, heatmap, priorities, range }
}
```

**Why these query patterns:**
- `getCompletionVelocity` uses `date_trunc` for bucketing -- groups by day for 7d/30d, by week for 90d
- `getCycleTimeStats` uses `percentile_cont` (available in Neon/PostgreSQL) for accurate median/p95
- `getColumnDwellTimes` processes in application code rather than SQL because it needs to pair consecutive events per task -- complex window functions would be harder to maintain
- `getActivityHeatmap` uses `extract(dow/hour)` for bucketing -- timezone conversion done client-side
- `getVelocityStats` is the aggregate endpoint that fetches all metrics in parallel

**Validation:** Call each function with a projectId that has vault data. Verify non-null results.

---

### Step 10: Create velocity actions

**File:** `src/lib/actions/velocity.ts` (NEW)

```typescript
'use server'

import { requireOwnership } from './helpers'
import {
  getVelocityStats as _getVelocityStats,
  getCompletionVelocity as _getCompletionVelocity,
  getCycleTimeStats as _getCycleTimeStats,
  getColumnDwellTimes as _getColumnDwellTimes,
  getActivityHeatmap as _getActivityHeatmap,
  getPriorityBreakdown as _getPriorityBreakdown,
  type VelocityRange,
} from '@/lib/data/velocity'

export async function getVelocityStats(projectId: string, range: VelocityRange = '30d') {
  await requireOwnership(projectId)
  return _getVelocityStats(projectId, range)
}

export async function getCompletionVelocity(projectId: string, range: VelocityRange = '30d') {
  await requireOwnership(projectId)
  return _getCompletionVelocity(projectId, range)
}

export async function getCycleTimeStats(projectId: string, range: VelocityRange = '30d') {
  await requireOwnership(projectId)
  return _getCycleTimeStats(projectId, range)
}

export async function getColumnDwellTimes(projectId: string, range: VelocityRange = '30d') {
  await requireOwnership(projectId)
  return _getColumnDwellTimes(projectId, range)
}

export async function getActivityHeatmap(projectId: string, range: VelocityRange = '30d') {
  await requireOwnership(projectId)
  return _getActivityHeatmap(projectId, range)
}

export async function getPriorityBreakdown(projectId: string, range: VelocityRange = '30d') {
  await requireOwnership(projectId)
  return _getPriorityBreakdown(projectId, range)
}
```

---

### Step 11: Add get_velocity_stats MCP tool

**File:** `src/app/api/[transport]/route.ts`

Add after the existing imports (around line 49), add:
```typescript
import { getVelocityStats } from '@/lib/data/velocity'
```

Add new tool before the closing `}` of the server setup (before line 677):

```typescript
    server.tool(
      'get_velocity_stats',
      'Get velocity analytics for a project: completion rate, cycle times, column dwell times, activity heatmap, priority breakdown',
      {
        projectId: z.string().uuid().describe('The project UUID'),
        range: z.enum(['7d', '30d', '90d', 'all']).default('30d').describe('Time range for analysis'),
      },
      async ({ projectId, range }) => {
        if (!await requireOwnership(projectId)) return notFound('Project')
        return ok(await getVelocityStats(projectId, range))
      }
    )
```

---

## Phase 3: Velocity Tab UI

### Step 12: Create VelocityTab component

**File:** `src/components/velocity/VelocityTab.tsx` (NEW)

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { getVelocityStats } from '@/lib/actions/velocity'
import type { VelocityRange } from '@/lib/data/velocity'
import { VelocityChart } from './VelocityChart'
import { CycleTimeCard } from './CycleTimeCard'
import { HeatmapGrid } from './HeatmapGrid'
import { ColumnFlowBar } from './ColumnFlowBar'
import { cn } from '@/lib/utils/cn'

interface VelocityTabProps {
  projectId: string
}

type VelocityData = Awaited<ReturnType<typeof getVelocityStats>>

const RANGES: { value: VelocityRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
]

export function VelocityTab({ projectId }: VelocityTabProps) {
  const [range, setRange] = useState<VelocityRange>('30d')
  const [data, setData] = useState<VelocityData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const stats = await getVelocityStats(projectId, range)
      setData(stats)
    } catch (err) {
      console.error('Failed to load velocity stats:', err)
    } finally {
      setIsLoading(false)
    }
  }, [projectId, range])

  useEffect(() => {
    loadData()
  }, [loadData])

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      <div className="flex items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200',
              range === r.value
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-300 hover:bg-white/[0.07]'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          Loading velocity data...
        </div>
      ) : data ? (
        <>
          <CycleTimeCard
            avgDays={data.cycleTime.avgDays}
            medianDays={data.cycleTime.medianDays}
            p95Days={data.cycleTime.p95Days}
            totalCompleted={data.cycleTime.totalCompleted}
            priorities={data.priorities}
          />

          <div className="grid grid-cols-2 gap-4">
            <VelocityChart data={data.velocity} range={range} />
            <HeatmapGrid data={data.heatmap} />
          </div>

          <ColumnFlowBar data={data.dwellTimes} />
        </>
      ) : (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          No velocity data available
        </div>
      )}
    </div>
  )
}
```

---

### Step 13: Create CycleTimeCard component

**File:** `src/components/velocity/CycleTimeCard.tsx` (NEW)

```typescript
'use client'

import { motion } from 'framer-motion'
import { Clock, Gauge, TrendingUp, Target } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface CycleTimeCardProps {
  avgDays: number | null
  medianDays: number | null
  p95Days: number | null
  totalCompleted: number
  priorities: { priority: string; count: number; avgDays: number | null }[]
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

const statVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 22 } },
}

const priorityColors: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-blue-400',
  low: 'text-slate-400',
}

const priorityBg: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-slate-500',
}

function formatDays(days: number | null): string {
  if (days === null) return 'N/A'
  if (days < 1) return '<1d'
  return `${days}d`
}

export function CycleTimeCard({ avgDays, medianDays, p95Days, totalCompleted, priorities }: CycleTimeCardProps) {
  const cardClass = 'backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4'
  const priorityTotal = priorities.reduce((sum, p) => sum + p.count, 0)

  return (
    <motion.div
      className="grid grid-cols-4 gap-3"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={statVariants} className={cardClass}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Completed</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">{totalCompleted}</div>
        <div className="text-xs text-amber-400/70 mt-1">tasks in range</div>
      </motion.div>

      <motion.div variants={statVariants} className={cardClass}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Avg / Median</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">{formatDays(avgDays)}</div>
        <div className="text-xs text-amber-400/70 mt-1">median {formatDays(medianDays)}</div>
      </motion.div>

      <motion.div variants={statVariants} className={cardClass}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Gauge className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">P95</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">{formatDays(p95Days)}</div>
        <div className="text-xs text-amber-400/70 mt-1">95th percentile</div>
      </motion.div>

      <motion.div variants={statVariants} className={cardClass}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Target className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">By Priority</span>
        </div>
        {priorityTotal > 0 ? (
          <div className="space-y-1.5">
            <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const entry = priorities.find(pr => pr.priority === p)
                const pct = entry ? (entry.count / priorityTotal) * 100 : 0
                if (pct === 0) return null
                return (
                  <div
                    key={p}
                    className={cn('h-full', priorityBg[p])}
                    style={{ width: `${pct}%` }}
                    title={`${p}: ${entry?.count ?? 0} (avg ${formatDays(entry?.avgDays ?? null)})`}
                  />
                )
              })}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const entry = priorities.find(pr => pr.priority === p)
                if (!entry || entry.count === 0) return null
                return (
                  <span key={p} className={cn('text-[10px] font-medium', priorityColors[p])}>
                    {p.charAt(0).toUpperCase()}: {entry.count}
                  </span>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="text-slate-500 text-sm">-</div>
        )}
      </motion.div>
    </motion.div>
  )
}
```

---

### Step 14: Create VelocityChart component (SVG line chart)

**File:** `src/components/velocity/VelocityChart.tsx` (NEW)

```typescript
'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import type { VelocityRange } from '@/lib/data/velocity'

interface VelocityChartProps {
  data: { period: string; count: number }[]
  range: VelocityRange
}

const CHART_HEIGHT = 200
const CHART_PADDING = { top: 20, right: 20, bottom: 30, left: 40 }

export function VelocityChart({ data, range }: VelocityChartProps) {
  const { points, maxY, yTicks, xLabels, pathD, areaD } = useMemo(() => {
    if (data.length === 0) return { points: [], maxY: 0, yTicks: [], xLabels: [], pathD: '', areaD: '' }

    const max = Math.max(...data.map(d => d.count), 1)
    const roundedMax = Math.ceil(max / 5) * 5 || 5

    const width = 500 - CHART_PADDING.left - CHART_PADDING.right
    const height = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

    const pts = data.map((d, i) => ({
      x: CHART_PADDING.left + (data.length === 1 ? width / 2 : (i / (data.length - 1)) * width),
      y: CHART_PADDING.top + height - (d.count / roundedMax) * height,
      label: d.period,
      value: d.count,
    }))

    const ticks = [0, Math.round(roundedMax / 2), roundedMax]

    const labels = data.length <= 10
      ? data.map((d, i) => ({ x: pts[i].x, text: formatDateLabel(d.period, range) }))
      : data.filter((_, i) => i % Math.ceil(data.length / 6) === 0 || i === data.length - 1)
          .map(d => {
            const idx = data.indexOf(d)
            return { x: pts[idx].x, text: formatDateLabel(d.period, range) }
          })

    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const area = pts.length > 0
      ? `${line} L ${pts[pts.length - 1].x} ${CHART_PADDING.top + height} L ${pts[0].x} ${CHART_PADDING.top + height} Z`
      : ''

    return { points: pts, maxY: roundedMax, yTicks: ticks, xLabels: labels, pathD: line, areaD: area }
  }, [data, range])

  const height = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4"
    >
      <div className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">
        Completion Velocity
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[200px] text-slate-500 text-sm">
          No completions in this range
        </div>
      ) : (
        <svg viewBox="0 0 500 200" className="w-full" style={{ height: CHART_HEIGHT }}>
          {yTicks.map((tick) => {
            const y = CHART_PADDING.top + height - (tick / maxY) * height
            return (
              <g key={tick}>
                <line
                  x1={CHART_PADDING.left}
                  y1={y}
                  x2={500 - CHART_PADDING.right}
                  y2={y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeDasharray="4 4"
                />
                <text x={CHART_PADDING.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="10">
                  {tick}
                </text>
              </g>
            )
          })}

          <defs>
            <linearGradient id="velocityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(245,158,11)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="rgb(245,158,11)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {areaD && <path d={areaD} fill="url(#velocityGradient)" />}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="rgb(245,158,11)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill="rgb(245,158,11)" stroke="rgba(0,0,0,0.5)" strokeWidth="1">
              <title>{`${p.label}: ${p.value}`}</title>
            </circle>
          ))}

          {xLabels.map((label, i) => (
            <text
              key={i}
              x={label.x}
              y={CHART_HEIGHT - 5}
              textAnchor="middle"
              fill="rgba(255,255,255,0.3)"
              fontSize="9"
            >
              {label.text}
            </text>
          ))}
        </svg>
      )}
    </motion.div>
  )
}

function formatDateLabel(dateStr: string, range: VelocityRange): string {
  const d = new Date(dateStr)
  if (range === '7d') return `${d.getDate()}/${d.getMonth() + 1}`
  if (range === '30d') return `${d.getDate()}/${d.getMonth() + 1}`
  return `${d.getDate()}/${d.getMonth() + 1}`
}
```

---

### Step 15: Create HeatmapGrid component

**File:** `src/components/velocity/HeatmapGrid.tsx` (NEW)

```typescript
'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'

interface HeatmapGridProps {
  data: { dayOfWeek: number; hourOfDay: number; count: number }[]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DISPLAY_HOURS = [0, 4, 8, 12, 16, 20]

function intensityColor(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) return 'rgba(255,255,255,0.03)'
  const ratio = count / maxCount
  if (ratio < 0.25) return 'rgba(245,158,11,0.15)'
  if (ratio < 0.5) return 'rgba(245,158,11,0.3)'
  if (ratio < 0.75) return 'rgba(245,158,11,0.5)'
  return 'rgba(245,158,11,0.75)'
}

export function HeatmapGrid({ data }: HeatmapGridProps) {
  const { grid, maxCount } = useMemo(() => {
    const g: Record<string, number> = {}
    let mc = 0
    for (const d of data) {
      const key = `${d.dayOfWeek}-${d.hourOfDay}`
      g[key] = (g[key] ?? 0) + d.count
      mc = Math.max(mc, g[key])
    }
    return { grid: g, maxCount: mc }
  }, [data])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4"
    >
      <div className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">
        Activity Heatmap
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[200px] text-slate-500 text-sm">
          No activity data
        </div>
      ) : (
        <div className="flex gap-1">
          <div className="flex flex-col gap-1 pr-1 pt-5">
            {DAYS.map((day) => (
              <div key={day} className="h-[22px] flex items-center text-[10px] text-slate-500 leading-none">
                {day}
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-x-auto">
            <div className="flex gap-[2px] mb-1">
              {DISPLAY_HOURS.map((h) => (
                <div
                  key={h}
                  className="text-[9px] text-slate-500 text-center"
                  style={{ width: `${100 / DISPLAY_HOURS.length}%` }}
                >
                  {h.toString().padStart(2, '0')}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              {DAYS.map((_, dayIdx) => (
                <div key={dayIdx} className="flex gap-[2px]">
                  {HOURS.map((hour) => {
                    const count = grid[`${dayIdx}-${hour}`] ?? 0
                    return (
                      <div
                        key={hour}
                        className="flex-1 h-[22px] rounded-sm transition-colors"
                        style={{ backgroundColor: intensityColor(count, maxCount) }}
                        title={`${DAYS[dayIdx]} ${hour}:00 - ${count} completions`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
```

---

### Step 16: Create ColumnFlowBar component

**File:** `src/components/velocity/ColumnFlowBar.tsx` (NEW)

```typescript
'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'

interface ColumnFlowBarProps {
  data: { column: string; avgHours: number; count: number }[]
}

const COLUMN_COLORS = [
  'rgb(168,85,247)',
  'rgb(59,130,246)',
  'rgb(6,182,212)',
  'rgb(16,185,129)',
  'rgb(245,158,11)',
  'rgb(239,68,68)',
  'rgb(236,72,153)',
  'rgb(139,92,246)',
]

function formatHours(hours: number): string {
  if (hours < 1) return '<1h'
  if (hours < 24) return `${Math.round(hours)}h`
  const days = Math.round(hours / 24 * 10) / 10
  return `${days}d`
}

export function ColumnFlowBar({ data }: ColumnFlowBarProps) {
  const totalHours = useMemo(() => data.reduce((sum, d) => sum + d.avgHours, 0), [data])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4"
    >
      <div className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">
        Avg Column Dwell Time
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-16 text-slate-500 text-sm">
          No column transition data yet
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex h-8 rounded-lg overflow-hidden gap-[2px]">
            {data.map((d, i) => {
              const pct = totalHours > 0 ? (d.avgHours / totalHours) * 100 : 0
              if (pct < 1) return null
              return (
                <div
                  key={d.column}
                  className="h-full flex items-center justify-center text-[10px] font-medium text-white/80 transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: COLUMN_COLORS[i % COLUMN_COLORS.length],
                    minWidth: pct > 5 ? undefined : '20px',
                  }}
                  title={`${d.column}: avg ${formatHours(d.avgHours)} (${d.count} transitions)`}
                >
                  {pct > 10 ? d.column : ''}
                </div>
              )
            })}
          </div>

          <div className="flex gap-3 flex-wrap">
            {data.map((d, i) => (
              <div key={d.column} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: COLUMN_COLORS[i % COLUMN_COLORS.length] }}
                />
                <span className="text-xs text-slate-300">{d.column}</span>
                <span className="text-xs text-slate-500">{formatHours(d.avgHours)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
```

---

### Step 17: Add Velocity tab to ProjectContent.tsx

**File:** `src/app/project/[id]/ProjectContent.tsx`

**Change 1 -- Add import** (after line 20, near TrophyRoom import):
```typescript
import { VelocityTab } from '@/components/velocity/VelocityTab'
```

**Change 2 -- Add Activity icon import** (line 4, add to lucide imports):

Current:
```typescript
import { LayoutGrid, Calendar, Lightbulb, ArrowLeft, RefreshCw, AlertTriangle, Filter, Link2, GitBranch, Trophy, RotateCcw, Columns3, Grid2x2, Package } from 'lucide-react'
```

New:
```typescript
import { LayoutGrid, Calendar, Lightbulb, ArrowLeft, RefreshCw, AlertTriangle, Filter, Link2, GitBranch, Trophy, RotateCcw, Columns3, Grid2x2, Package, Activity } from 'lucide-react'
```

**Change 3 -- Update activeTab type** (line 40):

Current:
```typescript
  const [activeTab, setActiveTab] = useState<'board' | 'gantt' | 'canvas' | 'trophy'>('board')
```

New:
```typescript
  const [activeTab, setActiveTab] = useState<'board' | 'gantt' | 'canvas' | 'trophy' | 'velocity'>('board')
```

**Change 4 -- Add Velocity tab button** (after the Trophy button, after line 133):

```typescript
              <button
                onClick={() => setActiveTab('velocity')}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === 'velocity'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                <Activity className="w-4 h-4" />
                Velocity
              </button>
```

**Change 5 -- Add Velocity tab content** (after the trophy tab content, after line 358):

```typescript
            {activeTab === 'velocity' && (
              <VelocityTab projectId={project.id} />
            )}
```

---

## Validation Checkpoints

### Checkpoint 1: Schema migration
- Run `npx drizzle-kit push`
- Verify `activity_events` table has `actor_id` and `actor_type` columns
- Verify existing rows have `actor_type = 'user'` and `actor_id = NULL`

### Checkpoint 2: Activity event attribution
- Create a task via UI -- event should have `actorType = 'user'` and `actorId = <session user UUID>`
- Create a task via MCP -- event should have `actorType = 'agent'` and `actorId = AEON_API_USER_ID`
- Move a task via drag -- event should have `fromColumnId` and `toColumnId` in metadata

### Checkpoint 3: Velocity data layer
- Call `getVelocityStats(projectId, '30d')` for a project with vault data
- Verify all 5 sub-queries return non-null results
- Test with empty project -- should return zeros/empty arrays, no errors

### Checkpoint 4: Velocity UI
- Navigate to project, click Velocity tab
- Verify stat cards render with real data
- Toggle time ranges (7d/30d/90d/All) -- data should update
- Verify heatmap cells show tooltips on hover
- Verify column flow bar shows proportional segments

### Checkpoint 5: MCP tool
- Call `get_velocity_stats` via MCP client with a valid project ID
- Verify response contains velocity, cycleTime, dwellTimes, heatmap, priorities

### Checkpoint 6: Regressions
- Trophy Room still loads and displays vault tasks
- Activity timeline in Trophy Room still loads
- Board task creation/movement/deletion still works
- MCP tools still function for all existing operations

---

## Testing Strategy

### Unit Tests (recommended, not blocking)
- `velocity.ts`: Test each query function with mock data
- `emitActivity`: Verify new params are correctly inserted

### Integration Points
- `emitActivity` signature change affects 4 action files + 1 MCP route -- all call sites must compile
- `activityEvents` schema change requires `db:push` before any of the code changes work at runtime
- VelocityTab depends on velocity actions which depend on velocity data layer -- deploy order matters

### Edge Cases
- Project with zero activity events (new project)
- Project with only `'user'` events (pre-migration data)
- Project with moved events that have no `fromColumnId` (pre-migration data)
- Time range that returns zero results
- Task moved within same column (fromColumnId === toColumnId)
- Very large projects (1000+ events) -- SQL aggregations should still perform well

---

## Deployment Order

1. Schema migration (`npx drizzle-kit push` or `db:push`)
2. Data layer changes (`activity.ts` signature, `velocity.ts`)
3. Action layer changes (board, dependencies, labels, vault)
4. MCP route changes
5. UI components (velocity folder)
6. ProjectContent.tsx tab addition

Steps 2-5 can be deployed atomically in one commit since the schema migration (step 1) is backwards-compatible.
