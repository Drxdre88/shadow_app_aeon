# Gantt-Board Bridge

**Date:** 14.03.2026 | **Package:** aeon | **Risk:** Medium

---

## Problem Statement

Aeon's Board (Kanban) and Gantt views are fully independent systems. A user creates tasks on the board, then must manually recreate them on the Gantt with duplicate names and dates. There is no synchronization: completing a board task does not update the Gantt bar, dragging a Gantt bar does not update the board card's dates, and deleting a board task leaves orphaned Gantt entries.

The existing schema has scaffolding for this bridge (`boardTasks.ganttTaskId` FK and `boardTasks.onTimeline` boolean), but no logic connects them. The Gantt also lacks the concept of "views" -- it shows a single flat timeline per project with manually-created rows and tasks.

Users need: (1) multiple saved Gantt views per project with configurable grouping and filtering, (2) a one-click "Push to Gantt" action from board cards that auto-generates Gantt tasks with smart defaults, (3) a `size` field on board tasks to control Gantt bar duration, and (4) bidirectional sync so changes in either view propagate to the other.

## Solution Approach

- **New `gantt_views` table**: stores per-project named views with groupBy mode and JSONB filters
- **New `size` column on `board_tasks`**: nullable numeric (half-day increments), drives Gantt bar duration
- **New `ganttViewId` column on `rows`**: links auto-generated rows to a specific Gantt view
- **Row generation engine**: server action that creates rows from board state (by column, label, dependency chain, or priority)
- **Push-to-Gantt action**: creates a `gantt_task`, links it via `ganttTaskId`, sets `onTimeline = true`, computes smart default dates from task size/priority/dependencies
- **Bidirectional sync hooks**: board status=done sets Gantt progress=100%; Gantt bar drag updates board dates; checklist completion % drives Gantt progress; board task delete cascades to Gantt task (already handled by FK `onDelete: 'set null'` -- needs change to `cascade`)
- **Gantt view selector UI**: dropdown in Gantt header to switch/create views
- **Size badge UI**: small numeric badge on board cards, editable in task edit modal

## Schema Changes

| Table | Change |
|-------|--------|
| `board_tasks` | Add `size` column (numeric, nullable) |
| `rows` | Add `gantt_view_id` column (FK to gantt_views, nullable) |
| `gantt_views` | **New table**: id, projectId, name, groupBy, filters, createdAt |
| `board_tasks.ganttTaskId` | Change `onDelete` from `set null` to `cascade` |

## Key UI Flows

1. **Create Gantt View**: Gantt tab header dropdown -> "New View" -> pick name + groupBy mode + optional filters -> rows auto-generated
2. **Push to Gantt**: Board card context menu or edit modal -> "Push to Gantt" -> pick target view -> Gantt task created, card shows "On timeline" badge
3. **Size Field**: Edit modal gets a size input (numeric with half-day steps) -> visible as badge on card -> drives Gantt bar width
4. **Sync**: Board done -> Gantt 100%. Gantt drag -> board dates updated. Checklist progress -> Gantt progress bar.

## Risk Assessment

- **Migration complexity**: Adding columns to existing tables with live data. Mitigate with nullable defaults and non-destructive migration.
- **Sync race conditions**: Board and Gantt can be open in separate tabs. Mitigate by making server actions the source of truth and using revalidatePath.
- **FK cascade change**: Changing `ganttTaskId` onDelete from `set null` to `cascade` means deleting a gantt task also affects board tasks' FK reference. Actually, we want the reverse: deleting a *board task* should cascade-delete the *gantt task*. The current FK direction is boardTask -> ganttTask, so deleting a ganttTask sets boardTask.ganttTaskId to null (correct). Deleting a boardTask does NOT auto-delete the ganttTask. Need to handle this in the delete action, not FK.
- **Row stale state**: If board columns/labels change after row generation, rows become stale. Mitigate with a "Regenerate Rows" button and visual staleness indicator.
- **Performance**: Generating rows for large boards (100+ tasks). Acceptable -- single DB query + in-memory grouping.

## Success Criteria

- [ ] Multiple Gantt views per project, each with independent grouping
- [ ] Board tasks pushable to any Gantt view with one action
- [ ] Size field on board tasks drives Gantt bar duration
- [ ] Smart default dates (today-based, priority-based duration, dependency-aware)
- [ ] Board status=done sets Gantt progress=100%
- [ ] Gantt bar drag updates board card start/end dates
- [ ] Checklist completion % reflected in Gantt progress bar
- [ ] Board task deletion removes linked Gantt task
- [ ] Half-day granularity in Gantt day scale (AM/PM slots)

## Files Modified

### New Files
- `src/lib/db/schema.ts` -- add `ganttViews` table, `size` column, `ganttViewId` column
- `src/lib/data/ganttViews.ts` -- CRUD for gantt_views table
- `src/lib/actions/ganttViews.ts` -- server actions for view management
- `src/lib/actions/bridge.ts` -- push-to-gantt, sync actions, row generation
- `src/lib/data/bridge.ts` -- data layer for bridge operations
- `src/lib/data/validators.ts` -- add ganttView schemas, update task schema for size
- `src/components/gantt/GanttViewSelector.tsx` -- dropdown for switching/creating views
- `src/components/board/TaskSizeBadge.tsx` -- size display badge for cards

### Modified Files
- `src/lib/db/schema.ts` -- schema additions
- `src/lib/data/validators.ts` -- new validators
- `src/lib/store/boardStore.ts` -- add size to BoardTask interface
- `src/lib/store/ganttStore.ts` -- add activeViewId, views list, boardTaskId on GanttTask
- `src/lib/actions/board.ts` -- add bridge sync on status change, add size to create/update
- `src/lib/actions/gantt.ts` -- add bridge sync on bar drag
- `src/lib/actions/checklist.ts` -- trigger Gantt progress update on checklist change
- `src/components/board/SortableTaskCard.tsx` -- show size badge, show push-to-gantt in context menu
- `src/components/board/TaskEditModal.tsx` -- add size input, push-to-gantt button
- `src/components/board/TaskContextMenu.tsx` -- add "Push to Gantt" menu item
- `src/components/gantt/GanttChart.tsx` -- view selector, half-day slots, bridge-aware rendering
- `src/components/gantt/TimelineHeader.tsx` -- AM/PM sub-columns for day scale
- `src/app/project/[id]/ProjectContent.tsx` -- load gantt views, pass bridge handlers
