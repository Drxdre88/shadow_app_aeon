# Gantt Chart Task Overlap -- Code Quality Review
**Date:** 14/03/2026
**Reviewed by:** shadow-judge
**Severity:** Critical

## Context
User reports tasks are superimposed/overlapping instead of properly row-aligned in the Gantt chart.

## Files Reviewed
- `src/components/gantt/GanttChart.tsx` (primary -- all 3 bugs originate here)
- `src/components/gantt/RowContainer.tsx` (interacting component)
- `src/components/gantt/TaskBar.tsx` (consumer of style props)
- `src/lib/store/ganttStore.ts` (data model)

## Root Cause Analysis

### Bug 1: top computed relative to chart, rendered relative to row
`getTaskStyle` line 73: `top: rowIndex * ROW_HEIGHT + 8`

TaskBars are children of RowContainer which uses `position: relative` on its content div.
TaskBar uses `position: absolute`. Therefore `top` resolves against the RowContainer, not the chart.

Row 0: top = 8px (correct by accident)
Row 1: top = 64px (64px below a 56px container = invisible)
Row 2: top = 120px (way off-screen within its row)

### Bug 2: No task-within-row indexing
All tasks sharing a rowId get identical `top` values. 5 tasks in one row = 5 bars stacked at the same pixel.

### Bug 3: Fixed row height ignores task count
`height={ROW_HEIGHT}` is always 56px. Task bar is 40px + padding. Multiple tasks per row are clipped.

## Fix Summary
1. Compute rowTaskCounts map (rowId -> count)
2. Dynamic getRowHeight function: `max(56, count * (40 + 4) + 8)`
3. Pass taskIndexInRow to getTaskStyle: `top = taskIdx * (40 + 4) + 4`
4. Pass dynamic height to RowContainer instead of fixed ROW_HEIGHT

## Follow-up
- Verify drag-and-drop still works with dynamic row heights (should, dnd-kit uses DOM rects)
- Consider time-overlap detection for horizontal stacking (future enhancement)
