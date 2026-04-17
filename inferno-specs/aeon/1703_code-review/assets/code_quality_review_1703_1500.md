# SHADOW JUDGE REVIEW - Aeon Codebase
**Date:** 2026-03-17
**Scope:** Full architectural and code quality review
**Files reviewed:** 30+ files across actions, data, stores, components, schema, API

---

## Core Intent Assessment

Aeon is a project management app with Kanban board, Gantt chart, Canvas, and Trophy room views. The architecture follows a clean Next.js pattern: `actions -> data -> db` with Zustand stores for client state and optimistic updates. The intent is clear - the layering is deliberate and mostly well-executed.

---

## PRIORITY 1 - CRITICAL (Production Blockers)

### C1. Checklist actions bypass the shared auth pattern
**Files:** `src/lib/actions/checklist.ts:10-19, 21-40, 55-83, 85-122, 124-136`
**Issue:** Every other action file uses `requireOwnership()` from `./helpers`. The checklist actions file implements its own `verifyTaskOwnership()` and calls `auth()` directly in every function. This is a consistency violation AND a security surface area concern - any change to the auth pattern must now be updated in two places.
**Risk:** If `requireOwnership` is updated (e.g., to add rate limiting or role checks), checklist endpoints are silently left behind.

### C2. MCP API route has NO session authentication
**File:** `src/app/api/[transport]/route.ts:49-53`
**Issue:** The MCP handler uses a static `AEON_API_USER_ID` env variable. There is zero session validation, no API key check, no request signing. Anyone who can reach this endpoint can perform full CRUD on that user's data.
```typescript
const userId = () => {
  const id = process.env.AEON_API_USER_ID
  if (!id) throw new Error('AEON_API_USER_ID not configured')
  return id
}
```
**Risk:** If this route is exposed in production without network-level protection, it is a complete data compromise.

### C3. Zod validation not applied in server actions
**Files:** All `src/lib/actions/*.ts`
**Issue:** Validators exist in `src/lib/data/validators.ts` with proper Zod schemas. But the action layer accepts raw typed objects and passes them through without validation. The data layer functions accept pre-typed inputs (e.g., `CreateTaskInput`) but the actions cast with `as` instead of parsing:
```typescript
// src/lib/actions/board.ts:107
status: data.status as 'todo' | 'in-progress' | 'done' | undefined,
priority: data.priority as 'low' | 'medium' | 'high' | 'urgent' | undefined,
```
**Risk:** Any malicious or malformed client input passes through unchecked to the database. The validators exist but are decorative.

### C4. `wouldCreateCycle` loads ALL dependencies globally
**File:** `src/lib/data/dependencies.ts:55-87`
**Issue:** The cycle detection function fetches every dependency row across ALL projects, not scoped to the current project. As the database grows, this becomes a full table scan for every dependency addition.
```typescript
const allDeps = await db
  .select({...})
  .from(taskDependencies)
  // No WHERE clause - loads all deps across all users/projects
```
**Risk:** Performance degradation at scale, plus information leakage (dependencies from other projects inform cycle detection).

---

## PRIORITY 2 - HIGH (Significant Quality Issues)

### H1. Duplicate default column creation in two places
**Files:** `src/lib/data/projects.ts:41-46` and `src/lib/data/columns.ts:114-132`
**Issue:** `createProject()` inserts hardcoded default columns. `createDefaultColumns()` also inserts default columns. `loadBoardData()` in `src/lib/actions/board.ts:31` calls `_createDefaultColumns()` on every board load. Two separate default column definitions exist that could diverge.

### H2. `reflowGanttView` in actions does raw DB operations
**File:** `src/lib/actions/ganttViews.ts:99-189`
**Issue:** The `reflowGanttView` function directly imports `db`, schema tables, and performs complex multi-table queries inside an action file. This completely bypasses the data layer, violating the `actions -> data -> db` architecture.
```typescript
// Line 172-175: Direct db.update inside an action
await db
  .update(ganttTasks)
  .set({ startDate: newStart, endDate: newEnd, updatedAt: new Date() })
  .where(eq(ganttTasks.id, task.id))
```
Also `resetGanttData` (lines 191-215) does the same.

### H3. `reorderTasks` fires N parallel unrelated UPDATE queries
**File:** `src/lib/data/tasks.ts:150-168`
**Issue:** `Promise.all` with individual UPDATE queries per task. No transaction, no batching. With 50 tasks in a column, that's 50 parallel DB calls. Same pattern in `reorderColumns` (`src/lib/data/columns.ts:100-112`) and `archiveTasksBatch` (`src/lib/data/tasks.ts:197-209`).
**Risk:** Race conditions, connection pool exhaustion under load.

### H4. `findArchivedTasks` uses dynamic import inside function
**File:** `src/lib/data/tasks.ts:171`
```typescript
const { isNotNull } = await import('drizzle-orm')
```
**Issue:** This is a regular top-level export from drizzle-orm. Dynamic import here serves no purpose and adds overhead on every call.

### H5. Board store persists full task/label/dependency arrays to localStorage
**File:** `src/lib/store/boardStore.ts:172-176`
```typescript
partialize: (s) => ({ tasks: s.tasks, labels: s.labels, dependencies: s.dependencies, columns: s.columns }),
```
**Issue:** On projects with hundreds of tasks, this writes a massive JSON blob to localStorage on every state change. localStorage has a ~5MB limit per origin. This will silently fail when the data exceeds the limit.

### H6. Data layer functions inconsistently scope by projectId
**Files:** `src/lib/data/labels.ts:67-72`, `src/lib/data/dependencies.ts:16-21`
**Issue:** `addLabelToTask` and `addDependency` accept task/label IDs but do NOT verify they belong to the same project. The action layer passes ownership-checked projectId but the data function ignores it:
```typescript
// labels.ts:67 - No projectId check
export async function addLabelToTask(taskId: string, labelId: string) {
  await db.insert(taskLabels).values({ taskId, labelId }).onConflictDoNothing()
}
```
A caller could add a label from project A to a task in project B.

---

## PRIORITY 3 - MEDIUM (Maintainability & Design Issues)

### M1. ProjectContent.tsx is 877 lines - a god component
**File:** `src/app/project/[id]/ProjectContent.tsx`
**Issue:** This file defines ~30 useCallback handlers, 3 useEffect hooks, and manages all tab state, modals, and cross-feature coordination. It is the single largest file and has outgrown its responsibilities.
**Suggestion:** Extract handlers into custom hooks per domain: `useBoardHandlers`, `useGanttHandlers`, `useCanvasHandlers`.

### M2. TaskBoard prop interface has 28 optional callback props
**File:** `src/components/board/TaskBoard.tsx:42-70`
**Issue:** 28 props, almost all optional callbacks. This indicates the component is doing too much orchestration. The prop drilling continues from TaskBoard -> KanbanColumn -> SortableTaskCard with many props passed through unchanged.

### M3. Store types duplicate schema types
**Files:** `src/lib/store/boardStore.ts:5-50` vs `src/lib/db/schema.ts:102-121`
**Issue:** BoardTask, Label, Dependency interfaces in the store manually mirror the schema types with minor differences (e.g., `labels: string[]` added). No shared type derivation. Changes to schema require manual sync.

### M4. Inconsistent error handling - fire-and-forget patterns
**Files:** Throughout `src/lib/actions/board.ts` and `src/app/project/[id]/ProjectContent.tsx`
**Issue:** Activity logging uses `.catch(() => {})` everywhere (intentional fire-and-forget, acceptable). But the same `.catch((err) => console.error(...))` pattern is used for critical operations in ProjectContent:
```typescript
// ProjectContent.tsx:237
createBoardTask(task).catch((err) => console.error('Failed to create task:', err))
```
Failed task creates are silently swallowed at the UI level with only a console.error. No toast, no rollback, no retry. The optimistic update stays in the store even when the server rejects it.

### M5. `bulkPushAllTasksToGantt` updates board tasks one-by-one
**File:** `src/lib/data/bridge.ts:500-509`
```typescript
for (const task of allTasks) {
  const ganttId = ganttByBoardId.get(task.id)
  if (ganttId) {
    await db.update(boardTasks).set({...}).where(eq(boardTasks.id, task.id))
  }
}
```
**Issue:** Sequential individual updates inside a non-transactional loop. Could be a single `CASE WHEN` update or at minimum wrapped in a transaction.

### M6. `findTaskWithDetails` uses dynamic imports to avoid circular dependencies
**File:** `src/lib/data/checklist.ts:113-119`
```typescript
const { findTaskLabels } = await import('./labels')
const { findDependencies } = await import('./dependencies')
```
**Issue:** Dynamic imports as a workaround for circular module dependencies is a code smell. The real fix is to restructure the data layer or create a dedicated query file for composite reads.

### M7. themeStore persists too much state and has fragile merge logic
**File:** `src/stores/themeStore.ts:225-238`
**Issue:** The `merge` function manually handles each new field with fallback logic. Every time a new persisted field is added, the merge function must be updated or old users get `undefined` values. This is a ticking maintenance bomb.

---

## PRIORITY 4 - LOW (Polish Items)

### L1. `projectTasks` filtering recreated every render without useMemo
**File:** `src/components/board/TaskBoard.tsx:179`
```typescript
const projectTasks = tasks.filter((t) => t.projectId === projectId)
```
Not memoized, runs on every render. `filteredTasks` on line 180 depends on it via useMemo, but the input array reference changes every time.

### L2. `any` type escape hatch in TaskBoard
**File:** `src/components/board/TaskBoard.tsx:120`
```typescript
const [activeItem, setActiveItem] = useState<{ type: 'task' | 'column'; data: any } | null>(null)
```

### L3. Polling interval hardcoded without config
**File:** `src/app/project/[id]/ProjectContent.tsx:214`
```typescript
const POLL_INTERVAL = 30_000
```
Not configurable. No exponential backoff. Polls even when user is active and making changes.

### L4. Schema missing indexes on commonly filtered columns
**File:** `src/lib/db/schema.ts`
**Issue:** No explicit indexes defined on `boardTasks.projectId`, `boardTasks.columnId`, `boardTasks.status`, `ganttTasks.projectId`, `ganttTasks.rowId`, etc. Drizzle requires explicit index definitions. All queries filter by these columns. Without indexes, every query is a sequential scan as data grows.

### L5. `createBoardTask` in actions accepts client-generated ID
**File:** `src/lib/actions/board.ts:43-76`
**Issue:** The action accepts `id` from the client and passes it directly as the database primary key. A malicious client could provide a known UUID to overwrite another task (mitigated by `projectId` checks, but still unusual).

---

## Standards Compliance Summary

| Standard | Status | Notes |
|----------|--------|-------|
| Layering (actions->data->db) | MOSTLY PASS | `reflowGanttView` and `resetGanttData` violate it; `checklist.ts` actions bypass shared helpers |
| Auth guard consistency | FAIL | Checklist uses own auth, MCP has no session auth |
| Input validation | FAIL | Zod schemas exist but are not enforced in the action layer |
| Error handling | PARTIAL | Fire-and-forget logging is fine, but optimistic updates have no rollback |
| Store design | PARTIAL | Clean patterns but localStorage persistence of full data is risky |
| Component design | NEEDS WORK | ProjectContent is a god component, TaskBoard has 28 props |
| Type safety | MOSTLY PASS | One `any` escape, some `as` casting bypasses validation |
| Database design | NEEDS INDEXES | Schema clean but missing performance-critical indexes |

---

## Strategic Recommendations

1. **Immediate:** Add Zod `.parse()` calls at the action layer boundary. This is the single highest-impact security improvement.
2. **Immediate:** Scope `wouldCreateCycle` to the current project's dependencies only.
3. **Short-term:** Unify checklist actions to use `requireOwnership` from helpers.
4. **Short-term:** Move `reflowGanttView` and `resetGanttData` DB logic to the data layer.
5. **Medium-term:** Extract ProjectContent handlers into domain-specific custom hooks.
6. **Medium-term:** Add database indexes for all foreign key and filter columns.
7. **Medium-term:** Replace localStorage persistence with a bounded cache (e.g., only persist UI preferences, not full task data).
8. **Before production:** Decide on MCP API auth strategy - either add proper API key auth or ensure it is network-isolated.
