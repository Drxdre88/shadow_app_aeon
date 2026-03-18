
  Sprint A - Board Polish + Trophy Completion (high impact, low risk)
  1. Fix the two trophy gaps (avgCompletionDays calculation, drag-completion task name)
  2. Add dashboard-level trophy summary (cross-project completions feed)
  3. Board: column drag-reorder persistence, card color picker, task search
  4. Extract duplicated code (PALETTE_COLORS x4, generateId x4) - the code review flagged these as P0

  Sprint B - Memory/History System (Pillar 3 foundation)
  1. Task completion log with proper timestamps
  2. Task history view (who changed what, when)
  3. Stale task detection (the StaleIndicator component already exists as untracked)
  4. Completed tasks archive with search/filter
  5. Task resurrection from archive

  Sprint C - Canvas Enhancement
  1. Add canvas to MCP (create/update/delete nodes+edges)
  2. Canvas-to-board promotion (select nodes → create tasks)
  3. Additional node types (decision, question, action item)
  4. Board-task linkage (reference node → board task)
