# Aeon POC Completion Roadmap

## Problem Statement

Aeon is a Gantt + Kanban project management app with a polished UI layer (6 themes, glassmorphism, drag-and-drop) and working auth (Google OAuth, session persistence, admin roles via Neon Postgres). However, everything beyond login is a dead end: the dashboard shows "0 Projects" with no way to create one, and all task management only works in the `/demo` page using Zustand localStorage -- nothing touches the database.

The gap between "impressive demo" and "usable app" is the entire data persistence layer. Users can sign in, see a beautiful dashboard, then do absolutely nothing. The demo proves the UI works; now the plumbing needs to connect it to real data.

Goal: a deployable POC where authenticated users can create projects, manage board tasks, view gantt timelines, and have everything persisted to Neon Postgres.

## Solution Approach -- Phased Build

### Phase 1: Project CRUD + Dashboard (SMALL)
- Server Actions for project create/read/update/delete (Next.js 15 native, no API routes needed)
- Wire "New Project" and "Create First Project" buttons on dashboard
- Fetch + display user's projects from DB on dashboard
- Project detail page at `/project/[id]` reusing existing board/gantt components
- Middleware update: allow `/project/*` paths

### Phase 2: Board Tasks -> Database (MEDIUM)
- Server Actions for board task CRUD (create, update, move, delete)
- Load board tasks from DB when entering project page
- Save board mutations back to DB (on action, not real-time sync)
- Optimistic updates: Zustand stays as UI cache, DB is source of truth
- Wire QuickAddTask and TaskBoard modal to hit server actions

### Phase 3: Gantt Tasks -> Database (MEDIUM)
- Server Actions for gantt task + row CRUD
- Load gantt data from DB on project page
- Persist drag-move (date changes) and row reassignment
- Board-to-Gantt conversion: "Convert to Timeline" writes ganttTask + links via boardTasks.ganttTaskId

### Phase 4: Polish + Deploy (SMALL)
- Error handling + loading states across all data operations
- Project delete with cascade confirmation
- Basic project settings (name, dates, timeScale)
- Vercel deployment config
- Remove/gate demo page for production

## Architectural Decisions

| Decision | Recommendation | Why |
|----------|---------------|-----|
| API Routes vs Server Actions | **Server Actions** | Next.js 15 native, less boilerplate, type-safe, works with existing server components in dashboard |
| State management pattern | **Zustand as optimistic UI cache, DB as truth** | Stores already built with `isDirty` + `markClean` -- designed for this pattern |
| Data fetching | **Server Components fetch + pass to client** | Dashboard page.tsx already does `await auth()` server-side; extend this pattern |
| ID generation | **Keep crypto.randomUUID() client-side, let DB generate on insert** | Schema uses `defaultRandom()` UUIDs; let Postgres handle it for persisted records |
| Real-time sync | **Skip for POC** | Adds WebSocket/polling complexity; single-user-per-project is fine for POC |

## Risk Assessment

- **Zustand/DB divergence**: Optimistic UI could show stale data if server action fails silently. Mitigate with try/catch + revert in stores, toast notifications on failure.
- **Schema mismatch**: Zustand `BoardTask` has `labels: string[]` but DB uses junction table `task_labels`. Phase 2 must handle this mapping.
- **Gantt store `dependencies` field**: Exists in Zustand but NOT in DB schema. Skip for POC, add `dependencies` table later.
- **Neon cold starts**: First query after idle takes 1-2s. Mitigate with loading skeletons, not blocking renders.
- **Session user.id availability**: Auth callback exposes `user.id` and `user.role` -- confirmed working for DB queries.

## What to Skip for POC (Add Later)

- Labels CRUD (hardcode a few defaults per project)
- Checklist items on tasks
- Real-time multi-user sync
- Task dependencies on Gantt
- Project sharing / collaboration
- Admin panel features
- Search / filtering
- Notifications
- Export / import

## Success Criteria

- [ ] Authenticated user can create a new project from dashboard
- [ ] Dashboard shows list of user's projects with name + dates
- [ ] Clicking a project opens board view with tasks loaded from DB
- [ ] Creating/editing/moving/deleting board tasks persists to DB
- [ ] Gantt view shows tasks loaded from DB with correct positioning
- [ ] Dragging gantt tasks updates dates in DB
- [ ] Board task "Convert to Timeline" creates linked gantt task in DB
- [ ] Page refresh preserves all data (no localStorage dependency)
- [ ] App deploys to Vercel without errors

## Files Created/Modified

### New Files
- `src/app/project/[id]/page.tsx` -- Project detail (server component, auth gate)
- `src/app/project/[id]/ProjectContent.tsx` -- Client shell with board/gantt tabs
- `src/lib/actions/projects.ts` -- Server Actions: createProject, getProjects, updateProject, deleteProject
- `src/lib/actions/board.ts` -- Server Actions: getBoardTasks, createBoardTask, updateBoardTask, moveBoardTask, deleteBoardTask
- `src/lib/actions/gantt.ts` -- Server Actions: getGanttData, createGanttTask, updateGanttTask, deleteGanttTask, createRow, updateRow, deleteRow
- `src/components/project/CreateProjectModal.tsx` -- Project creation form

### Modified Files
- `src/app/dashboard/DashboardContent.tsx` -- Wire project list + create button
- `src/app/dashboard/page.tsx` -- Fetch projects server-side
- `src/middleware.ts` -- Add `/project` to allowed paths
- `src/lib/store/boardStore.ts` -- Add sync helpers (loadFromServer, optimistic revert)
- `src/lib/store/ganttStore.ts` -- Add sync helpers (loadFromServer, optimistic revert)

## Complexity Estimates

| Phase | Effort | Files | Estimate |
|-------|--------|-------|----------|
| Phase 1: Project CRUD | Small | 5-6 new, 3 modified | 2-3 hours |
| Phase 2: Board -> DB | Medium | 2 new, 3 modified | 3-4 hours |
| Phase 3: Gantt -> DB | Medium | 1 new, 2 modified | 3-4 hours |
| Phase 4: Polish + Deploy | Small | 0 new, 4-5 modified | 2-3 hours |
| **Total** | | ~10 new, ~8 modified | **10-14 hours** |
