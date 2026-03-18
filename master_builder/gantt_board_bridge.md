# Gantt-Board Bridge Build Log

**Date:** 14.03.2026 | **Status:** Built, needs DB migration + testing

---

## Pre-requisite: DB Migration

Run before testing anything:
```bash
npx drizzle-kit generate
npx drizzle-kit push
```

Expected SQL:
- CREATE TABLE `gantt_views` (id, project_id, name, group_by, filters, created_at)
- ALTER TABLE `rows` ADD COLUMN `gantt_view_id` (FK to gantt_views, cascade delete)
- ALTER TABLE `board_tasks` ADD COLUMN `size` (real, nullable)
- ALTER TABLE `gantt_tasks` ADD COLUMN `board_task_id` (FK to board_tasks, cascade delete)

---

## What to Test

### 1. Gantt View Creation
- Go to Gantt tab
- Click the view selector dropdown (shows "Select View")
- Click "New View"
- Enter a name, pick a groupBy mode (Column / Label / Priority / Dependency Chain)
- Click Create
- Verify: rows auto-generated matching the groupBy mode
- Try switching between multiple views
- Try deleting a view

### 2. Task Size Field
- Open any board card (edit modal)
- Find the "Size (days)" input below priority
- Set to 1.5 (half-day increments, 0.5 steps)
- Save and verify the cyan `1.5d` badge appears on the card
- Clear the size field -- verify it shows "Auto" with priority-based hint

### 3. Push to Gantt
- Prerequisite: create at least one Gantt view first
- Right-click a board card -> "Push to Gantt" (only shows if not already on timeline)
- OR open edit modal -> "Push to Gantt" button at bottom
- Switch to Gantt tab -- verify the task appears as a bar in the correct row
- If no Gantt view exists, clicking Push to Gantt navigates to Gantt tab

### 4. Bidirectional Status Sync
- Push a board task to Gantt
- Move the board card to "Done" column
- Switch to Gantt tab -- verify the task bar shows 100% progress
- Move it back to a non-done column -- progress should reflect checklist %

### 5. Bidirectional Date Sync
- Push a board task to Gantt
- Drag the Gantt bar to a new date range
- Switch to Board tab, open the card -- dates should be updated

### 6. Checklist Progress Sync
- Push a board task to Gantt (with checklist items)
- Check/uncheck checklist items
- Switch to Gantt tab -- progress bar should reflect checklist completion %

### 7. Timeline Header AM/PM
- Switch Gantt to "Day" time scale
- Verify each day column shows AM/PM sub-slots
- Drag a task -- should snap to half-day increments

### 8. Row Generation Modes
Test each groupBy when creating a view:
- **By Column**: rows match your board columns (Todo, Doing, Review, Done)
- **By Label**: rows match your labels + "Untagged" row
- **By Priority**: rows = Urgent, High, Medium, Low
- **By Dependency Chain**: rows = root task names of each chain + "Independent"

### 9. Board Task Deletion Cascade
- Push a task to Gantt
- Delete the board task
- Verify the linked Gantt task is also removed

---

## Files Created (7 new)

| File | Purpose |
|------|---------|
| `src/lib/data/ganttViews.ts` | CRUD data layer for gantt views |
| `src/lib/data/bridge.ts` | Bridge ops: push, sync, row generation |
| `src/lib/actions/ganttViews.ts` | Server actions for view management |
| `src/lib/actions/bridge.ts` | Push-to-gantt server action |
| `src/components/gantt/GanttViewSelector.tsx` | View switching dropdown |
| `src/components/board/TaskSizeBadge.tsx` | Cyan size badge for cards |
| `master_builder/gantt_board_bridge.md` | This file |

## Files Modified (14)

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | ganttViews table, size column, boardTaskId, ganttViewId |
| `src/lib/data/validators.ts` | ganttView schemas, size on task schemas, boardTaskId |
| `src/lib/data/tasks.ts` | size in create/update |
| `src/lib/data/gantt.ts` | boardTaskId in create/update |
| `src/lib/actions/board.ts` | sync on status change + delete cascade, size param |
| `src/lib/actions/gantt.ts` | sync dates back to board on drag |
| `src/lib/actions/checklist.ts` | sync progress to gantt on item changes |
| `src/lib/store/boardStore.ts` | ganttTaskId, size on BoardTask interface |
| `src/lib/store/ganttStore.ts` | views, activeViewId, boardTaskId, GanttView interface |
| `src/components/board/TaskBoard.tsx` | onPushToGantt prop, formData.size |
| `src/components/board/KanbanColumn.tsx` | onPushToGantt prop threading |
| `src/components/board/SortableTaskCard.tsx` | size badge, onPushToGantt |
| `src/components/board/TaskEditModal.tsx` | size input, push-to-gantt button |
| `src/components/board/TaskContextMenu.tsx` | push-to-gantt menu item |
| `src/components/gantt/GanttChart.tsx` | view-aware rendering, half-day snap, 120px day cells |
| `src/components/gantt/TimelineHeader.tsx` | AM/PM sub-slots for day scale |
| `src/app/project/[id]/ProjectContent.tsx` | view loading, handlers, wiring |

---

## Known Gaps (not yet built)

- Gantt dependency arrows (visual connectors between gantt bars)
- Critical path highlighting
- Gantt milestone markers
- Gantt task creation from timeline click
- Gantt zoom-to-fit
- Gantt row reorder drag
- "Regenerate Rows" button when board structure changes
