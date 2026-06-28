# PM App Surface

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

Aeon's project-management surface is a multi-view workspace built on a Zustand-backed
optimistic store with a durable offline save pipeline. The primary surface is the kanban
**Board**; alternate views are **Gantt**, **Canvas**, **Trophy/Vault**, and **Velocity**.
Projects live inside **Realms** (workspaces) and roll up under Kairos **Dominions**. The
whole UI honours a single master motion switch and a 151-preset theming engine.

## 1. Board (Kanban)

The flagship surface: a virtualized, drag-and-drop kanban with full task CRUD, rich card
metadata, and an always-on durable save pipeline.

### Drag & drop, columns, cards
- DnD via `@dnd-kit` with a custom drag preview and trash drop zone (`useBoardDnD.ts`, `DragPreview.tsx`, `TrashDropZone.tsx`).
- Columns: add/rename/recolor/delete + reorder (`AddColumnButton.tsx`, `KanbanColumn.tsx`, `SortableColumn.tsx`, `ColumnContextMenu.tsx`, `ColumnDeleteModal.tsx`).
- Cards rendered by `SortableTaskCard.tsx` (memoized); `tasksByColumn` Map pre-computed in `TaskBoard.tsx`.

### Task CRUD / metadata
- Inline quick-add (`QuickAddTask.tsx`) + full modal edit (`TaskEditModal.tsx`) + per-card menu (`TaskContextMenu.tsx`); card title/description **autosave**.
- **Checklist** (tri-state, grouped, sortable; atomic ordering via `db.transaction()`), **Labels** (per-project), **Dependencies** (blocker/blocked + overlay + glow tree), **Comments** (threaded), **Sizing/stale/peek**, **Dates**.

### Assignees + avatar pile (shipped)
- Multi-assign overlay on the **M hotkey** / on hover (`TaskAssigneeOverlay.tsx`, `lib/data/assignees.ts`).
- The assignable list includes **owner + explicit project members + realm members** via `findAssignableMembers()` (`lib/data/members.ts:27`) — previously projectMembers-only (commit `22b281a`).
- **Avatar pile on cards** (commit `95537d0`): overlapping pile (image/initials, `+N` overflow >4) via `AssigneeDot` (`SortableTaskCard.tsx:337,494`). Assignees bulk-load into `boardStore.assigneesByTask`, read via scoped `useTaskAssignees(taskId)`; overlay writes through to the store so the pile updates live.

### Filtering, shortcuts, palette, performance
- Filter bar (text + priority + label + column + date), customizable keyboard shortcuts, Cmd+K command palette, TanStack Virtual at a 15+ card threshold, project nav prefetched on hover.

### Optimistic UI + never-asleep durable save queue
The snapshot-rollback optimistic path is now backed by a durable, offline-safe pipeline (commit `fc9806c`):
- **`persistMutation` / `withRetry`** (`lib/store/persistMutation.ts`): retries transient failures (Neon cold-start resume, dropped socket, 502/503/504) over a `[400,1000,2200]`ms ladder (~3.6s, 4 attempts) before any rollback; hard rejections fail fast.
- **Durable mutation queue** (`lib/store/mutationQueue.ts`): `zustand/persist` over localStorage (`aeon-mutation-queue`), FIFO for causal order, idempotent replay. Edits survive tab close / hours offline and re-sync on `online`, tab-visible, and once on load. Rollback/onSuccess closures live in an in-memory Map (non-durable; replay self-heals).
- **SaveStatusPill** (`components/board/SaveStatusPill.tsx`): live Saving / Reconnecting / Offline (N) / Saved signal.

## 2. Gantt
Day/week/month-scale Gantt with saved views + swimlanes (`components/gantt/`, `lib/store/ganttStore.ts`, `lib/data/gantt.ts` + `ganttViews.ts`). Bidirectional FK `boardTasks ↔ ganttTasks`.

## 3. Canvas
ReactFlow whiteboard (`components/canvas/CanvasView.tsx`, `lib/store/canvasStore.ts`). REST-only (no MCP tools by design).

## 4. Trophy / Vault
Archived-task archive + stats + timeline (`components/trophy/`). Batch archiving via `BatchVaultModal.tsx` + `lib/actions/vault.ts` (`snapshotTaskDataBatch`); `taskVault` snapshot table.

## 5. Velocity
Throughput / cycle-time / heatmap analytics (`components/velocity/`, `lib/data/velocity.ts`).

## 6. Realms (workspaces)
Full CRUD + 7-day email invites + scoped project visibility (`components/workspace/`, `lib/data/workspaces.ts`). 6-route REST API + 14 MCP tools. Realm members flow into the assignee list (§1).

## 7. Notes bento
`/notes` bento grid of Kairos memories with today's auto-captures strip, a neighbours panel, and Promote-to-Card (`components/notes/`).

## 8. Sidebar
Home glowing pinned entry, Today/utility bottom pills, Kairos pill + Setup/Guide, per-project/per-realm hide toggle (`SidebarHome.tsx`, `SidebarBottom.tsx`, `KairosSidebarSection.tsx`, `sidebarStore.ts`).

## 9. Theming, effects, celebrations, motion
- **Theming**: 151 presets across 17 categories (`packages/shared/src/config/themes/`, `stores/themeStore.ts`) — glow, glass, saturation, fonts, per-project board themes, Business Mode.
- **Visual effects (13)** + **Celebrations (6)**.
- **Smooth UI Renders master motion toggle** (commit `056d8f2`), default ON; OFF makes the app instant via a global `html[data-reduce-motion='true']` stylesheet (`globals.css:208`), Framer `MotionConfig reducedMotion="always"` (`ThemeProvider.tsx:104`), and gated JS timers. State `smoothUiRenders` on `themeStore` (`useSmoothUiRenders()`, `themeStore.ts:407`).

## 10. Project CRUD + views / share / export
Create/edit/delete/realm-assign (`components/project/`); Space/Tree/Grid views; email invite + read-only public snapshot (`board/ShareModal.tsx`, `app/share/[token]/`, `boardSnapshots`); full JSON export (`api/export/route.ts`).

## Feature Inventory (PM surface)

| Feature | Status | Key Files |
|---|---|---|
| Board (Kanban) + DnD | Complete | `components/board/TaskBoard.tsx`, `useBoardDnD.ts` |
| Task CRUD / modal / context menu / autosave | Complete | `TaskEditModal.tsx`, `TaskContextMenu.tsx`, `QuickAddTask.tsx` |
| Checklist / Labels / Dependencies / Comments | Complete | `board/checklist/`, `LabelPicker.tsx`, `TaskDependencySection.tsx`, `TaskComments.tsx` |
| Sizing / stale / peek | Complete | `TaskSizeBadge.tsx`, `StaleIndicator.tsx`, `CardPeekPreview.tsx` |
| Assignees (overlay, M-hotkey, owner+realm) | Complete | `TaskAssigneeOverlay.tsx`, `lib/data/members.ts:27` |
| **Avatar pile on cards** | Complete | `SortableTaskCard.tsx:337,494`, `boardStore.assigneesByTask` |
| Filtering / shortcuts / palette / virtual scroll | Complete | `BoardFilterBar.tsx`, `VirtualizedTaskList.tsx`, `ui/CommandPalette.tsx` |
| **Never-asleep durable save queue** | Complete | `lib/store/mutationQueue.ts`, `persistMutation.ts`, `SaveStatusPill.tsx` |
| Gantt + saved views | Complete | `components/gantt/`, `lib/data/gantt.ts` |
| Canvas (whiteboard) | Complete | `components/canvas/CanvasView.tsx` |
| Trophy / Vault (+ batch archive) | Complete | `components/trophy/`, `BatchVaultModal.tsx` |
| Velocity analytics | Complete | `components/velocity/` |
| Realms + invites + REST | Complete | `components/workspace/`, `api/v1/realms/` |
| Notes bento + promote-to-card | Complete | `components/notes/`, `PromoteToCardModal.tsx` |
| Theming (151 presets) / effects / celebrations | Complete | `packages/shared/src/config/themes/` |
| **Smooth UI Renders master toggle** | Complete | `themeStore.ts:407`, `ThemeProvider.tsx:104`, `globals.css:208` |
| Project CRUD + Space/Tree/Grid | Complete | `components/project/` |
| Share / read-only snapshot / export | Complete | `board/ShareModal.tsx`, `api/export/route.ts` |

## State Management (Zustand v5)

| Store | Manages | File | Persistence |
|---|---|---|---|
| `useBoardStore` | columns, tasks, labels, deps, checklists, **assigneesByTask**, selection, filters, **saveStatus/isDirty** | `lib/store/boardStore.ts` | `zustand/persist` |
| `useMutationQueue` | durable FIFO mutation queue | `lib/store/mutationQueue.ts` | `zustand/persist` (localStorage; records only) |
| `useCanvasStore` | canvas nodes/edges/selection | `lib/store/canvasStore.ts` | `zustand/persist` |
| `useGanttStore` | gantt tasks/rows/views/scale | `lib/store/ganttStore.ts` | `zustand/persist` |
| `useUndoStore` | undo stack (max 20) | `lib/store/undoStore.ts` | in-memory |
| `useThemeStore` | theme, colors, fonts, effects, shortcuts, **smoothUiRenders** | `stores/themeStore.ts` | hydrates from DB |
| `useSidebarStore` | collapsed, active realm, hidden ids | `stores/sidebarStore.ts` | `zustand/persist` |
| `useKairosStore` | selected memory id, refresh signal | `stores/kairosStore.ts` | in-memory |
| `useKairosVisorStore` | Visor open + active thread id | `stores/kairosVisorStore.ts` | active thread id only |
| `useKairosPrefsStore` | Kairos view prefs (graph / Aether lens) | `stores/kairosPrefsStore.ts` | `zustand/persist` |
