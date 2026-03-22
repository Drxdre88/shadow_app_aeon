# SHADOW PROWLER RECONNAISSANCE
# Target: shadow_app_aeon — Stale UI / Mutation-to-State Sync Bugs
# Date: 22/03 10:45

---

## Mission Objective

Map the full data flow for every mutation (create/delete/update task, delete checklist item)
from UI trigger to API call to UI state update. Identify why:
1. Cards added via QuickAddTask disappear from UI after add
2. Delete operations (card bin icon, checklist X) feel sluggish
3. Changes on Device A do not propagate to Device B without F5

---

## Structural Intelligence

### Class Architecture

The app uses a three-tier state model:

```
DB (Drizzle/SQLite or Postgres)
  └── Server Actions ('use server' — board.ts, checklist.ts, etc.)
        └── Zustand Store (boardStore.ts — in-memory, persisted to localStorage)
              └── React components (read state, dispatch mutations)
```

No React Query, no SWR, no Apollo, no tRPC client.
Data fetching is entirely through Next.js Server Actions and a manual polling loop.

### Component Relationships

```
ProjectContent.tsx
  useProjectData(projectId, activeTab)   <-- loads board, gates polling
  useBoardHandlers(projectId)            <-- wraps all CRUD server actions
  useLabelHandlers / useDependencyHandlers / useGanttHandlers / useCanvasHandlers

  TaskBoard.tsx                          <-- orchestration layer, passes callbacks down
    KanbanColumn.tsx (per column)
      SortableTaskCard.tsx (per card)    <-- Trash2 icon, context menu, tri-state toggle
      QuickAddTask.tsx                   <-- inline add form at column bottom
    TaskEditModal.tsx                    <-- edit/add modal, checklist sub-component
      TaskChecklist.tsx                  <-- UI-only; callbacks wired in TaskEditModal
```

### Data Flow Patterns

**Board load (initial + polling):**
```
useProjectData.useEffect([projectId, loadKey])
  -> loadBoardData(projectId)             [Server Action]
     -> DB: findTasks, findColumns, findLabels, findTaskLabels, findDependencies, findChecklistSummaries
  -> useBoardStore.setState({ columns, tasks, labels, dependencies, checklistSummaries, isDirty: false })
  -> React re-renders from Zustand subscriptions
```

**Polling loop:**
```
useProjectData.useEffect([])   (runs once, no deps — never re-registers)
  setInterval(30_000ms)
    if (visibilityState === 'visible' && !boardStore.isDirty)
      setLoadKey(k + 1)     <- triggers board load effect
```

---

## Design Pattern Detection

### Optimistic-first, fire-and-forget mutations

Every mutation follows the same pattern:
1. Write to Zustand store immediately (optimistic)
2. Call Server Action asynchronously (`.catch(() => {})` — errors silently swallowed)
3. Server Action calls `revalidatePath(...)` — invalidates Next.js RSC cache
4. No callback from the Server Action back to the client to confirm success or return the new DB row

**QuickAddTask.handleSubmit:**
```
addTask(newTask)           <- Zustand addTask (isDirty = true)
onTaskCreate?.(newTask)    <- useBoardHandlers.handleTaskCreate
  createBoardTask(task)    <- Server Action (fire and forget)
    _createTask(...)       <- DB insert
    revalidatePath(...)    <- RSC cache bust
```

**SortableTaskCard bin icon:**
```
onTaskDelete?.(task.id)    <- prop callback (NOT removeTask at this point)
  useBoardHandlers.handleTaskDelete(taskId)
    deleteBoardTask(...)   <- Server Action ONLY — no Zustand removeTask called here
      revalidatePath(...)
```

**TaskContextMenu.handleDelete:**
```
removeTask(taskId)         <- Zustand removeTask (isDirty = true) FIRST
onTaskDelete?.(taskId)     <- handleTaskDelete -> deleteBoardTask (Server Action)
```

**TaskEditModal delete button:**
```
onTaskDelete(editingTaskId) -> handleTaskDelete -> deleteBoardTask (Server Action)
onClose()
```
No `removeTask` call here — the task stays in Zustand until the next poll.

**Checklist delete (handleChecklistRemove in TaskEditModal):**
```
setChecklistItems(prev => filter)    <- local React state only, no Zustand
deleteChecklistItem(...)             <- Server Action (fire and forget)
  revalidatePath(...)
```
The `checklistSummaries` in Zustand is NOT updated. The board card summary counter
(checked/total) is stale until the next full poll.

---

## Historical Context

The `isDirty` flag was introduced as a polling guard — the intent was to prevent
a background refresh from overwriting in-flight local changes. The side effect is
that `isDirty: true` blocks ALL background polls for the lifetime of the "dirty" window.
`isDirty` is only reset to `false` when `setTasks` is called (i.e., a full reload happens).
There is no timeout or staleness expiry on `isDirty`.

The `isInitialLoad` ref controls whether the loading spinner shows on re-poll.
On re-poll (loadKey increment), `isInitialLoad.current` is already `false`,
so the UI does not flash a spinner — but it also means the `setIsLoading(true)` guard
is only set on first load. The `finally` block always sets `isLoading: false`
regardless of which load it is.

---

## Hidden Dependencies

### The isDirty polling block — the root of Bug #3

When any mutation fires (addTask, removeTask, updateTask, moveTask, addLabel, etc.),
`isDirty` is set to `true` in Zustand. The polling loop checks `isDirty` before
triggering a reload. `isDirty` is only reset to `false` inside `setTasks`, which
is only called when a full `loadBoardData` response lands.

**Consequence:** After any local mutation, the 30-second background poll is silently
skipped forever until the next manual reload or F5. On a second device that made
no local mutations, the poll fires every 30s — but the originating device (the
one that added or deleted a task) never polls again because its `isDirty` flag
was never cleared.

### The QuickAddTask disappear — Bug #1

`QuickAddTask` calls `addTask(newTask)` (Zustand, sets `isDirty: true`), then
`onTaskCreate?.(newTask)` which calls `handleTaskCreate -> createBoardTask`.

`createBoardTask` is a Server Action that calls `revalidatePath(...)`.
In Next.js App Router, `revalidatePath` invalidates the RSC cache for that path.
If the project page is a Server Component that re-fetches on revalidation, the page
will re-render with fresh DB data — which does NOT include the optimistically-added
task (it was inserted asynchronously and may not have landed yet at the exact moment
RSC re-renders, OR the RSC data is passed down as props and the client component
re-initializes Zustand from those props, overwriting the optimistic task).

**More specifically:** If `useProjectData` is triggered by RSC re-render (Next.js
router cache refresh), it calls `loadBoardData` which calls `setTasks` with the
DB snapshot. If the DB insert has not yet committed at the exact moment of that
re-render, the optimistically-added task gets erased from Zustand.

However: looking at `useProjectData` — it does NOT listen to router events or RSC
re-renders. The loadKey is internal. So the disappearance is more likely caused by
the `persist` middleware rehydrating from localStorage on the second device or
browser tab — where the task was never written (localStorage is per-browser).

**More likely cause for phone specifically:** The `persist` middleware in Zustand
with key `'aeon-board'` persists `{ tasks, labels, dependencies, columns }` to
`localStorage`. When the page loads on a phone (fresh session), `useProjectData`
fires `loadBoardData` and calls `useBoardStore.setState({ columns: [], labels: [],
dependencies: [] })` at the start — but NOT `tasks: []`. The tasks key is
intentionally NOT cleared on initial load (only columns/labels/deps are cleared).
Then the `persist` rehydration may race with or overwrite the DB load.

**CRITICAL RACE:** In `useProjectData`, the initial cleanup only runs:
```js
if (isInitialLoad.current) {
  useBoardStore.setState({ columns: [], labels: [], dependencies: [] })
  // tasks are NOT cleared here
}
```
Then `loadBoardData` resolves and writes the full tasks array. BUT: if the phone
had a stale localStorage with old tasks, those old tasks are in Zustand during
the loading gap. After the DB response lands and `setTasks` is called, it resets
`isDirty: false`. This is fine for the initial load.

The actual QuickAddTask phone bug is almost certainly this sequence:
1. Phone adds task -> `addTask(newTask)` -> Zustand (task appears)
2. `isDirty: true` is set
3. `createBoardTask` fires asynchronously
4. Phone browser tab goes to background (mobile browser suspends JS)
5. User comes back, page may soft-reload / remount
6. `useProjectData` fires fresh `loadBoardData`
7. DB returns tasks (may or may not include the newly-created one depending on timing)
8. `setTasks(dbTasks)` overwrites the optimistic task if DB hadn't committed yet,
   OR the `persist` rehydration fires after `setTasks` and restores old state

Alternatively: the `persist` middleware's `partialize` saves the tasks array to
localStorage after `addTask`. When the page remounts (e.g., tab becomes active again),
Zustand rehydrates from localStorage FIRST, then `useProjectData` fires `loadBoardData`,
and if the DB row is now there, it appears. But if the network is slow and the Server
Action failed silently (`.catch(() => {})`), the task exists only in localStorage —
and the next full DB reload wipes it.

### The delete slug — Bug #2

**SortableTaskCard bin icon path:**
```
onClick -> onTaskDelete?.(task.id)
  -> useBoardHandlers.handleTaskDelete(taskId)
     -> deleteBoardTask(taskId, projectId)   <- Server Action
        -> requireOwnership(projectId)       <- session auth check (DB hit)
        -> findTaskById(taskId, projectId)   <- DB hit #1
        -> emitActivity(...)                 <- DB hit #2
        -> deleteLinkedGanttTask(taskId)     <- DB hit #3
        -> _deleteTask(taskId, projectId)    <- DB hit #4
        -> revalidatePath(...)
```

NO `removeTask` is called before the Server Action. The card remains visible
in Zustand/DOM until the Server Action completes AND the next poll fires
(which may be blocked by `isDirty` anyway). The user sees the card stay put
for the full round-trip time (multiple DB hits + network latency).

**Contrast with TaskContextMenu.handleDelete:**
```
removeTask(taskId)         <- instant Zustand update (card disappears immediately)
onTaskDelete?.(taskId)     <- then fires Server Action
```
Context menu deletes are instantaneous. Bin icon deletes are laggy.
This inconsistency is a clear oversight.

**Checklist item delete:**
```
setChecklistItems(prev => filter)  <- local React state (item disappears from modal)
deleteChecklistItem(...)           <- Server Action
  findTaskById(...)                <- DB hit
  _deleteChecklistItem(...)        <- DB hit
  revalidatePath(...)
```
The item visually disappears immediately from the modal (correct optimistic update).
However `checklistSummaries` in the board store is NOT updated. So the card's
`checked/crossed/total` badge on the board card remains stale. The user sees the
wrong checklist count until the next full poll.

---

## Architectural Insights

### Why this design was chosen

The architecture uses Next.js Server Actions as the persistence layer, with Zustand
as the client-side state. The intent was "optimistic UI" — write locally, flush to DB
in the background. The `revalidatePath` calls are there to bust the RSC cache so that
if a full page reload happens, the fresh data is served.

The 30-second polling loop is the cross-device sync mechanism — there is no WebSocket,
no SSE, no Pusher, no Supabase Realtime. The system is "eventual consistency via polling."

The `isDirty` flag was meant to prevent the poll from stomping on in-flight user changes.
But it never clears itself after mutations settle — creating a permanent poll block.

### The revalidatePath fallacy

`revalidatePath` in Next.js App Router invalidates the RSC cache. For a full Server
Component page re-render, this works. But `useProjectData` does NOT observe the RSC
cache — it calls `loadBoardData` directly as a Server Action, which is a separate
fetch. The `revalidatePath` call in board.ts is essentially a no-op for the client
Zustand state — it only matters if the user hard-refreshes or navigates away and back.

---

## Reconnaissance Warnings

1. **Silent error swallowing**: Every handler uses `.catch((err) => console.error(...))`.
   If a Server Action fails (network error, auth timeout), the optimistic state is
   never rolled back. The task appears in the UI but doesn't exist in DB.

2. **isDirty never resets**: After any mutation, the polling guard is permanently
   engaged on that device until the next full reload. On a long session with many
   edits, the 30-second cross-device sync is permanently disabled.

3. **persist + loadBoardData race**: Zustand `persist` rehydrates from localStorage
   synchronously on mount. `loadBoardData` is async. There is a window where stale
   localStorage data is the source of truth, rendering incorrect state.

4. **handleTaskDelete missing removeTask**: The bin icon delete path does NOT call
   `removeTask` before the Server Action. The card lingers. This is asymmetric with
   handleArchiveTask, handleVaultConfirm, and TaskContextMenu.handleDelete — all of
   which call `removeTask` first.

5. **checklistSummaries not updated on checklist delete**: After deleting a checklist
   item, the board card's `checked/N` counter badge is wrong until the next full poll.

6. **TaskContextMenu has an extra removeTask call**: `TaskContextMenu.handleDelete`
   calls `removeTask(taskId)` directly in the component, AND fires `onTaskDelete`
   which calls `handleTaskDelete` -> `deleteBoardTask`. The DB delete is correct.
   But there are two code paths to `removeTask` for the context menu — one local,
   one through the callback chain. If the callback also called `removeTask`, it would
   double-remove (which is harmless in a filter operation but is architectural noise).
   Currently `handleTaskDelete` does NOT call `removeTask` — so only the context menu
   local call removes it. This means the bin icon path has NO removeTask call at all.

---

## Strategic Recommendations

### Fix Bug #1 — QuickAddTask disappear (phone)

Primary cause: the Server Action call is fire-and-forget with silent failure, and
the `persist` rehydration can race with the DB response on mobile.

**Recommended fix:**
```typescript
// In useBoardHandlers.handleTaskCreate — after await resolves, confirm the task
// is in the DB; if the action fails, rollback via removeTask
const handleTaskCreate = useCallback((task: ...) => {
  createBoardTask(task).catch((err) => {
    console.error('Failed to create task:', err)
    useBoardStore.getState().removeTask(task.id)   // rollback on failure
  })
}, [])
```

Also clear the isDirty flag after mutation settles, or use a timeout:
```typescript
// After Server Action settles (success or fail), reset isDirty
createBoardTask(task)
  .then(() => useBoardStore.setState({ isDirty: false }))
  .catch(...)
```

### Fix Bug #2 — Delete slug (bin icon)

Add `removeTask` before the Server Action in `handleTaskDelete`, matching the
pattern used by handleArchiveTask, handleVaultConfirm, and TaskContextMenu:

```typescript
// useBoardHandlers.ts
const handleTaskDelete = useCallback((taskId: string) => {
  useBoardStore.getState().removeTask(taskId)              // instant UI update
  deleteBoardTask(taskId, projectId).catch((err) => {
    console.error('Failed to delete task:', err)
    // Optional: rollback here if needed
  })
}, [projectId])
```

### Fix Bug #3 — Cross-device sync (isDirty blocks polling)

The isDirty flag needs to be reset after each mutation settles, not only on full reload:

```typescript
// In handleTaskCreate, handleTaskUpdate, handleTaskDelete etc.:
createBoardTask(task)
  .then(() => {
    useBoardStore.setState({ isDirty: false })
  })
  .catch(...)
```

Or: reduce the poll interval and remove the isDirty guard entirely — rely on
the poll to be the source of truth, making mutations purely optimistic. This is
simpler and more correct for a polling-based sync model.

Or: implement a proper invalidation — instead of isDirty blocking polls, use a
`lastMutatedAt` timestamp and only skip polls if the last mutation was within
the last N seconds.

### Fix checklist summary stale badge

After `handleChecklistRemove` resolves, update checklistSummaries in the board store:

```typescript
const handleChecklistRemove = useCallback((itemId: string) => {
  if (!editingTaskId) return
  setChecklistItems((prev) => {
    const next = prev.filter((i) => i.id !== itemId)
    // Recompute and push to boardStore
    const checked = next.filter(i => i.state === 'checked').length
    const crossed = next.filter(i => i.state === 'crossed').length
    useBoardStore.getState().setChecklistSummaries({
      ...useBoardStore.getState().checklistSummaries,
      [editingTaskId]: { checked, crossed, total: next.length }
    })
    return next
  })
  deleteChecklistItem(itemId, editingTaskId, projectId).catch(() => {})
}, [editingTaskId, projectId])
```

### Long-term: real-time sync

To properly fix cross-device sync without 30s delay:
- Add a lightweight SSE endpoint that emits a `data-changed` event after each mutation
- Client subscribes and calls `triggerReload()` on any SSE event
- Remove the 30-second interval entirely

Minimum viable SSE endpoint:
```
GET /api/projects/[id]/events  -> text/event-stream
  After each Server Action: emit `event: board-changed\ndata: {projectId}\n\n`
```

Client-side in useProjectData:
```typescript
useEffect(() => {
  const es = new EventSource(`/api/projects/${projectId}/events`)
  es.onmessage = () => triggerReload()
  return () => es.close()
}, [projectId])
```

---

## Files Modified in any Fix

Primary:
- `/src/app/project/[id]/useBoardHandlers.ts` — add removeTask before delete SA; reset isDirty after mutations
- `/src/components/board/TaskEditModal.tsx` — update checklistSummaries in boardStore after checklist delete

Secondary:
- `/src/app/project/[id]/useProjectData.ts` — reconsider isDirty guard; optionally add SSE subscription
- `/src/lib/store/boardStore.ts` — no change needed; isDirty semantics are correct, just underused

Reference files for understanding flow:
- `/src/lib/actions/board.ts`
- `/src/components/board/QuickAddTask.tsx`
- `/src/components/board/SortableTaskCard.tsx`
- `/src/components/board/TaskContextMenu.tsx`
- `/src/components/board/KanbanColumn.tsx`
- `/src/lib/actions/checklist.ts`
