# Aeon Five Pillars Roadmap

**Date:** 14.03.2026 | **Status:** Active

---

## The Big 5 Feature Pillars

### PILLAR 1: Board Polish (90% done)

1. Verify checklist summary badge renders on cards
2. Verify arrow connector style on dependency canvas
3. Wire QuickAddTask into columns (DONE)
4. Ensure TaskChecklist renders inside TaskEditModal (DONE)
5. Labels end-to-end: create, assign, display, filter (DONE)
6. Column drag-reorder persistence
7. Bulk task operations (select multiple, move/delete/label)
8. Task search (quick filter by name across all columns)
9. Card color picker from context menu
10. Keyboard shortcuts (t=new task, l=label, g=glow)
11. Undo/redo for task moves (zustand temporal middleware)
12. Archive column (done tasks auto-archive after X days)
13. Task count per column in header (DONE)
14. Drag-to-trash animation polish
15. Mobile responsive breakpoints

### PILLAR 2: Gantt <> Board Bridge (75% done)

1. Board task to Gantt conversion (DONE - push-to-gantt from context menu + edit modal)
2. Gantt task to Board card back-link (DONE - boardTaskId FK on gantt_tasks)
3. Bidirectional status sync (DONE - done on board = 100% on gantt)
4. Bidirectional date sync (DONE - drag gantt bar = update board dates)
5. Auto-create gantt rows by grouping mode (DONE - column/label/chain/priority)
6. Saved Gantt views (DONE - multiple per project, GanttViewSelector dropdown)
7. Task size field (DONE - half-day increments, size badge on cards)
8. Smart default dates (DONE - priority-based: urgent=0.5d, high=1d, medium=1.5d, low=2.5d)
9. Gantt dependency arrows
10. Critical path highlighting
11. Gantt milestone markers
12. Progress bar driven by checklist completion % (DONE - syncs on checklist changes)
13. Gantt task creation from timeline click
14. Gantt zoom-to-fit
15. Gantt row reorder drag

### PILLAR 3: Memory & History System (0% done)

1. Task completion log (timestamp, who, which column)
2. Activity feed per project (created/moved/completed/deleted events)
3. Task history view (timeline of all changes)
4. Sprint/iteration boundaries
5. Velocity metrics (tasks per week, burndown chart)
6. Completed tasks archive view (searchable, filterable)
7. Task resurrection (restore from archive)
8. Project changelog (auto-generated from activity)
9. Dependency resolution history
10. Time-in-column metrics (how long tasks sit in each state)
11. Recurring tasks (template tasks on schedule)
12. Task templates (save structure for reuse)
13. Export project history (JSON/CSV)
14. Weekly digest summary (AI-generated)
15. Stale task detection (highlight cards stuck X days)

### PILLAR 4: Canvas Brainstorm & Planner (20% skeleton)

1. Enhanced node types (decision, question, reference, action item)
2. Freeform drawing/annotation layer
3. Canvas to Board conversion (select nodes, create tasks)
4. Node clustering / grouping (visual containers)
5. AI idea expansion (Claude generates related ideas)
6. Node linking with typed edges (blocks, relates-to, inspires)
7. Canvas minimap with colored clusters
8. Sticky notes mode (quick text nodes, auto-layout)
9. Image/screenshot paste onto canvas
10. Canvas snapshots (save named views/positions)
11. Template canvases (retrospective, brainstorm, user journey)
12. Node voting/priority (upvote nodes, sort by score)
13. Canvas search (find nodes by text)
14. Node metadata (custom fields per node type)
15. Canvas export (SVG/PNG)
16. Presentation mode (step through nodes in sequence)

### PILLAR 5: MCP & AI Integration (60% done)

1. Ownership verification on all MCP tools (DONE - 22 tools verified)
2. Dependency management tools (DONE)
3. Label management tools (DONE)
4. Checklist tools (create items, toggle state)
5. Column management tools (DONE)
6. project_summary SQL aggregation (DONE)
7. Canvas tools (create/update/delete nodes and edges)
8. Natural language task creation
9. AI sprint planner tool
10. Webhook notifications
11. Claude Code skill (/aeon command)
12. Bulk operations via MCP
13. AI retrospective tool
14. Smart filters via MCP (natural language to structured filter)
15. AI task decomposition (break large task into subtasks)

---

## Execution Order

### IMMEDIATE SPRINT (parallel-safe, 3 agents)

| Agent | Focus | Status |
|-------|-------|--------|
| Agent 1 | Board Polish #1-6 | DONE |
| Agent 2 | MCP Security Audit + missing tools | DONE (all verified) |
| Agent 3 | Gantt <> Board bridge spec | DONE (shadow-specs/aeon/1403_gantt-board-bridge/) |

### NEXT SPRINT

| Agent | Focus |
|-------|-------|
| Agent 1 | Gantt <> Board implementation (from spec) |
| Agent 2 | Memory system schema + activity feed |
| Agent 3 | Canvas spec (shadow-viceroy, proper spec before building) |

### FOLLOWING SPRINT

| Agent | Focus |
|-------|-------|
| Agent 1 | Canvas implementation (from spec) |
| Agent 2 | AI features (sprint planner, idea expansion) |
| Agent 3 | History/metrics dashboards |

---

## Architecture Notes

- Server component > client component split is clean
- Zustand + persist + server actions pattern is solid
- MCP server has 22 tools, all ownership-verified, SQL-aggregated
- Triple-duplication debt (actions/REST/MCP) partially resolved via shared data layer
- Schema: 15 tables, proper FKs, cascades
- Theme system: 6 themes, glow/glass/effects, CSS var injection
