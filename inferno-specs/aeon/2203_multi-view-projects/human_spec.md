# Multi-View Project Selector for Aeon

**Date:** 2025-03-22 | **Package:** aeon | **Complexity:** High (new dependency, canvas rendering, 8-10 new files)

---

## Problem Statement

The dashboard currently shows projects as a flat card grid in `DashboardContent.tsx` (415 lines, approaching limit). There is no way to visualize project relationships, hierarchy, or activity at a glance. Users with 10+ projects lack spatial organization and quick-scan capability.

The goal is to replace the project listing section with a multi-view selector offering three visualization modes: Tree (IDE-style hierarchy), Constellation (interactive graph), and Grid (polished version of current cards). This elevates the dashboard from functional to visually distinctive while adding real utility for project navigation.

## Solution Approach

- Extract the project listing from `DashboardContent.tsx` into a new `ProjectViewSwitcher` component
- Create three view components: `TreeView`, `ConstellationView`, `GridView` (each < 300 lines)
- Add a new server action `getProjectsWithStats` that returns projects with task counts and completion percentages in a single query
- Use `react-force-graph-2d` for the constellation view (canvas-based, performant, already has pan/zoom)
- SegmentedControl at top persists view preference to localStorage via a small `useViewPreference` hook
- Smooth crossfade transitions via framer-motion `AnimatePresence`
- Constellation degrades to Grid on mobile (detected via `window.innerWidth` or media query)

### Fluid Grouping (Core Philosophy)
- Add nullable `group` string field to projects table (DB migration)
- Projects with no group auto-land in "General" bucket
- Groups are NOT rigid containers — they're lightweight string labels
- Renaming a group cascades: all projects with old group name get new name (single UPDATE)
- Drag-to-regroup in tree view: drop project on different group header
- Constellation view: nodes animate between clusters when regrouped
- Groups emerge organically — user never has to "define groups first"
- No separate groups table. Just a string field. Morphism over rigidity.

## Risk Assessment

- **New dependency** (`react-force-graph-2d`): ~50KB gzipped, well-maintained, canvas-based so no DOM bloat. Acceptable trade-off for the wow factor.
- **Performance with many projects**: Force graph recalculates on every render. Mitigate by memoizing graph data and using `cooldownTicks` to stop simulation after initial layout.
- **DashboardContent.tsx already 415 lines**: Extracting project listing will reduce it to ~180 lines. Net improvement.
- **Server action N+1**: New `getProjectsWithStats` uses a single aggregated query (JOIN + GROUP BY), not per-project queries.
- **Mobile constellation**: Force graph touch events are unreliable. Auto-fallback to grid is the safe choice.

## Success Criteria

- [ ] Three views switchable via SegmentedControl (Tree | Constellation | Grid)
- [ ] View preference persisted in localStorage, restored on page load
- [ ] Tree view shows collapsible project list with task counts and progress bars
- [ ] Constellation view renders projects as glowing nodes with pan/zoom
- [ ] Grid view matches current card quality with added stats (task counts, completion %)
- [ ] Smooth crossfade transition between views (no layout jump)
- [ ] Mobile auto-degrades constellation to grid
- [ ] Fluid grouping: ungrouped projects land in "General", groups rename cascades
- [ ] Drag-to-regroup in tree view, nodes animate between clusters in constellation
- [ ] DashboardContent.tsx reduced below 300 lines
- [ ] All new files under 300 lines each
- [ ] No code comments in any file

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `src/app/dashboard/DashboardContent.tsx` | **Modify** | Extract project listing, add ViewSwitcher import |
| `src/components/project/ProjectViewSwitcher.tsx` | **New** | View selector + AnimatePresence container |
| `src/components/project/TreeView.tsx` | **New** | IDE-style collapsible tree with progress indicators |
| `src/components/project/ConstellationView.tsx` | **New** | Force-graph canvas with glow nodes |
| `src/components/project/GridView.tsx` | **New** | Enhanced card grid with stats |
| `src/components/project/useViewPreference.ts` | **New** | localStorage hook for view mode |
| `src/lib/actions/projects.ts` | **Modify** | Add `getProjectsWithStats` server action |
| `src/lib/data/projects.ts` | **Modify** | Add `findProjectsWithStats` query |
| `src/lib/db/schema.ts` | **Modify** | Add `group` nullable text field to projects table |
| `drizzle/migrations/` | **New** | Migration adding `group` column to projects |
| `src/lib/data/projects.ts` | **Modify** | Add `renameGroup` + `setProjectGroup` functions |
| `package.json` | **Modify** | Add `react-force-graph-2d` dependency |
