INFERNO ENGINEER BLUEPRINT
===========================

Mission: Replace 3s/10s polling with push-based real-time sync for multi-user board collaboration on Vercel serverless + Neon Postgres.

Current State:
  - Board polling: useProjectData.ts fires loadBoardData() server action every 3s via setInterval + loadKey state increment (line 186-204)
  - Dashboard polling: DashboardContent.tsx polls getProjectsWithStats() every 10s (line 56)
  - Dirty guard: boardStore.ts has isDirty flag + 5s grace period (DIRTY_GRACE_MS) to avoid overwriting local optimistic updates during poll (line 110, 241-243)
  - Full-state reload: Each poll calls loadBoardData() which runs 7 parallel DB queries (tasks, columns, labels, taskLabels, dependencies, checklistSummaries, checklistPreviews) -- no delta/diff mechanism
  - Zustand stores: boardStore, ganttStore, canvasStore -- all have isDirty/markClean pattern
  - Server actions: All mutations go through lib/actions/board.ts with requireEditor() auth check, then call revalidatePath
  - DB: Neon serverless Postgres via @neondatabase/serverless Pool driver (max 10 connections) with Drizzle ORM
  - Auth: NextAuth v5 beta with database sessions (not JWT), Google/GitHub/Resend providers
  - Deployment: Vercel with no explicit runtime config (defaults to Node.js serverless, not edge). No maxDuration set.
  - Activity tracking: emitActivity() writes to activityEvents table but is fire-and-forget, not used for sync
  - ws package in dependencies but only used by MCP transport handler, not for app-level WebSocket
  - CSP header restricts connect-src to self and https: which would need updating for external WebSocket services

Files referenced:
  - apps/web/src/app/project/[id]/useProjectData.ts (polling logic)
  - apps/web/src/app/dashboard/DashboardContent.tsx (dashboard polling)
  - apps/web/src/lib/store/boardStore.ts (dirty guard, optimistic updates)
  - apps/web/src/lib/actions/board.ts (server mutations)
  - apps/web/src/lib/db/index.ts (Neon connection)
  - apps/web/src/lib/actions/helpers.ts (auth guards)
  - apps/web/src/lib/data/activity.ts (activity events)
  - apps/web/next.config.ts (CSP headers)
  - apps/web/src/middleware.ts (auth middleware)
  - apps/web/vercel.json (build config)
