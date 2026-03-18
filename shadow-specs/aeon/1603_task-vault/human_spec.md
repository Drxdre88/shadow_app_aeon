# Task Vault System
**Date:** 16.03.2026 | **Status:** In Progress

## Problem
Completed tasks clutter the board with no clean archival path. Trophy Room reads from ephemeral boardStore (tasks vanish on re-mount). No way to record how long tasks actually took. No permanent archive for completed work.

## Solution
A per-project vault that permanently stores completed tasks with user-provided completion duration. Accessible via right-click context menus at both card and column level. Trophy Room rewired to read from vault.

## Key Decisions
- **task_vault table** - self-contained snapshots (labels, checklist counts embedded as JSON, no joins needed)
- **Card-level**: right-click "Send to Vault" - greyed/disabled when not done, soft glow when done → days popup
- **Column-level**: right-click "Send completed to Vault" → batch modal with all done tasks + days fields
- **Trophy rewire**: reads from vault instead of boardStore.tasks.filter(done)
- **Priority-tinted glow**: trophy cards glow by priority (green/blue/orange/red) instead of uniform green
- **avgCompletionDays**: computed from vault daysTaken data

## Risks
- Label snapshot is point-in-time — if labels change after vault, vault retains old state (acceptable, it's an archive)
- Tasks removed from board on vault — no undo (mitigated: vault acts as the undo itself, could add "restore to board" later)

## Success Criteria
- [x] task_vault schema with self-contained snapshots
- [x] "Send to Vault" in card context menu (disabled when not done, glow when done)
- [x] "Send completed to Vault" in column context menu with batch modal
- [x] Trophy Room reads from vault data
- [x] Priority-tinted glow on trophy cards
- [x] avgCompletionDays computed and displayed
- [x] Drag-completion activity events include task name

## Files Modified
- `src/lib/db/schema.ts` — task_vault table
- `src/lib/data/vault.ts` — NEW: vault data layer
- `src/lib/data/validators.ts` — vault schemas
- `src/lib/actions/vault.ts` — NEW: vault server actions
- `src/components/board/TaskContextMenu.tsx` — "Send to Vault" item
- `src/components/board/ColumnContextMenu.tsx` — "Send completed to Vault" item
- `src/components/board/VaultDaysModal.tsx` — NEW: single-task days popup
- `src/components/board/BatchVaultModal.tsx` — NEW: column batch modal
- `src/components/board/SortableTaskCard.tsx` — prop threading
- `src/components/board/KanbanColumn.tsx` — prop threading
- `src/components/board/TaskBoard.tsx` — prop threading
- `src/app/project/[id]/ProjectContent.tsx` — vault callbacks
- `src/components/trophy/TrophyRoom.tsx` — rewired to vault
- `src/components/trophy/TrophyCard.tsx` — priority-tinted glow
- `src/components/trophy/TrophyStats.tsx` — no changes (already accepts props)
- `src/lib/actions/board.ts` — drag-completion name fix
