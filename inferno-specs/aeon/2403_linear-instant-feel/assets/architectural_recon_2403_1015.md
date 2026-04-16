# Architectural Recon: Linear Style Instant Feel
**Date:** 2403 | **Target:** shadow_app_aeon | **Type:** Pre-implementation analysis

---

## Mission Objective
Map current data fetching, state management, loading states, keyboard shortcuts, and mutation patterns to identify exact change surface for Linear-style instant feel implementation.

---

## 1. Current Data Fetching Patterns

**Pattern: Next.js Server Actions + client-side useEffect polling**

No SWR, no React Query, no raw fetch calls on the client side for board data. The stack is:

- **Server Actions** (`'use server'`) in `src/lib/actions/*.ts` — all mutations and reads go through these. They hit Drizzle ORM directly and call `revalidatePath()` on every write.
- **Client-side loading** in `src/app/project/[id]/useProjectData.ts` — a hand-rolled `useEffect` that calls `loadBoardData(projectId)` (a server action) on mount and re-runs it on a `loadKey` state increment.
- **Polling loop** (line 172-189, `useProjectData.ts`): a `setInterval` at 10,000ms that bumps `loadKey` only when `document.visibilityState === 'visible'` AND `!isDirty`. Also fires on `visibilitychange`.
- **Dashboard** (`src/app/dashboard/page.tsx`): pure server component — fetches `getProjectsWithStats()` at render time, passes serialized data as props to `DashboardContent`. No client refetch.
- **Project page** (`src/app/project/[id]/page.tsx`): server component fetches project metadata from DB, passes to `<ProjectContent>`. The heavy board data is deferred to `useProjectData`.
- **Gantt / Canvas tabs**: lazy-loaded inside `useProjectData` via `Promise.all([...])` only when the respective tab becomes active and `isLoading === false`.

**No caching layer exists.** `revalidatePath` invalidates Next.js route cache on every mutation but there is no `unstable_cache`, no data memoization, no SWR-style deduplication.

---

## 2. Current State Management

**Primary store: Zustand** (`src/lib/store/boardStore.ts`) with `persist` middleware.

- `useBoardStore` — board columns, tasks, labels, dependencies, checklist summaries, `isDirty` flag, `selectedTaskId`.
- `useGanttStore` — gantt rows, tasks, views, activeViewId (`src/lib/store/ganttStore.ts`).
- `useCanvasStore` — canvas nodes, edges (`src/lib/store/canvasStore.ts`).
- `useThemeStore` — theme, shortcuts, all visual prefs (`src/stores/themeStore.ts`). No `persist` middleware — hydrated from DB via `PreferencesProvider` on mount.

**Persistence**: `boardStore` uses `persist` with key `'aeon-board'` and partializes to `{ tasks, labels, dependencies, columns }`. This means localStorage already caches board data between sessions — this is the foundation for stale-while-revalidate reads.

**`isDirty` flag**: set to `true` on any mutation, reset to `false` when server action succeeds. The poll loop checks this before re-fetching — prevents overwriting in-flight optimistic state.

**Mutation flow** in `src/app/project/[id]/useBoardHandlers.ts`:
- UI updates Zustand store **first** (optimistic, no await)
- Server action called **fire-and-forget** with `.then()` / `.catch()`
- On `.catch()`: some handlers restore the snapshot (e.g. `handleTaskDelete`, `handleTaskCreate`), others only `console.error` (e.g. `handleTaskUpdate`, `handleColumnReorder`)
- No toast is shown on error anywhere in the mutation handlers

---

## 3. Where Spinners / Loading States Are Currently Used

| Location | File | Line | Type |
|----------|------|------|------|
| Board initial load | `ProjectContent.tsx` | 261-279 | Custom skeleton (4 columns, `animate-pulse` divs) |
| Velocity tab | `VelocityTab.tsx` | 65-68 | Text string "Loading velocity data..." |
| Archive browser | `ArchiveBrowser.tsx` | 121-123 | Text string "Loading archived tasks..." |
| Trophy vault | `TrophyRoom.tsx` | 280-282 | Text string "Loading vault..." |
| Trophy timeline infinite scroll | `TrophyTimeline.tsx` | 135-137 | Inline spinner (implied by `isLoading` prop) |
| Column context menu (transfer) | `ColumnContextMenu.tsx` | 241-244 | Text string "Loading..." |
| Task context menu (transfer) | `TaskContextMenu.tsx` | 307-310 | Text string "Loading..." |
| Login button | `LoginForm.tsx` | 188-193 | Spinner + "Redirecting..." text |
| Shortcut remap button | `ShortcutsTab.tsx` | 52 | `animate-pulse` CSS |

**No `loading.tsx` files exist** anywhere in the route tree. The app/dashboard and app/project/[id] routes have no Next.js segment-level loading boundary.

The board skeleton at `ProjectContent.tsx:261-279` is the only real skeleton — it renders 4 column skeletons with pulse cards while `isLoading === true`. All other loading states are text strings.

---

## 4. Existing Keyboard Shortcuts (from QoL branch)

**Shortcut system**: configurable via `DEFAULT_SHORTCUTS` in `src/config/defaults.ts` with remapping UI in `ShortcutsTab.tsx`. Stored in `useThemeStore.shortcuts`.

**Default bindings** (`src/config/defaults.ts:18-25`):
- `c` — add card (to first column)
- `e` — edit card (on hovered/selected task)
- `l` — open label picker
- `g` — change glow/color
- `v` — change priority
- `d` — toggle date display

**Board-level shortcuts** (`src/components/board/useBoardKeyboardShortcuts.ts`):
- All 6 above implemented as a single `window.addEventListener('keydown')` hook
- Guard: skips if target is `INPUT`, `TEXTAREA`, or `isContentEditable`
- Targets `hoveredTaskId ?? selectedTaskId` for task-scoped actions

**Modal-level Escape** (each wires its own listener):
- `TaskEditModal`, `ColumnDeleteModal`, `BatchVaultModal`, `VaultDaysModal`, `LabelPicker`, `TaskColorPicker`, `TaskPriorityPicker`, `TaskContextMenu`, `ColumnContextMenu`, `DependencyGlowTree`, `HelpModal`, `SettingsModal`, `GanttViewModal`

**Global `?` shortcut** (`HelpModal.tsx:146-155`): opens help modal. Already implemented.

**Dashboard `g` shortcut** (`GridView.tsx:69-79`): change project glow on hover.

**Missing** from Linear-style target list:
- No global `?` shortcut — CORRECTION: exists in `HelpModal.tsx:149`
- No `Escape` to close task detail from board level (only per-modal)

---

## 5. Current API Call Patterns — Are Mutations Awaited Before UI Updates?

**No. Mutations are NOT awaited before UI updates.** The pattern is consistently optimistic-first:

```
// Pattern in useBoardHandlers.ts
handleTaskDelete:
  1. removeTask(taskId) — Zustand update, synchronous, instant
  2. deleteBoardTask(taskId, projectId) — server action, fire-and-forget .catch()

handleTaskCreate:
  1. (caller adds task to Zustand before calling this)
  2. createBoardTask(task) — fire-and-forget .then()/.catch()
  3. On catch: removeTask(task.id) — rollback

handleTaskUpdate:
  1. (caller updates Zustand before calling this)
  2. updateBoardTask(...) — fire-and-forget .then()/.catch()
  3. On catch: only console.error — NO ROLLBACK

handleColumnDelete:
  1. removeTask() for each task in column — sync
  2. removeColumn(columnId) — sync
  3. deleteColumn() — fire-and-forget

handleVaultConfirm:
  1. removeTask(vaultTarget.taskId) — sync
  2. sendToVault() — fire-and-forget, no rollback
```

**Partial optimism exists, but rollback coverage is incomplete:**
- `handleTaskDelete`: has snapshot + rollback on error
- `handleTaskCreate`: has rollback (removes task on error)
- `handleTaskUpdate`: NO rollback — error is silently logged
- `handleColumnReorder`, `handleLabelHandlers`: NO rollback
- Vault operations: NO rollback

**No toast on error anywhere in mutation handlers.** Errors go to `console.error` only.

The custom `Toast` component (`src/components/ui/Toast.tsx`) exists with `onUndo` support (Undo2 button) but is **not wired to any mutation handler**. It is imported in `layout.tsx` via `<ToastContainer>` but the `toast()` function is never called from board/label/column handlers.

---

## 6. Top 5-8 Files That Need Changes for Optimistic Updates

Ranked by impact and change surface:

| Priority | File | Why |
|----------|------|-----|
| 1 | `src/app/project/[id]/useBoardHandlers.ts` | All board mutations live here. Needs: error toast on all `.catch()`, rollback snapshots for `handleTaskUpdate`, `handleColumnUpdate`, `handleColumnReorder`. |
| 2 | `src/app/project/[id]/useProjectData.ts` | Drives initial load and polling. Needs: stale-while-revalidate pattern — serve persisted Zustand state instantly, fetch fresh in background without `setIsLoading(true)` on background refetches. |
| 3 | `src/app/project/[id]/ProjectContent.tsx` | Controls `isLoading` gate that hides the board behind skeleton. Needs: skeleton only on true first-load (no persisted cache), board visible immediately from cache otherwise. |
| 4 | `src/app/project/[id]/useLabelHandlers.ts` | Label mutations have no rollback. Needs snapshot + restore pattern matching `handleTaskDelete`. |
| 5 | `src/app/project/[id]/useDependencyHandlers.ts` | Same issue — no rollback on add/remove dependency errors. |
| 6 | `src/components/ui/Toast.tsx` | Already exists with `onUndo` support. Needs to be called from mutation `.catch()` blocks. Currently dead code in terms of board operations. |
| 7 | `src/app/dashboard/page.tsx` + `DashboardContent.tsx` | Dashboard is a pure server component — no client refetch, no prefetching on hover. Needs `router.prefetch('/project/[id]')` on project card hover for navigation speed. |
| 8 | `src/components/velocity/VelocityTab.tsx` + `src/components/trophy/TrophyRoom.tsx` | Both use text loading states. Needs skeleton replacements. |

---

## 7. Existing Caching Layer

**localStorage persistence via Zustand `persist`** is the only caching layer:
- Key: `'aeon-board'`
- Scope: `{ tasks, labels, dependencies, columns }` (partialize, line 174 of `boardStore.ts`)
- Mechanism: Zustand's `persist` middleware auto-hydrates from localStorage on mount

**Implication**: when a user navigates to a project they've visited before, Zustand already has stale board data in memory/localStorage before `useProjectData` makes its first server action call. The app does NOT exploit this — it currently sets `setIsLoading(true)` unconditionally on first load (line 23) and clears the store (`useBoardStore.setState({ columns: [], labels: [], dependencies: [] })`), discarding the cache.

**No other caching exists:**
- No SWR
- No React Query
- No `unstable_cache` on server actions
- No HTTP cache headers on API routes
- `revalidatePath()` is called on every write, which invalidates the Next.js full-route cache for RSC payloads

---

## Architectural Insights

**The optimistic update foundation is already largely built.** The `isDirty` flag, the fire-and-forget mutation pattern, and the Zustand-first architecture are exactly what Linear uses. The gaps are:
1. Missing error feedback (toast on `.catch()`)
2. Missing rollback for `handleTaskUpdate` and column/label mutations
3. Unused persisted cache on initial load (skeleton shown even when data is in localStorage)
4. No `loading.tsx` route segments for Next.js streaming
5. No route prefetching from dashboard project cards

**The `toast()` function with `onUndo` is ready to be wired.** It's a global singleton already mounted in `layout.tsx`. Zero infrastructure work needed — just call it.

**`boardStore.persist` already provides the stale-while-revalidate substrate.** The change needed in `useProjectData.ts` is: skip `setIsLoading(true)` and the store clear when persisted data exists, load the skeleton only when there is genuinely nothing cached.

---

## Reconnaissance Warnings

- `revalidatePath()` in every server action is aggressive — it busts the RSC payload cache on every mutation. For instant feel, consider whether this is needed since state is managed client-side in Zustand anyway.
- The `isDirty` flag is a coarse lock — it blocks background polls for the entire duration of any unconfirmed mutation. If a mutation stays `isDirty` due to a network error, polling stops indefinitely.
- `handleTaskUpdate` has no rollback. If an update fails silently, the client shows stale optimistic state with no recovery path.
- The `toast()` global singleton pattern (`addToastGlobal`) means there is exactly one `ToastContainer` instance allowed. This is fine but fragile if a second layout ever mounts one.
- Dashboard is a pure server component — `getProjectsWithStats()` runs on every navigation to `/dashboard`. No cache, no stale data, always fresh. Fine for correctness but means every back-navigation re-runs the DB query.

---

## Files Referenced

- `src/app/project/[id]/useProjectData.ts` — data fetching orchestrator
- `src/app/project/[id]/useBoardHandlers.ts` — all board mutations
- `src/app/project/[id]/useLabelHandlers.ts` — label mutations
- `src/app/project/[id]/ProjectContent.tsx` — loading gate and skeleton
- `src/lib/store/boardStore.ts` — Zustand board store with persist
- `src/lib/actions/board.ts` — server actions for board
- `src/components/board/useBoardKeyboardShortcuts.ts` — shortcut hook
- `src/config/defaults.ts` — DEFAULT_SHORTCUTS definition
- `src/stores/themeStore.ts` — shortcut storage
- `src/components/ui/Toast.tsx` — toast system (unused by mutations)
- `src/app/layout.tsx` — ToastContainer mount point
- `src/components/velocity/VelocityTab.tsx` — text loading state
- `src/components/trophy/TrophyRoom.tsx` — text loading state
