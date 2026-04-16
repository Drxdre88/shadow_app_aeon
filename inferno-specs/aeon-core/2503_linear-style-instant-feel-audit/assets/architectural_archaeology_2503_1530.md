# Audit: Linear Style Instant Feel — Evidence Report
Date: 2026-03-25

---

## SECTION 1 — DONE ITEMS VERIFIED

### 1.1 Optimistic Updates
VERDICT: REAL — comprehensive rollback coverage.

Every mutation in `useBoardHandlers.ts` follows the same pattern:
- Mutate Zustand store immediately
- Fire server action async
- On error: snapshot restored + `toast('Failed to ...')` shown

Examples with file:line evidence:

- `handleTaskCreate` (line 29-37): calls `createBoardTask`, on error calls `removeTask(task.id)` then `toast('Failed to create task')`
- `handleTaskDelete` (line 63-98): snapshots task before `removeTask`, on success shows toast with `onUndo` callback that re-calls `createBoardTask`
- `handleTaskMove` (line 100-114): fires `reorderBoardTasks`, on error only calls `toast` — no positional rollback here (see gap below)
- `handleColumnCreate` (line 116-124): on error removes added column
- `handleColumnUpdate` (line 126-137): snapshots column before server call, restores on error
- `handleColumnReorder` (line 139-148): snapshots all column orderIndex values, restores individually on error
- `handleColumnDelete` (line 150-164): snapshots column and all tasks in it, full restore on error
- `handleVaultConfirm` / `handleArchiveTask` (lines 173-229): snapshots, restores on error

The one gap: `handleTaskMove` does NOT restore prior column/position on error. It only shows a toast. If the server reorder fails, the board stays in the new visual position but the DB has old position — silent desync.

### 1.2 Stale-While-Revalidate Cache
VERDICT: PARTIALLY REAL — cache check exists, but it is coarse and only for the board tab.

`useProjectData.ts` lines 25-37:
```
const cachedTasks = useBoardStore.getState().tasks
const hasCachedProject = cachedTasks.length > 0 && cachedTasks[0]?.projectId === projectId
if (isInitialLoad.current) {
  if (!hasCachedProject) {
    setIsLoading(true)
    ...
  }
}
```

When `hasCachedProject` is true, `setIsLoading(true)` is NOT called — so the board renders immediately from Zustand (persisted via `localStorage` via `zustand/persist`). The server fetch still fires in background and updates the store. This is the SWR pattern.

Gaps:
- Line 44: `if (!isInitialLoad.current && useBoardStore.getState().isDirty) return` — background refresh aborts if store is dirty. This prevents overwriting in-progress edits, which is correct. But `isDirty` is set on every `addTask/updateTask/removeTask/moveTask` call (lines 121-134 of boardStore.ts) and only cleared after the server confirms. So the revalidation window is always blocked during active editing.
- Gantt and Canvas data (`useProjectData.ts` lines 116-183) have NO cache — they start loading only when you switch to those tabs, from zero, every time.
- No TTL. If you leave a project page and come back 24 hours later, it renders stale localStorage data with no freshness signal.

Background polling: lines 186-203 — 10s interval, fires only when tab is visible and store is not dirty. This works but is just polling, not true server-push.

### 1.3 Skeleton Screens
VERDICT: REAL — two implementations, both correct.

1. Route-level Suspense: `src/app/project/[id]/loading.tsx` — Next.js App Router automatically uses this while `page.tsx` server component loads. It renders a 4-column skeleton with animate-pulse cards (correct card hierarchy: column header + cards with varying counts per column).

2. Client-side loading state: `ProjectContent.tsx` lines 278-295 — identical skeleton UI shown when `isLoading === true` inside the client component after initial mount.

Note: There is no Skeleton component library. These are hand-built `animate-pulse` divs. That is fine for this scope, but means no reusable Skeleton abstraction.

### 1.4 Aggressive Prefetching
VERDICT: NOMINAL — relies entirely on Next.js defaults.

`next.config.ts` has no `prefetch` configuration. No explicit `<Link prefetch>` flags anywhere. The card description says "Next.js Link handles it automatically" — this is true for App Router (prefetches on viewport intersection by default), but this is a passive feature, not an implemented one. There is no route-level prefetch optimization (e.g., prefetching `/project/[id]` data on dashboard hover).

### 1.5 Keyboard Shortcuts
VERDICT: MOSTLY REAL — but ? and Escape shortcuts are scattered, not unified.

`useBoardKeyboardShortcuts.ts` wires C, E, V (priority), L (label), G (glow), D (dates), Ctrl+C (copy), Ctrl+V (paste). This covers the advertised shortcuts.

`HelpModal.tsx` line 149: `if (e.key === '?')` — correctly opens help modal.

`Toast.tsx` line 55: `if ((e.metaKey || e.ctrlKey) && e.key === 'z')` — Ctrl+Z undo works.

Escape: wired per-modal in each component separately (BatchVaultModal, ColumnDeleteModal, DependencyGlowTree, LabelPicker, ProjectSwitcher, TaskColorPicker, TaskContextMenu, TaskEditModal, TaskPriorityPicker, VaultDaysModal). This is fragile — each modal manages its own listener. No central escape stack.

What is NOT wired:
- No `?` shortcut documentation in `SHORTCUTS` array in `BoardTab.tsx` (line 60-66) — the help screen does not list `?` as a shortcut.
- No global `Escape` handler at the board level to close whatever is open.

### 1.6 PWA Manifest
VERDICT: REAL but SW is a pass-through stub.

`public/manifest.json`: standalone display, correct start_url, theme_color, background_color. Icons: only 512x512 PNG used for both maskable and any — no 192x192 icon, which Chrome requires for installability.

`public/sw.js` (3 lines active code):
```js
self.addEventListener('install', (event) => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', (event) => { event.respondWith(fetch(event.request)) })
```
This is a pass-through service worker — it does NOT cache anything. Every request goes to the network. The app will not work offline. There is no Workbox, no caching strategy, no asset precaching. The SW purely enables the PWA install prompt on Chrome/Edge.

`ServiceWorkerRegistration.tsx` (lines 7-9): correctly registers sw.js from layout. This works.

---

## SECTION 2 — ACTUALLY REMAINING

### 2.1 IndexedDB / Dexie
STATUS: Zero implementation. No `dexie` in `package.json`. No `indexedDB` calls anywhere in `src/`. No `idb` package. Not started.

Complexity estimate: Large. Requires:
1. Dexie schema mirroring the Neon tables (tasks, columns, labels, dependencies, checklist_summaries, gantt_tasks, canvas_nodes, canvas_edges)
2. Replacing `useBoardStore.getState()` reads with Dexie queries on first load
3. Dual-write path: every server action needs to also write to Dexie on success
4. Migration strategy for schema changes
5. Stale invalidation: knowing when Dexie data is too old to trust

### 2.2 Offline Sync Queue
STATUS: Zero implementation. No `navigator.onLine` check anywhere in src/. No queue data structure. No reconnect event handlers. Not started.

Complexity estimate: Very large. Requires:
1. Offline detection hook (navigator.onLine + online/offline events)
2. Queue table in Dexie (ordered mutations with type, payload, timestamp)
3. Intercept layer in every server action: when offline, enqueue instead of calling server action
4. Flush logic on reconnect: process queue in order, handle conflicts
5. Error handling for mutations that fail after reconnect (server state diverged)
6. UI feedback: offline badge, queue depth indicator

---

## SECTION 3 — MISSING FOR TRUE LINEAR FEEL

### 3.1 Command Palette (Cmd+K)
NOT PRESENT. No cmdk, kbar, or custom implementation. The app has no global navigation shortcut. This is one of Linear's most-used features.

### 3.2 Inline Editing
NOT PRESENT for task names. All editing goes through `TaskEditModal` — a full overlay. Linear lets you click a task name in the list and type directly. Only column rename (`KanbanColumn.tsx`) uses an inline input pattern (lines 283-285).

### 3.3 Real-Time Collaboration / Live Presence
NOT PRESENT. No WebSocket, no Pusher, no Supabase realtime, no SSE. The app is single-user. Background polling at 10s intervals is the only sync mechanism.

### 3.4 Notification System
NOT PRESENT. There is an `activity` log (emitActivity calls in board.ts), and a `velocity` tab, but no in-app notification panel, no unread count badge, no @mention support.

### 3.5 Undo/Redo Visual Feedback
PARTIAL. The toast has an Undo button and Ctrl+Z wiring (`Toast.tsx` lines 54-65), but only for delete operations (the only handler that passes `onUndo`). Move, update, label change, priority change — none have undo support. Linear's undo/redo stack spans all mutations.

### 3.6 Virtual Scrolling
NOT PRESENT. No react-window or TanStack Virtual. With 100+ cards in a column the DOM grows unbounded.

### 3.7 Search with Instant Results
PARTIAL. `BoardFilterBar` has a text search field but it filters the visible board only. No cross-project search, no task-by-ID lookup, no instant-navigate-to-task.

### 3.8 Breadcrumb Navigation
NOT PRESENT. The header shows project name + a back arrow to /dashboard. No breadcrumb trail like "Dashboard > Project > Task".

### 3.9 Page Transitions
PARTIAL. `ProjectContent.tsx` lines 297-303 wraps tab switches in `AnimatePresence` with `opacity 0->1, y 6->0, duration 0.15`. Dashboard has basic framer-motion fade. But dashboard-to-project navigation is a hard page load with no shared element transitions.

### 3.10 Dark/Light Theme Toggle
NOT PRESENT. The app is dark-only. The `ThemeStore` manages glow colors and fonts but there is no light mode. `html` element has hardcoded `className="dark"` in `layout.tsx` line 48.

---

## SECTION 4 — PERFORMANCE GAPS

### 4.1 SortableTaskCard Has No Memoization
`SortableTaskCard.tsx` is NOT wrapped in `React.memo`. The only memoized component in the entire board is `IdeaNode` in the canvas. When any store update happens (adding one task, any label change), every card in every column re-renders. With 50 tasks, that is 50 component re-executions per keypress in the quick-add form.

Evidence: `useBoardStore()` called at line 85 of SortableTaskCard with destructuring — subscribes the card to ALL store changes including unrelated columns.

### 4.2 Bare `useBoardStore()` Subscriptions
Multiple components call `useBoardStore()` without a selector, which subscribes them to the entire store state:
- `SortableTaskCard.tsx:85` — every card subscribes to all state
- `TaskBoard.tsx:120` — main board subscribes to full store
- `LabelPicker.tsx:48` — label picker re-renders on task changes
- `TaskContextMenu.tsx:33` — context menu re-renders on unrelated column changes
- `GanttViewModal.tsx:93` — subscribes to tasks/labels/dependencies while Gantt is active

Linear-style performance requires selector-scoped subscriptions: `useBoardStore(s => s.tasks)` vs `useBoardStore()`.

### 4.3 KanbanColumn Has 11 Hooks
KanbanColumn.tsx uses 11 useEffect/useState calls (counted). It is not memoized. Every parent re-render cascades into all column logic. With 5 columns, that is 55 hook evaluations per store update cycle.

### 4.4 loadBoardData is Sequential for Auth
`lib/actions/board.ts` line 28-29:
```js
await requireOwnership(projectId)   // DB call #1
await _createDefaultColumns(projectId)  // DB call #2
const [tasks, columns, ...] = await Promise.all([...])  // DB calls 3-8 in parallel
```
The first two are sequential before the parallel batch. requireOwnership does a DB lookup. This adds ~50-100ms to every board load before any data fetches.

### 4.5 No Code Splitting Beyond CanvasView
Only one `dynamic()` import exists: `CanvasView`. The Gantt chart, Trophy room, Velocity tab, and all board components are eagerly bundled. On first load, the user downloads chart rendering libraries they may never use.

### 4.6 Service Worker Does Zero Caching
`sw.js` passes all fetches through to the network. Static assets (JS bundles, CSS) are not cached. The supposed "PWA" will not load faster on repeat visits compared to no service worker.

### 4.7 Four Google Fonts Loaded at Boot
`layout.tsx` lines 12-15 loads Inter, JetBrains Mono, Space Grotesk, and Fira Code from Google Fonts. Each is a separate network request. Only one is active at a time (controlled by ThemeStore). The other three are wasted bandwidth.

### 4.8 No Image Optimization in Components
`ProjectContent.tsx` line 81 uses `next/image` correctly for the aeon logo. However, no other image optimization is applied elsewhere. User avatars (from Google OAuth) are loaded as raw `<img>` tags in various auth components.

---

## SECTION 5 — MODIFICATION RISKS

1. Memoizing SortableTaskCard with React.memo requires stabilizing all callback props passed to it from KanbanColumn — currently inline arrow functions recreate every render. A refactor without this will make React.memo ineffective.

2. Switching from bare `useBoardStore()` to selectors will change re-render behavior — some components may silently break if they relied on receiving fresh data from a tangential state change. Requires full testing of each affected component.

3. Adding Dexie: boardStore.ts uses `zustand/persist` to localStorage for the same data. Having both Dexie and localStorage as local persistence layers creates a two-source-of-truth problem. The persist middleware must be removed or scoped when Dexie is added.

4. The `isDirty` flag in boardStore.ts is the only guard preventing background revalidation from overwriting local changes (useProjectData.ts line 44). Any offline queue implementation must also set `isDirty` to block background polling while mutations are queued.

5. Offline sync queue mutations may conflict with the optimistic update rollback pattern — if a mutation is queued offline and then fails on flush, both the queue retry logic AND the optimistic rollback logic could fire, creating double-rollback.
