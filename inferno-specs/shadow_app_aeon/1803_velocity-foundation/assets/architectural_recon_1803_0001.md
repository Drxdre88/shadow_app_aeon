# Architectural Recon — Velocity Foundation
Date: 18-03-2026
Type: architectural_archaeology + dependency_investigation

---

## Executive Summary

Full structural recon of Aeon codebase for the "Velocity Foundation" feature planning. Five major systems mapped: activity events, task state machine, vault, MCP server, and the dashboard + project navigation. Zero existing velocity/throughput analytics UI found — the Trophy Room is the only stats surface, and it only covers vault (completed tasks) stats plus a raw activity timeline.

---

## 1. Activity Events System

### File: `src/lib/data/activity.ts`

Core emitter. Thin insert function — no actor/userId, no session tracking. Schema:

```ts
export type ActivityEntityType = 'task' | 'column' | 'dependency' | 'label' | 'gantt_task' | 'canvas_node' | 'project'
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'moved' | 'completed' | 'vaulted' | 'archived' | 'restored' | 'dependency_added' | 'dependency_removed' | 'label_added' | 'label_removed'

emitActivity(projectId, entityType, entityId, action, entityName?, metadata?)
```

### DB Schema: `activityEvents` table

```ts
activityEvents = pgTable('activity_events', {
  id: uuid PK,
  projectId: uuid FK -> projects,
  entityType: varchar(30),
  entityId: uuid,
  action: varchar(30),
  entityName: varchar(255),       // nullable
  metadata: jsonb default {},
  createdAt: timestamp defaultNow
})
```

**CRITICAL GAP**: No `userId`/`actorId` column. The table has NO way to distinguish who (human vs MCP agent) performed the action. The MCP server calls raw data layer functions (`createTask`, `updateTask`) without going through board action layer — so MCP operations emit ZERO activity events currently.

### Query API: `src/lib/actions/activity.ts`

`getActivityFeed(projectId, { limit, cursor, entityType, entityId })` — cursor-based pagination by `createdAt`, max 200 per call.

### ALL emitActivity call sites (complete inventory):

| File | Action | Event |
|------|--------|-------|
| `actions/board.ts:72` | `createBoardTask` | task created |
| `actions/board.ts:102` | `updateBoardTask` (status=done) | task completed |
| `actions/board.ts:104` | `updateBoardTask` (columnId set) | task moved |
| `actions/board.ts:106` | `updateBoardTask` (other) | task updated |
| `actions/board.ts:120` | `deleteBoardTask` | task deleted |
| `actions/board.ts:135` | `reorderBoardTasks` (move with columnId) | task moved |
| `actions/board.ts:139` | `reorderBoardTasks` (status=done via drag) | task completed, via: 'drag' |
| `actions/board.ts:149` | `archiveBoardTask` | task archived |
| `actions/board.ts:159` | `restoreBoardTask` | task restored |
| `actions/board.ts:176` | `archiveColumnTasks` (batch) | task archived (per task) |
| `actions/vault.ts:36` | `sendToVault` | task vaulted |
| `actions/vault.ts:55` | `sendBatchToVault` (per entry) | task vaulted |
| `actions/vault.ts:66` | `restoreVaultTask` | task restored |
| `actions/dependencies.ts:29` | `addTaskDependency` | dependency dependency_added |
| `actions/dependencies.ts:43` | `removeTaskDependency` | dependency dependency_removed |
| `actions/labels.ts:52` | `addLabelToTask` | label label_added |
| `actions/labels.ts:59` | `removeLabelFromTask` | label label_removed |

**Metadata patterns in use:**
- `moved`: `{ toColumnId }` — note: no `fromColumnId` captured
- `completed via drag`: `{ via: 'drag' }`
- `dependency_added/removed`: `{ blockerTaskId, blockedTaskId }`
- `label_added/removed`: `{ labelId, taskId }`

---

## 2. Task State Machine

### Statuses (enum): `'todo' | 'in-progress' | 'done'`
### Priorities (enum): `'low' | 'medium' | 'high' | 'urgent'`

### boardTasks schema (key fields):
```ts
boardTasks = {
  id, projectId, columnId (FK->boardColumns, set null on delete),
  ganttTaskId (FK->ganttTasks, set null),
  name, description,
  status: varchar(20) default 'todo',
  priority: varchar(20) default 'medium',
  color, startDate, endDate,
  onTimeline: bool default false,
  size: real,                    // story points / T-shirt size (0.5-20, step 0.5)
  orderIndex: int,
  metadata: jsonb,
  createdAt, updatedAt,
  archivedAt: timestamp          // soft delete — null = active
}
```

### State transitions:

1. **Column move (drag-and-drop)**: `reorderBoardTasks` called with `{ id, orderIndex, status?, columnId? }` array. Updates both column assignment and orderIndex atomically in a transaction. Emits `moved` (when columnId changes) and `completed` (when status becomes 'done' via drag).

2. **Status update (direct)**: `updateBoardTask` with `status` field. If status = 'done', emits `completed`. If columnId also changes, emits `moved`. Otherwise emits `updated`.

3. **Archive**: `archiveBoardTask` sets `archivedAt = now()`. Task stays in `boardTasks` table but filtered from `findTasks` (which uses `isNull(archivedAt)`). Emits `archived`.

4. **Vault (permanent completion)**: `vaultTask` — takes snapshot of labels+checklist+column, inserts into `taskVault`, then DELETES from `boardTasks`. Hard delete. The only way to undo is `restoreFromVault` which re-inserts into `boardTasks` with status='todo', no columnId, no dates.

5. **Restore from archive**: `restoreTask` sets `archivedAt = null`.

### Column move path (full chain):
```
UI drag -> useBoardDnD -> board.handleTaskMove -> reorderBoardTasks (Server Action) -> _reorderTasks (DB) + emitActivity(moved/completed)
```

---

## 3. Task Vault

### File: `src/lib/data/vault.ts`

**Vault is a graveyard of completed work, not a soft archive.** It's a permanent record with rich snapshot data:

```ts
taskVault = {
  id, projectId,
  originalTaskId: uuid (nullable — not FK, allows original to be deleted),
  name, description,
  priority, color,
  columnName: varchar(255),         // snapshot of column name at vault time
  size: real,
  daysTaken: int,                   // manually entered by user
  labelSnapshot: jsonb [],          // [{ name, color }] — full label data
  checklistSnapshot: jsonb {},      // { total, checked } — summary counts
  metadata: jsonb,
  archivedAt: timestamp defaultNow,
  originalCreatedAt: timestamp      // preserved from boardTasks.createdAt
}
```

**snapshotTaskData()**: Joins labels, checklist items, and column name before deleting the source task. Preserves enough for Trophy Room display.

**getVaultStats()**: Single SQL query computing:
- `total` count
- `avgDays` (avg of `daysTaken`)
- `lowCount`, `mediumCount`, `highCount`, `urgentCount` (priority breakdown)
- `thisWeek` (archivedAt > now - 7 days)

**Restore from vault**: Re-inserts into `boardTasks` with `status='todo'`, `onTimeline=false`, `orderIndex=max+1`. No column assignment, no dates, no checklist restoration. Only name/description/priority/color/metadata survive.

---

## 4. MCP Server

### File: `src/app/api/[transport]/route.ts`

Built with `mcp-handler` library. Transport route handles both GET and POST (supports SSE and HTTP transports for MCP protocol).

### Authentication:
- **Bearer token** (env: `AEON_API_KEY`) resolves to hardcoded `AEON_API_USER_ID` — single machine user identity for all API operations
- **Session cookie** falls through to NextAuth session user

**CRITICAL GAP**: MCP server calls the raw `data/` layer directly (NOT `actions/` layer). This means:
- No `emitActivity` calls on ANY MCP operation
- No actor tracking (all operations attributed to `AEON_API_USER_ID` but this isn't logged anywhere)
- The `requireOwnership` in the MCP handler is a LOCAL function that just checks `verifyProjectOwnership(projectId, userId())` — bypasses the `actions/helpers.ts` version which uses session

### Exposed MCP tools (complete list):
```
list_projects, get_project, create_project, update_project, delete_project
list_columns, create_column, update_column, delete_column, reorder_columns
list_tasks, create_task, update_task, delete_task, batch_create_tasks
list_gantt_tasks, create_gantt_task, update_gantt_task
project_summary
list_dependencies, add_dependency, remove_dependency, batch_add_dependencies
list_labels, create_label, delete_label, add_label_to_task, remove_label_from_task, set_task_labels
get_task_detail
create_checklist_item, batch_create_checklist_items, update_checklist_item, delete_checklist_item
setup_board
```

**No vault tools exposed via MCP.** No `send_to_vault`, no `restore_from_vault`, no `get_vault_stats`.

**`project_summary` tool**: Calls `getProjectSummary()` which returns task counts by status, overdue tasks, progress %, gantt task count + avg progress. This is the only analytics-like tool in MCP.

---

## 5. Dashboard Structure

### Dashboard (`/dashboard`)
File: `src/app/dashboard/DashboardContent.tsx`

Single-page layout. No tabs. Content:
- Header: logo, admin badge, settings button, user avatar, sign out
- Action cards row: "New Project", "View Demo", project count badge
- Project list: cards in a `flex-wrap` grid, each links to `/project/[id]`
- No analytics, no cross-project stats, no velocity data

### Project Page (`/project/[id]`)
File: `src/app/project/[id]/ProjectContent.tsx`

4-tab navigation in header:
- **Board** (`LayoutGrid` icon) — Kanban board, default view
- **Gantt** (`Calendar` icon) — Gantt chart
- **Canvas** (`Lightbulb` icon) — freeform canvas (dynamically imported)
- **Trophy** (`Trophy` icon) — vault display + activity timeline

Board toolbar: Archive, Filter, Deps toggle, Connect mode, Layout toggle (scroll/grid)
Gantt toolbar: View selector, TimeScale, Reflow, Reset

**Trophy tab** is the ONLY analytics surface. It contains:
- `TrophyStats`: 4 stat cards (total vaulted, this week, by priority breakdown, avg days to complete)
- `TrophyTimeline`: cursor-paginated activity feed (all event types, not just completions)
- `TrophyCard` grid: browsable vault with sort (newest/oldest/priority/name) and priority filter
- Restore button on each card

---

## 6. Existing Analytics Inventory

| Surface | Location | Data Source | What It Shows |
|---------|----------|-------------|---------------|
| Trophy Stats | `/project/[id]` -> Trophy tab | `getVaultStats()` | Total vaulted, this week, by priority, avg days |
| Activity Timeline | `/project/[id]` -> Trophy tab | `getActivityFeed()` | All events, paginated, relative timestamps |
| project_summary (MCP) | MCP tool | `getProjectSummary()` | Task counts by status, overdue list, gantt avg progress |

**No velocity chart. No throughput graph. No burndown. No cycle time distribution. No column transition timing. Nothing cross-project.**

---

## Hidden Dependencies and Gaps

### Gap 1: No actor on activity events
`activityEvents` has no `userId`/`actorId`. Cannot distinguish human from agent actions. Adding this requires a DB migration (add column) + updating all `emitActivity` call sites to pass actor context.

### Gap 2: MCP emits no activity
All MCP operations (create_task, update_task, etc.) go through raw `data/` functions. No activity events emitted. Velocity tracking via activity log would miss all agent-driven work unless MCP is updated to call action layer or emit activity directly.

### Gap 3: `moved` event has no `fromColumnId`
`reorderBoardTasks` emits `{ toColumnId }` but does NOT capture `fromColumnId`. Column transition analysis (cycle time per stage) cannot be derived from current event data without also querying the task's previous state.

### Gap 4: `daysTaken` is manual user input
Vault `daysTaken` is not computed from timestamps — the user types it in `VaultDaysModal`. It represents human judgment of effort, not actual elapsed calendar time. Actual elapsed time CAN be computed from `originalCreatedAt` to `archivedAt` on the vault record.

### Gap 5: `reorderBoardTasks` emits DUPLICATE events
When a drag moves a task to a 'done' status AND changes columnId, both `moved` and `completed` events are emitted (lines 135 + 139 in board.ts). Velocity calculations must deduplicate or be aware of this.

### Gap 6: Archive != Vault
Two separate completion pathways exist:
- **Archive**: Soft delete (archivedAt set), task stays in boardTasks, no snapshot, emits `archived`
- **Vault**: Hard delete with full snapshot, emits `vaulted`
"Done" tasks can go through archive OR vault OR just stay as status=done. Velocity needs to handle all three.

---

## Structural Observations

### Data layer pattern:
```
src/lib/data/     — pure DB queries (no auth, no activity emission)
src/lib/actions/  — 'use server' wrappers (auth check, activity emission, cache revalidation)
src/app/api/      — REST/MCP routes (calls data layer directly for MCP, or wraps with auth)
```

### State management:
- `boardStore` (Zustand + persist) is the client-side truth for board state
- Server actions are fire-and-forget from client handlers (`.catch()` only)
- No optimistic rollback — if server action fails, client state is already mutated
- Store is persisted to localStorage (`aeon-board` key), partializing to tasks/labels/dependencies/columns

### DnD architecture:
```
useBoardDnD (component) -> board.handleTaskMove (ProjectContent) -> reorderBoardTasks (action) -> _reorderTasks (data)
```
Board store is updated optimistically in `useBoardDnD` BEFORE the server action resolves.

---

## Strategic Intelligence for Velocity Foundation

### What can be built without DB migrations:
1. **Vault-based velocity chart**: Use `taskVault.archivedAt` (actual date), `originalCreatedAt`, `daysTaken`, and `priority` — all present. Can compute weekly/monthly throughput, avg cycle time, priority breakdown over time.
2. **Activity-based event feed**: `activityEvents` table has enough data for a timeline and completion rate trends (filtering by action='completed' or 'vaulted').
3. **MCP project_summary analytics**: Already computes status counts and overdue tasks. Easily extended.

### What requires DB migrations:
1. **Actor attribution**: Add `actorId varchar(30)` (or `actorType`) to `activityEvents`. Distinguish 'user' vs 'mcp_agent'.
2. **Column transition timing**: Add `fromColumnId` to moved events (or a separate `column_history` table).
3. **Computed cycle time**: Store calculated `cycleDays` on vault (computed from timestamps, not manual entry).

### Best insertion points for Velocity Foundation:
- **New tab in ProjectContent**: Add alongside Board/Gantt/Canvas/Trophy — minimal disruption
- **New data functions in `src/lib/data/`**: Follow existing pattern (pure queries)
- **New server action file `src/lib/actions/velocity.ts`**: Follow `'use server'` + `requireOwnership` pattern
- **MCP tool**: Add `get_velocity_stats` tool to `[transport]/route.ts` — follows established tool pattern

---

## Reconnaissance Warnings

1. **boardStore persists to localStorage**: If schema of persisted state changes, old cached data may cause hydration issues. Any new task fields need to be backward-compatible.
2. **emitActivity is fire-and-forget**: All call sites use `.catch(() => {})`. Activity data is best-effort — gaps are possible under load.
3. **No transaction on activity emission**: Activity insert is NOT part of the task update transaction. If the task update succeeds but activity insert fails, the event is silently lost.
4. **Duplicate events on drag-to-done**: `reorderBoardTasks` can emit both `moved` and `completed` for the same operation. Aggregation queries must handle this.
5. **MCP bypass of action layer**: Any velocity feature relying on `activityEvents` will show zero agent activity unless MCP routes are updated.
