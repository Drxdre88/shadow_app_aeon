# Architectural Reconnaissance: Three Features
Date: 2203 (22 March 2026)

## Executive Summary

All three features have significant infrastructure already in place. Feature 3 (cross-project transfer) is partially built for tasks but zero for columns. Feature 2 (touch drag) has the TouchSensor registered but misconfigured for mobile. Feature 1 (column delete with confirmation) needs a new modal only - the delete plumbing is complete.

---

## Feature 1: Column Delete with Confirmation

### Current State

Column deletion is fully wired end-to-end but fires immediately with zero confirmation:

**Flow:**
```
ColumnContextMenu.handleDelete()
  -> removeColumn(columnId)          [boardStore - optimistic]
  -> onColumnDelete?.(columnId)      [prop callback]
    -> TaskBoard.handleColumnDelete()
      -> onColumnDelete?.(columnId)   [prop callback]
        -> useBoardHandlers.handleColumnDelete()
          -> deleteColumnAction(columnId, projectId)  [server action]
            -> _deleteColumn(columnId, projectId)     [data layer - SQL DELETE]
```

**Critical DB behavior:** `boardTasks.columnId` references `boardColumns.id` with `{ onDelete: 'set null' }`. This means deleting a column does NOT delete the tasks - they become "orphaned" with `columnId = null`. The UI removes the column from the store but orphaned tasks remain in `boardStore.tasks` (with no column assignment), invisible but still consuming DB rows. The current `removeColumn` in boardStore only removes the column record, not the tasks inside it.

**Where the trash icon should live:** `KanbanColumn.tsx` lines 311-331, inside the header button row alongside the existing Palette button. The `Palette` button is at line 313. A `Trash2` button should follow it.

**The color picker dropdown** renders at line 333-378, absolutely positioned via `ref={colorPickerRef}`. The trash icon does NOT need to open a dropdown - it should trigger a confirmation modal.

**Existing confirmation modal pattern:** `VaultDaysModal.tsx` is the canonical reference:
- Uses `createPortal(...)` to `document.body`
- `motion.div` with backdrop overlay `bg-black/60 backdrop-blur-sm`
- Spring animation `{ type: 'spring', damping: 25, stiffness: 300 }`
- Two-button layout: Cancel (slate) + Confirm (danger color)
- Escape key handler via `useEffect`
- `isOpen` prop gates render

**What the confirmation modal needs to show:**
- Column name
- Count of tasks that will be deleted (need to derive from `tasks.filter(t => t.columnId === columnId).length`)
- Cancel / Delete (red) buttons

**DB impact:** The current `deleteColumn` data layer only deletes the board_column row. Tasks get `columnId = null` (set null FK). The confirmation modal must decide: delete tasks too (requires a new batch delete action), or let them orphan. Trello deletes all cards. The implementation should call `deleteBoardTask` per task before calling `deleteColumn`, OR add a new `deleteColumnWithTasks` server action.

### Files to Modify

| File | Change |
|------|--------|
| `src/components/board/KanbanColumn.tsx` | Add Trash2 icon button next to Palette; add `showDeleteConfirm` state; wire to new modal |
| `src/components/board/ColumnDeleteModal.tsx` | NEW - confirmation modal following VaultDaysModal pattern |
| `src/lib/actions/columns.ts` | Add `deleteColumnWithTasks(columnId, projectId)` server action |
| `src/lib/data/columns.ts` | Optionally add helper for delete+tasks; or reuse existing board.ts batch delete |

**Alternative approach:** Add the modal directly into `ColumnContextMenu.tsx` (where handleDelete already lives). This is actually cleaner - intercept `handleDelete`, show a local confirmation state, then proceed. But the context menu dismisses on outside click, which creates race conditions. A portal modal survives the context menu closing.

### Pitfalls

1. **Orphaned tasks:** Current DB cascade is `set null`, not `cascade`. Without explicitly deleting tasks, they become invisible ghosts in the DB and remain in Zustand store until page reload.
2. **boardStore.removeColumn does not remove tasks.** Must call `removeTask` for each task in the column before or after removing the column.
3. **Context menu conflict:** The context menu already has a Delete button at line 224-232 in `ColumnContextMenu.tsx`. Adding a second path (trash icon in header) means two delete triggers. Both must route to the same confirmation. Decide: keep header icon only, or header icon + context menu item both trigger the modal.

---

## Feature 2: Phone Card Dragging

### Current State

**TouchSensor IS registered** in `useBoardDnD.ts` lines 25-28:
```typescript
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
)
```

The same config exists in `GanttChart.tsx` lines 37-38.

### Why Touch Dragging Still Fails on Mobile

**Root cause 1 - The entire card is the drag handle.** In `SortableTaskCard.tsx` lines 149-162:
```typescript
<motion.div
  {...attributes}
  {...listeners}   // <-- drag listeners on the entire card
  onClick={onEdit}
  onContextMenu={handleContextMenu}
  className="cursor-grab active:cursor-grabbing"
```
The `attributes` and `listeners` from `useSortable` are spread on the entire motion.div. On touch devices, any tap on the card ambiguously fires both click (edit) and drag. dnd-kit resolves this via `delay` in TouchSensor, but the 200ms delay means you must hold 200ms before the drag starts. This works, but the problem is...

**Root cause 2 - No touch action CSS override.** The board's scroll container in `TaskBoard.tsx` lines 296-299:
```
'flex flex-nowrap gap-4 pb-4 overflow-visible sm:overflow-auto sm:max-h-[calc(100vh-140px)]'
```
Mobile browsers intercept touch events for scrolling. dnd-kit requires `touch-action: none` on draggable elements to prevent browser scroll from stealing the touch event. The `SortableTaskCard` motion.div has no `touch-action: none` style. This causes the browser to swallow touch drags as scroll gestures.

**Root cause 3 - The column also needs touch-action.** `SortableColumn.tsx` wraps the entire column with `useSortable` listeners passed down as `dragHandleProps` and spread on the header div in `KanbanColumn.tsx` line 264. Same problem for column dragging on touch.

### Fix Required

1. Add `style={{ touchAction: 'none' }}` to the motion.div in `SortableTaskCard.tsx` that has the `{...listeners}` spread.
2. Add the same to the column header div in `KanbanColumn.tsx` that spreads `{...dragHandleProps}`.
3. The existing TouchSensor config (delay: 200, tolerance: 5) is correct and does not need changing.

**Alternative - dedicated drag handle:** Instead of the full card being draggable, add a grip icon (GripVertical from lucide) that appears on hover. Move `{...listeners}` to that element only. This solves both the tap-vs-drag ambiguity and touch-action scope. Pattern to follow: `SortableColumn.tsx` already uses the render-prop pattern passing `dragHandleProps` - the same pattern can be applied to task cards.

### Files to Modify

| File | Change |
|------|--------|
| `src/components/board/SortableTaskCard.tsx` | Add `style={{ touchAction: 'none' }}` to the motion.div with `{...listeners}`, OR move listeners to a dedicated grip handle |
| `src/components/board/KanbanColumn.tsx` | Add `touch-action: none` to the header div that spreads `dragHandleProps` (line 263) |

### Pitfalls

1. `touch-action: none` on a large element disables scroll within that element on mobile. Cards are not scrollable, so this is safe. But columns scroll their task list internally - do NOT put `touch-action: none` on the scroll container.
2. The Gantt chart (`GanttChart.tsx`) uses the same sensor config and likely has the same problem, but it's a separate component and out of scope here.
3. Testing on iOS Safari is required - iOS has historically eaten dnd-kit touch events even with correct configuration due to its aggressive gesture detection.

---

## Feature 3: Move/Copy Cards and Columns Between Projects

### Current State - Tasks (Substantially Built)

Task cross-project transfer is **fully implemented**:

**Server actions** in `src/lib/actions/transfer.ts`:
- `listProjectsForTransfer()` - fetches all user projects + their columns
- `copyTaskToProject(taskId, sourceProjectId, targetProjectId, targetColumnId?)` - creates new task + copies checklist items
- `moveTaskToProject(taskId, sourceProjectId, targetProjectId, targetColumnId?)` - SQL UPDATE of `projectId` + `columnId` + resets `status`, `onTimeline`, `ganttTaskId`

**UI** in `TaskContextMenu.tsx` lines 266-338:
- "Copy to Project..." menu item with submenu loading projects
- "Move to Project..." menu item sharing the same submenu
- Both use `transferMode: 'copy' | 'move'` state to switch behavior
- Imports: `listProjectsForTransfer, copyTaskToProject, moveTaskToProject`
- The submenu shows all projects except the current one, user clicks a project name to transfer

**Gap in current implementation:** The transfer submenu does NOT allow choosing a specific column in the target project - it always lands in `columns[0]` (the first column). The `copyTaskToProject` and `moveTaskToProject` both accept `targetColumnId?` but the UI never passes one.

### Current State - Columns (Not Built)

Zero column transfer infrastructure exists:
- No `copyColumnToProject` or `moveColumnToProject` server action
- No UI in `ColumnContextMenu.tsx` for cross-project transfer
- The `listProjectsForTransfer()` action already returns column data for each project, so the project picker is reusable

### What's Needed for Column Transfer

**Data model analysis:**
- `boardColumns` has `projectId` as a non-nullable FK
- Tasks inside a column have both `projectId` and `columnId`
- Moving a column means: (1) UPDATE `boardColumns.projectId`, (2) UPDATE all child tasks `projectId` + `columnId` stays the same
- Copying a column means: (1) INSERT new column in target project, (2) for each task: INSERT new task with new `projectId` and new `columnId`

**Schema FK constraints:** `boardTasks.columnId` references `boardColumns.id` with `onDelete: set null`. Since both task and column have `projectId` fields, they must be kept in sync - a column in project A cannot contain tasks in project B.

**New server actions needed** in `src/lib/actions/transfer.ts`:
```typescript
copyColumnToProject(columnId, sourceProjectId, targetProjectId)
moveColumnToProject(columnId, sourceProjectId, targetProjectId)
```

`copyColumn` logic:
1. Load column + all its tasks
2. INSERT new column in targetProjectId (with same name/color/icon, new orderIndex at end)
3. For each task: `createTask(targetProjectId, {...taskData, columnId: newColumnId})`
4. Copy checklist items for each task

`moveColumn` logic:
1. Load column record
2. UPDATE `boardColumns.projectId = targetProjectId`, `orderIndex = max+1`
3. UPDATE all `boardTasks` WHERE `columnId = columnId` SET `projectId = targetProjectId`
4. Reset `onTimeline = false`, `ganttTaskId = null` on all moved tasks (they can't be on target project's gantt)

**UI placement:** `ColumnContextMenu.tsx` - add two new `ContextMenuButton` items after the existing Copy ID button, following the exact same pattern as the task context menu's "Copy to Project..." and "Move to Project..." items.

### Architecture of the Existing Transfer UI Pattern

```
ContextMenuButton "Copy to Project..."
  onClick ->
    setTransferMode('copy')
    setSubmenu('transfer')
    listProjectsForTransfer().then(setTransferProjects)

Inline submenu (when submenu === 'transfer'):
  for each project (filtered to exclude current):
    button onClick ->
      copyTaskToProject(taskId, task.projectId, project.id)
      onClose()
```

The column context menu should replicate this verbatim, replacing the task-specific server action calls.

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/actions/transfer.ts` | Add `copyColumnToProject`, `moveColumnToProject` |
| `src/components/board/ColumnContextMenu.tsx` | Add "Copy to Project..." and "Move to Project..." menu items with same submenu pattern |
| `src/app/project/[id]/useBoardHandlers.ts` | Optionally: column transfer doesn't need a handler here since the store update (removeColumn) can be done directly in the context menu like `moveTaskToProject` does with `removeTask` |

### Data Integrity Risks for Column Transfer

1. **Gantt links:** Tasks with `onTimeline = true` and `ganttTaskId != null` are linked to gantt records in the source project. Moving them to a different project breaks those links. `moveColumnToProject` must null out `ganttTaskId` and set `onTimeline = false` on all tasks.
2. **Dependencies:** `taskDependencies` links tasks by ID only (no projectId). If task A in column X depends on task B in another column, and only column X is moved, the dependency FK remains valid but now crosses projects. This is a silent consistency problem. The implementation should warn or strip cross-project dependencies.
3. **Labels:** `labels` are project-scoped. Tasks carry `labelId` references via `taskLabels` junction table. Moving a task to another project invalidates its label associations (label IDs from project A don't exist in project B). Current `moveTaskToProject` does NOT handle this - it leaves dangling `taskLabels` rows pointing to labels in the source project. Column move inherits this problem.
4. **orderIndex:** The new column needs `orderIndex = max(existing columns in target) + 1`. Must query before inserting.

---

## Component Relationship Map

```
ProjectContent.tsx / page.tsx
  useBoardHandlers(projectId)          <- all column/task CRUD handlers
  TaskBoard (component)
    useBoardDnD                        <- DnD sensor setup + drag logic
    DndContext (dnd-kit)
      SortableContext (columns)
        SortableColumn                 <- useSortable per column, passes dragHandleProps
          KanbanColumn                 <- renders header, color picker, task list
            SortableContext (tasks)
              SortableTaskCard         <- useSortable per task, FULL CARD is drag handle
                TaskContextMenu        <- right-click, has Move/Copy to Project already
            ColumnContextMenu          <- right-click on header, has Delete (no confirm)
```

## Cross-Feature Dependencies

- Feature 1 (column delete confirm) and Feature 3 (column transfer) both modify `ColumnContextMenu.tsx`. Implement in the same pass to avoid conflicts.
- Feature 2 (touch drag) is fully isolated to `SortableTaskCard.tsx` and `KanbanColumn.tsx` header styling.

---

## Strategic Recommendations

**Feature 1 - Build order:**
1. Create `ColumnDeleteModal.tsx` (copy VaultDaysModal structure, simplify to Yes/No)
2. Add state `deleteConfirmColumnId: string | null` to `KanbanColumn`
3. Add Trash2 button in header OR intercept context menu delete
4. Add `deleteColumnWithTasks` server action that deletes tasks first then column
5. Call `removeTask` for each column task in boardStore before `removeColumn`

**Feature 2 - Build order:**
1. Add `style={{ touchAction: 'none' }}` to `SortableTaskCard.tsx` motion.div with listeners - test immediately
2. If still broken, add dedicated drag handle grip icon (GripVertical) and move listeners there
3. Add same touch-action to column drag handle in `KanbanColumn.tsx`

**Feature 3 - Build order:**
1. Add `copyColumnToProject` + `moveColumnToProject` to `transfer.ts`
2. Add the two menu items to `ColumnContextMenu.tsx`
3. Add column-level project picker submenu (reuse `listProjectsForTransfer` - already returns per-project columns)
4. Bonus: allow user to pick the target column for task transfer (currently always lands in column[0])
