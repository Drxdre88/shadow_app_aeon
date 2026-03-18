# Velocity Foundation

**Mission:** 1803_velocity-foundation | **Date:** 18/03/2026 | **Complexity:** Medium-High

---

## Problem Statement

Aeon tracks task lifecycle (create, move, archive, vault) through 17 `emitActivity` call sites across 4 action files -- but the `activityEvents` table has no `actorId` or `actorType` columns. Every event looks identical whether triggered by a human user or by Claude via the MCP server. The MCP server (`route.ts`) bypasses the actions layer entirely and calls data functions directly, meaning agent-driven mutations emit zero activity events.

Additionally, `reorderBoardTasks` emits `moved` events with only `{ toColumnId }` -- missing the `fromColumnId` needed for column transition analysis. Without this, calculating dwell times per column is impossible from the event stream alone.

The Trophy Room provides basic vault statistics (total, avg days, priority breakdown) but offers no throughput velocity, cycle time analysis, column dwell times, or activity heatmaps. There is no way to answer "how fast is this project moving?" or "where do tasks get stuck?"

## Solution Approach

**Phase 1 -- Event Infrastructure**
- Add `actorId` (varchar) and `actorType` (varchar, default `'user'`) columns to `activityEvents` schema
- Update `emitActivity` signature with optional `actorId` + `actorType` params (backwards compatible)
- Thread `userId` from `requireOwnership()` into all 17 existing call sites
- Add `emitActivity` calls to all mutating MCP tools (14 tools) with `actorType: 'agent'`
- Capture `fromColumnId` in `reorderBoardTasks` and `updateBoardTask` move events

**Phase 2 -- Velocity Data Layer**
- New `src/lib/data/velocity.ts` with SQL aggregation queries against `activityEvents` and `taskVault`
- New `src/lib/actions/velocity.ts` with ownership-gated wrappers
- New MCP tool `get_velocity_stats` for agent access to velocity data
- Queries: completion velocity, cycle time stats, column dwell times, activity heatmap, priority breakdown

**Phase 3 -- Velocity Tab UI**
- 5th tab in `ProjectContent.tsx` using orange/amber theme (matching existing tab color pattern)
- Pure CSS/SVG charts (no new charting library -- keeps bundle lean)
- Components: VelocityTab, VelocityChart, CycleTimeCard, HeatmapGrid, ColumnFlowBar
- Time range selector: 7d / 30d / 90d / All

## Architecture

- Extends existing `activityEvents` table (no new tables)
- Actor attribution backwards-compatible: defaults to `'user'`, nullable `actorId`
- Column dwell time derived from consecutive `moved` events per task (no timer table)
- Heatmap uses `createdAt` from activity events, timezone handled client-side
- MCP server gets `emitActivity` imports; calls fire-and-forget (`.catch(() => {})`) matching existing pattern

## Risk Assessment

- **Migration on production DB**: `ALTER TABLE ADD COLUMN` with defaults is non-blocking on Neon PostgreSQL -- low risk
- **17 call-site changes**: Mechanical find-and-replace, but each needs `userId` from `requireOwnership()` return value -- some call sites don't capture it. Requires variable capture changes.
- **MCP route.ts is 692 lines**: Adding emitActivity to 14 tools increases to ~750 lines. Acceptable but nearing refactor threshold.
- **Dwell time accuracy**: Depends on `moved` events existing for each column transition. Historical data before this change has no `fromColumnId`. Velocity queries must handle nulls gracefully.
- **Bundle size**: Pure SVG/CSS avoids adding Recharts (~45KB gzipped). Trade-off: more verbose component code, but zero dependency risk.

## Success Criteria

- [ ] `activityEvents` has `actorId` and `actorType` columns in production
- [ ] All 17 existing emitActivity calls pass userId as actorId
- [ ] MCP mutating tools (create/update/delete/move/archive/vault) emit activity events with actorType='agent'
- [ ] `moved` events include both `fromColumnId` and `toColumnId` in metadata
- [ ] Velocity tab loads and displays charts for a project with vault data
- [ ] `get_velocity_stats` MCP tool returns valid velocity data
- [ ] Existing Trophy Room and activity timeline continue to work (no regressions)
- [ ] DB migration runs cleanly via `db:push`

## Files Modified

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add actorId, actorType columns to activityEvents |
| `src/lib/data/activity.ts` | Extend emitActivity signature with actorId, actorType |
| `src/lib/actions/board.ts` | Thread userId into 10 emitActivity calls, add fromColumnId to moved events |
| `src/lib/actions/dependencies.ts` | Thread userId into 2 emitActivity calls |
| `src/lib/actions/labels.ts` | Thread userId into 2 emitActivity calls |
| `src/lib/actions/vault.ts` | Thread userId into 3 emitActivity calls |
| `src/app/api/[transport]/route.ts` | Add emitActivity to 14 mutating MCP tools |
| **NEW** `src/lib/data/velocity.ts` | SQL aggregation queries for velocity metrics |
| **NEW** `src/lib/actions/velocity.ts` | Ownership-gated velocity action wrappers |
| `src/app/project/[id]/ProjectContent.tsx` | Add Velocity tab (5th tab) |
| **NEW** `src/components/velocity/VelocityTab.tsx` | Main velocity container |
| **NEW** `src/components/velocity/VelocityChart.tsx` | Completion trend SVG line chart |
| **NEW** `src/components/velocity/CycleTimeCard.tsx` | Stat cards for avg/median/p95 |
| **NEW** `src/components/velocity/HeatmapGrid.tsx` | 7x24 activity heatmap |
| **NEW** `src/components/velocity/ColumnFlowBar.tsx` | Stacked bar for column dwell times |
