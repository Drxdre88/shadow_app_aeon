# Investigation: Undo/Redo Pipeline (20260820)

**Scope:** End-to-end path from mutation → undo entry capture → undo execution → server sync.  
**Status:** VERIFIED unless marked INFERRED.

---

## 1. The Undo Stack — `undoStore`

**File:** `apps/web/src/lib/store/undoStore.ts`

The entire undo system is a plain Zustand store — no persistence, no redo.

```ts
// undoStore.ts:1-3
const MAX_STACK_SIZE = 20

export interface UndoEntry {
  id: string
  description: string
  undo: () => void        // closure capturing pre-mutation snapshot
  timestamp: number
}
```

**Stack operations (all VERIFIED):**

| Method | What it does | File:line |
|--------|-------------|-----------|
| `push(description, undoFn)` | Prepends entry, trims to 20, returns id | `undoStore.ts:24–31` |
| `pop()` | Removes and returns most-recent entry (Ctrl+Z path) | `undoStore.ts:33–39` |
| `popById(id)` | Removes and returns specific entry (toast button path) | `undoStore.ts:45–51` |
| `remove(id)` | Removes entry without returning it | `undoStore.ts:41–43` |
| `clear()` | Empties the stack | `undoStore.ts:53` |

The stack is **in-memory only** — it is not persisted to `localStorage`. Navigating away, refreshing, or reloading clears all undo history. [VERIFIED: no `persist` middleware in `undoStore.ts`]

---

## 2. How an Entry Gets Pushed — `toast()` + `onUndo`

**File:** `apps/web/src/components/ui/Toast.tsx:21–28`

Undo entries are **never pushed directly** by mutation handlers. The sole entry point is the `toast()` utility:

```ts
// Toast.tsx:21-28
export function toast(message, options?) {
  if (!addToastGlobal) return
  let undoId: string | undefined
  if (options?.onUndo) {
    undoId = useUndoStore.getState().push(message, options.onUndo)
  }
  if (!options?.force && !useThemeStore.getState().boardActionToasts) return
  addToastGlobal({ message, undoId, duration: options?.duration })
}
```

**Key detail:** `push()` is called even if the toast itself is suppressed by the `boardActionToasts` user preference. The undo entry is always created; the visible toast chip is optional. [VERIFIED]

---

## 3. Which Mutations Are Undoable

Undo is offered exclusively via `onUndo` callbacks passed to `toast()`. Below is every callsite. All are VERIFIED.

### Board mutations (`useBoardHandlers.ts`)

| Action | When undo is offered | Undo reverses | File:line |
|--------|---------------------|--------------|-----------|
| Task update (`priority`, `color`, `name`) | After server confirms (`onSuccess` on queue) | Stores pre-mutation snapshot; calls `updateTask` + `updateBoardTask` | `useBoardHandlers.ts:62–74` |
| Task delete | After server confirms (`onSuccess` on queue) | Calls `addTask` + `createBoardTask` | `useBoardHandlers.ts:86–112` |
| Task move (cross-column only) | After server confirms (`onSuccess` on queue) | Calls `moveTask`/`updateTask` + `reorderBoardTasks` | `useBoardHandlers.ts:132–157` |
| Column update | After direct `updateColumnAction` call resolves | Calls `updateColumn` + `updateColumnAction` | `useBoardHandlers.ts:186–191` |
| Column delete | After `deleteColumnAction` resolves | Calls `addColumn` + `createColumn`, then re-creates all tasks | `useBoardHandlers.ts:234–261` |

**Not undoable (VERIFIED by absence of `onUndo`):**
- Task create
- Column create / reorder
- Vault (send-to-vault, batch-vault)
- Archive task / archive column tasks

### Label mutations (`useLabelHandlers.ts`)

| Action | When undo is offered | Undo reverses | File:line |
|--------|---------------------|--------------|-----------|
| Label update | After direct action resolves | Calls `updateLabel` store + `updateLabel` action | `useLabelHandlers.ts:26–30` |
| Label delete | After direct action resolves | Calls `addLabel` + `createLabel` | `useLabelHandlers.ts:48–52` |
| Label added to task | After direct action resolves | Calls `updateTask` (remove id) + `removeLabelFromTask` | `useLabelHandlers.ts:67–71` |
| Label removed from task | After direct action resolves | Calls `updateTask` (re-add id) + `addLabelToTask` | `useLabelHandlers.ts:85–89` |

### Gantt mutations (`GanttChart.tsx`)

| Action | When undo is offered | Undo reverses | File:line |
|--------|---------------------|--------------|-----------|
| Resize (left/right edge) | Immediately after local store update | Calls `updateTask` (gantt store) + `onTaskUpdate` callback | `GanttChart.tsx:225–230` |
| Drag (date move / row move) | Immediately after local store update | Calls `updateTask` + `onTaskUpdate` | `GanttChart.tsx:283–289` |
| Rename task | Immediately after local store update | Calls `updateTask` + `onTaskUpdate` | `GanttChart.tsx:302–307` |
| Rename row | Immediately after local store update | Calls `ganttStore.updateRow` + `onRowUpdate` | `GanttChart.tsx:316–321` |

**Gantt note:** undo is pushed **before** server confirmation, unlike board mutations. [VERIFIED]

---

## 4. The Two Mutation Paths

Aeon has two distinct save paths. Which one is used determines when (or whether) the undo entry is created.

### Path A — Mutation Queue (board tasks)

**Files:** `mutationQueue.ts`, `mutationDispatch.ts`

1. Caller applies optimistic store update (e.g. `boardStore.updateTask`).
2. Caller calls `useMutationQueue.getState().enqueue(mutation, { rollback, onSuccess, failMessage })`.
3. Queue serialises the `QueuedMutation` to `localStorage` (`aeon-mutation-queue`).
4. `flush()` processes FIFO, calls `dispatchMutation(m)` → matching server action.
5. On success: `fx.onSuccess()` fires → `toast(…, { onUndo })` → `undoStore.push()`.
6. On transient error: record stays queued, retried every 8 s.
7. On hard rejection: `fx.rollback()` reverts store, error toast shown (no undo offered).

**Queue types handled (VERIFIED via `mutationDispatch.ts:46–56`):**
`task.create`, `task.update`, `task.delete`, `task.move`, `checklist.create`, `checklist.update`, `checklist.delete`, `checklist.reorder`, `checklist.groupRename`, `checklist.groupDelete`

### Path B — Direct `persistMutation` / fire-and-forget (columns, labels, gantt)

**File:** `persistMutation.ts`; also inline `beginDirectWrite`/`endDirectWrite` in `useBoardHandlers.ts`

Column and label mutations call server actions directly (not via the queue). They bracket the call with `beginDirectWrite()` / `endDirectWrite()` to hold off board reloads while the write is in flight. `persistMutation` itself handles retry logic, save-status updates, and rollback on failure.

---

## 5. How Undo Is Applied

**File:** `Toast.tsx:62–78`

Two triggers, both VERIFIED:

### Keyboard: Ctrl/Cmd+Z

```ts
// Toast.tsx:62-78
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    const entry = useUndoStore.getState().pop()  // removes top of stack
    if (entry) {
      e.preventDefault()
      entry.undo()                               // fires the closure
      // removes matching visible toast chip
      // shows "Undid: <description>" chip for 2.5s
    }
  }
})
```

Keyboard undo is **suppressed** when the focused element is `INPUT`, `TEXTAREA`, or `contentEditable`. [VERIFIED: `Toast.tsx:64`]

### Toast button click

```ts
// Toast.tsx:101-104
const entry = useUndoStore.getState().popById(t.undoId!)
if (entry) entry.undo()
removeToast(t.id)
```

Uses `popById` to remove by id rather than `pop`, so it can target any entry regardless of stack position.

---

## 6. Server Sync on Undo

Undo closures call server actions **directly** — they do **not** go through the mutation queue. [VERIFIED: closures in `useBoardHandlers.ts` call `updateBoardTask`, `createBoardTask`, `reorderBoardTasks`, etc. directly]

This has a correctness implication: the undo write is fire-and-forget with a minimal `.catch(() => toast('Failed to undo'))`. There is no retry, no rollback, and no guard from `beginDirectWrite`/`endDirectWrite`. [VERIFIED by inspection; no `persistMutation` or queue enqueue inside any `onUndo` closure]

Gantt undo closures call `onTaskUpdate` (a prop callback from the parent page), which may call a server action — the exact action depends on context. [INFERRED: `onTaskUpdate` is not traced here; the pattern matches what GanttChart receives from its parent page.]

---

## 7. Realtime Refetch and Undo Guard

**File:** `useProjectData.ts`

Two reload triggers exist:

| Trigger | Guard | File:line |
|---------|-------|-----------|
| Pusher `board-update` event | `if (isDirtyOrGracePeriod()) return` | `useProjectData.ts:327` |
| 30 s poll (version check) | `if (isDirtyOrGracePeriod()) return` | `useProjectData.ts:271` |

**`isDirtyOrGracePeriod()` returns true when (VERIFIED — `boardStore.ts:294–302`):**
- `isDirty === true`
- `directWrites > 0` (a `beginDirectWrite` is outstanding)
- Any registered `pendingWritesSource` returns true (the mutation queue uses this)
- `Date.now() - lastMutatedAt < 5000` (5 s grace window after any mutation)

**During undo:** because undo calls server actions directly without `beginDirectWrite`, there is no `directWrites` guard. However, any optimistic store mutation sets `isDirty = true` and bumps `lastMutatedAt`, so the 5 s grace window activates and prevents an immediate clobber. [VERIFIED: `boardStore.ts:149–196` all set `isDirty: true, lastMutatedAt: Date.now()`]

**Undo stack vs. server refetch:** `undoStore` holds closures, not data. A Pusher-triggered `doFullLoad` will `setState({ tasks: dbTasks, … })` which replaces the store but does NOT clear the undo stack. If the user's undo fires after a refetch, the closure still holds a pre-mutation snapshot — it will call the server action with stale data. [INFERRED: no explicit clearing of undoStore on refetch observed anywhere]

---

## 8. No Redo

There is no redo stack and no forward-redo operation anywhere in the codebase. `undoStore` has no `redo` method. [VERIFIED]

---

## 9. End-to-End Trace — Task Delete

1. User clicks "Delete task" → `handleTaskDelete(taskId)` (`useBoardHandlers.ts:77`)
2. Snapshot captured: `const snapshot = tasks.find(t => t.id === taskId)` (`:79`)
3. Optimistic remove: `removeTask(taskId)` → sets `boardStore.tasks`, `isDirty=true`, `lastMutatedAt` (`:80`)
4. Queue: `enqueue({ type: 'task.delete', args }, { rollback, onSuccess })` (`:81`)
5. `flush()` runs → `dispatchMutation` → `deleteBoardTask(taskId, projectId)` server action (`:68`)
6. Server action persists delete, bumps `boardVersion`
7. `fx.onSuccess()` fires → `toast('Task deleted', { onUndo })` (`:86–112`)
8. `undoStore.push('Task deleted', undoFn)` returns `undoId`; toast chip shown for 5 s
9. User presses Ctrl+Z → `undoStore.pop()` → fires `undoFn` (`:66–73`)
10. `undoFn`: `addTask(snapshot)` (store) + `createBoardTask({…snapshot})` (server action, fire-and-forget)
11. Pusher or next poll fires, server sees new version → `doFullLoad()` blocked if `isDirtyOrGracePeriod()`, otherwise replaces store

---

## 10. Summary Table — Undoable Mutations

| Surface | Action | Undo offered when | Server sync on undo |
|---------|--------|------------------|---------------------|
| Board | Task update (priority/color/name) | After queue success | Direct `updateBoardTask` |
| Board | Task delete | After queue success | Direct `createBoardTask` |
| Board | Task move (cross-column) | After queue success | Direct `reorderBoardTasks` |
| Board | Column update | After direct action | Direct `updateColumnAction` |
| Board | Column delete | After direct action | Direct `createColumn` + `createBoardTask` per task |
| Labels | Label update | After direct action | Direct `updateLabel` |
| Labels | Label delete | After direct action | Direct `createLabel` |
| Labels | Label add to task | After direct action | Direct `removeLabelFromTask` |
| Labels | Label remove from task | After direct action | Direct `addLabelToTask` |
| Gantt | Task resize | Immediately (before server confirm) | Via `onTaskUpdate` callback |
| Gantt | Task drag (date/row) | Immediately (before server confirm) | Via `onTaskUpdate` callback |
| Gantt | Task rename | Immediately (before server confirm) | Via `onTaskUpdate` callback |
| Gantt | Row rename | Immediately (before server confirm) | Via `onRowUpdate` callback |

---

## 11. Gaps and Observations

1. **Undo writes are fire-and-forget.** No retry, no queue enqueue, no `beginDirectWrite` guard. A failed undo write shows a minimal toast but leaves store and server in a diverged state. [VERIFIED]

2. **Gantt undo fires before server confirm.** If the initial save fails, both the original and the undo are orphaned. [VERIFIED by code structure; Gantt pushes undo in the same tick as the local update]

3. **No redo.** Confirmed absent. [VERIFIED]

4. **Stack is not cleared on refetch.** Stale snapshots in closures can re-apply pre-refetch data. [INFERRED — no `undoStore.clear()` call found in `useProjectData.ts` or board data loaders]

5. **`boardActionToasts` preference gates visibility but not capture.** An entry is always pushed even when the toast chip never renders. This means Ctrl+Z can undo an action that was never surfaced to the user. [VERIFIED: `Toast.tsx:24–28`]
