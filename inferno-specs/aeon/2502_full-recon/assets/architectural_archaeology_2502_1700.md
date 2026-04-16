# Aeon - Full Architectural Reconnaissance
**Date:** 2502 17:00
**Agent:** shadow-prowler

---

## SHADOW PROWLER RECONNAISSANCE

### Mission Objective
Complete architectural map of shadow_app_aeon: tech stack, database layer, auth system, feature state, API surface, frontend architecture, and deployment posture.

---

## Structural Intelligence

### Class Architecture
No traditional OOP class hierarchy. Functional React component composition with three Zustand stores as the core state layer:

- `themeStore.ts` - global UI theme state (persisted to localStorage: `aeon-theme`)
- `boardStore.ts` - kanban task state (persisted: `aeon-board`)
- `ganttStore.ts` - gantt task + row state (persisted: `aeon-gantt`)

All three stores use Zustand's `persist` middleware. The `isDirty` + `markClean` pattern in board/gantt stores was intentionally designed as optimistic UI cache with DB-as-source-of-truth -- acknowledged in the 0802 roadmap spec.

### Component Relationships

```
layout.tsx
  AuthProvider (SessionProvider wrapper)
  ThemeProvider (CSS var injector from Zustand -> document.documentElement)
    page.tsx (landing - public)
    login/page.tsx -> LoginForm.tsx (Google OAuth only, currently)
    demo/page.tsx (public demo, Zustand-only data)
    dashboard/page.tsx [server] -> DashboardContent.tsx [client]
    project/[id]/page.tsx [server] -> ProjectContent.tsx [client]
      TaskBoard.tsx (DnD board, 4 columns: todo/doing/review/done)
        KanbanColumn.tsx
        TaskCard.tsx (GlowCard + dnd-kit useDraggable)
        SortableTaskCard.tsx
        QuickAddTask.tsx
        TaskChecklist.tsx
      GanttChart.tsx (DnD timeline)
        TimelineHeader.tsx
        RowContainer.tsx
        TaskBar.tsx
        TimeScaleSelector.tsx
```

### Data Flow Patterns

**Auth Flow:**
NextAuth v5 beta -> Google OAuth -> DrizzleAdapter -> Neon Postgres (sessions table)
Session strategy: database (not JWT). Session token checked in proxy.ts middleware via cookie.

**Board Task Flow:**
Server Component (project/[id]/page.tsx) auth-gates + verifies project ownership
-> passes `project` prop to ProjectContent [client]
-> useEffect calls `getBoardTasks(projectId)` server action on mount
-> maps DB rows to Zustand `BoardTask` shape
-> board mutations (create/update/delete/reorder) fire server actions optimistically
-> Zustand store stays as UI cache, `revalidatePath` invalidates Next.js cache

**Gantt Flow (INCOMPLETE):**
GanttChart renders from Zustand store only. No DB server actions for gantt exist yet.
`src/lib/actions/gantt.ts` referenced in the roadmap spec but NOT created yet.
Gantt rows are pre-seeded at project creation (Planning/Development/Testing rows).

**Theme Flow:**
ThemeStore (Zustand persist) -> ThemeProvider useEffect -> CSS custom properties on :root
-> All components read via `var(--primary)`, `var(--glow-color)`, etc.
Global glow intensity (0-100 slider) multiplies all box-shadow values via `mult = glowIntensity / 75`.

### Control Flow Analysis

**Route Protection:**
`src/proxy.ts` (middleware) checks for `authjs.session-token` or `__Secure-authjs.session-token` cookie.
Public paths: `/`, `/login`, `/demo`, `/api/*`
Protected: everything else -> redirects to `/login?callbackUrl=<path>`

**Server Action Authorization Pattern (consistent):**
1. `auth()` -> verify session
2. `verifyProjectOwnership(projectId, userId)` -> DB check
3. Execute mutation -> `revalidatePath()`

---

## Design Pattern Detection

| Pattern | Implementation | Rationale |
|---------|---------------|-----------|
| Server Component + Client Shell | `page.tsx` [server] passes data to `Content.tsx` [client] | Auth gate + data fetch happen server-side; rich interactivity stays client |
| Optimistic UI Cache | Zustand `isDirty` pattern | Instant UI response without waiting for server round-trip |
| CSS Custom Properties + Zustand | ThemeProvider injects vars from store | Allows runtime theme switching without re-render cascade |
| Glow Multiplier | `mult = glowIntensity / 75` applied to every box-shadow | Single slider scales ALL visual effects proportionally |
| Provider Composition | AuthProvider wraps ThemeProvider wraps children | Clean layering: auth context -> theme context -> app |
| Server Actions | `'use server'` functions vs API routes | Next.js 15 native, no HTTP overhead, type-safe RPC calls from client |
| Dynamic Auth Providers | `buildProviders()` checks env vars at startup | Google/GitHub/Resend providers only activated if credentials exist |
| forwardRef on UI primitives | GlowCard, NeonButton both use forwardRef | Allows DnD kit to attach refs to these components |

---

## Historical Context

**Timeline reconstruction from git commits and spec dates:**
- `c17d850` (Feb 2): Initial scaffold - Google auth + project setup
- `d745c21` (Feb 6): Dependency health improvements
- Merge PR #1 (feature/phase1): Phase 1 completion - project CRUD, dashboard, board tasks DB
- Feb 7-8: Phase 2 work (board actions, project page)
- `0802_poc-completion-roadmap` spec: Written BEFORE implementation as planning doc
- `0802_dependency-health` spec: Ran alongside (dependency audit)
- Feb 8 `package-lock.json` latest update: Last substantive code change

**Evolution markers:**
- `src/proxy.ts` is named `proxy` not `middleware` - unusual. Likely renamed to avoid Next.js middleware naming conflicts or a deliberate separation.
- `resend` dependency is installed but Resend provider only activates if `AUTH_RESEND_KEY` env var exists. Currently Google is the only active provider.
- `ganttStore` has `dependencies: string[]` field on GanttTask that has NO corresponding DB column. This is explicitly called out as a known debt in the roadmap spec.
- `TaskChecklist.tsx` and `QuickAddTask.tsx` components exist but are not wired into any parent - orphaned components awaiting integration.

---

## Hidden Dependencies

**Environment Variables Required (from SETUP.md and auth.ts):**
- `DATABASE_URL` - Neon connection string (required, throws on missing)
- `AUTH_SECRET` - NextAuth signing secret (required)
- `NEXTAUTH_URL` - Auth callback base URL
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` - Google OAuth (optional but only active provider)
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` - GitHub OAuth (optional)
- `AUTH_RESEND_KEY` / `EMAIL_FROM` - Magic link email (optional)
- `ADMIN_EMAILS` - Comma-separated emails that get admin role on first sign-in

**Implicit Coupling:**
- Drizzle adapter expects EXACT table names matching schema exports (users, accounts, sessions, verificationTokens)
- Board tasks have `labels: string[]` in Zustand but DB uses junction table `task_labels` - this mapping is NOT yet implemented (labels always load as `[]`)
- Gantt actions (`src/lib/actions/gantt.ts`) referenced in roadmap but the file does not exist - gantt is Zustand-only
- `checklistItems` table exists in schema but `TaskChecklist.tsx` has no server action backing
- Middleware file is `proxy.ts` NOT `middleware.ts` - verify Next.js picks this up correctly

**Package versions of note:**
- next: `^16.1.4` (package.json) but SETUP.md says "Next.js 15" - version drift in docs
- next-auth: `^5.0.0-beta.30` - beta version, API may change
- react: `19.0.0` (exact pin, not semver range)
- drizzle-orm: `^0.37.0` / drizzle-kit: `^0.31.8`

---

## Architectural Insights

**Why this structure?**
1. Next.js App Router chosen for native server actions (no API route boilerplate)
2. Neon chosen for serverless Postgres that works with Next.js edge/serverless deployment on Vercel
3. Drizzle chosen over Prisma for lightweight, type-safe queries that work natively with Neon serverless driver
4. Zustand over Redux/Context for simple, boilerplate-free stores with built-in persist
5. DnD Kit over react-beautiful-dnd (deprecated) or react-dnd for modern DnD with accessibility
6. Framer Motion for production-quality animation without fighting CSS keyframes
7. Glassmorphism + glow effects deliberately designed as a "premium feel" differentiator

**Why the Server Component + Client Shell pattern?**
Auth checks and ownership verification MUST happen server-side (security). But Kanban/Gantt are rich interactive UIs that need client state. The split avoids fetching data client-side (no exposed API keys, no loading flicker pattern) while keeping interactivity client-contained.

---

## Reconnaissance Warnings

1. **proxy.ts as middleware**: Next.js expects middleware at `src/middleware.ts` or `middleware.ts`. `proxy.ts` will NOT automatically be treated as middleware unless there's an explicit import. VERIFY this is actually being executed.

2. **Gantt is disconnected from DB**: Any gantt task created in the app exists only in Zustand localStorage. On new browser/device, gantt is empty. This is a known gap per the roadmap.

3. **Labels junction table gap**: `task_labels` table exists in schema and schema exports the type, but no server action reads/writes it. The Zustand `labels: string[]` field on BoardTask stores label IDs but they never load from DB.

4. **TaskChecklist and QuickAddTask orphaned**: These components have no parent that renders them. They're built but unintegrated.

5. **next-auth beta**: v5 beta API (`handlers`, `auth`, `signIn`, `signOut` from `'next-auth'`) differs from v4 stable. If upgrading to v5 stable, adapter and callback signatures may change.

6. **No error boundaries**: No React ErrorBoundary components. Server action errors caught with `try/catch` in `ProjectContent.tsx` log to console only - no user-facing error UI.

7. **Board store persists between projects**: Zustand `aeon-board` persists ALL tasks across all projects in localStorage. `projectTasks = tasks.filter(t => t.projectId === projectId)` filters at render time. If a user has many projects, this grows unboundedly.

---

## Strategic Recommendations

**To complete the app (matching the roadmap Phase 3+):**

1. **Create `src/lib/actions/gantt.ts`**: Server actions for getGanttData, createGanttTask, updateGanttTask (date drag), deleteGanttTask, plus row CRUD. Follow the exact same pattern as `board.ts`.

2. **Wire gantt loading in ProjectContent**: Same `useEffect` pattern as board - call `getGanttData(project.id)` and `setGanttTasks()` + `setRows()` from store.

3. **Fix the labels gap**: Either load labels from DB in `getBoardTasks` response (JOIN query) or add a `getLabels(projectId)` server action and call it on project load.

4. **Verify proxy.ts middleware activation**: Check that Next.js is actually running proxy.ts as middleware. It should be at `src/middleware.ts`.

5. **Add error UI**: Wrap ProjectContent's data load in error state rendering. Server action failures currently fail silently.

6. **For Vercel deploy**: Add `NEXTAUTH_URL` env var, update OAuth redirect URIs in Google Console to production domain, set all required env vars in Vercel dashboard.

---

## Current Feature State Matrix

| Feature | UI Built | DB Schema | Server Actions | Wired Together | Status |
|---------|----------|-----------|---------------|----------------|--------|
| Google Auth | Yes | Yes | Yes (NextAuth) | Yes | COMPLETE |
| Dashboard | Yes | Yes | Yes | Yes | COMPLETE |
| Project CRUD | Yes | Yes | Yes | Yes | COMPLETE |
| Board Tasks | Yes | Yes | Yes | Yes | COMPLETE |
| Board Labels | Yes | Yes | No | No | BROKEN (empty) |
| Board Checklists | Yes (orphan) | Yes | No | No | INCOMPLETE |
| Gantt Chart | Yes | Yes | No | No | ZUSTAND ONLY |
| Gantt Rows | Auto-seeded | Yes | No (direct insert at project create) | Partial | INCOMPLETE |
| Themes | Yes | No (localStorage) | N/A | Yes | COMPLETE |
| Admin Role | Yes (badge) | Yes | Yes (event) | Yes | COMPLETE |
| Demo Mode | Yes | No | No | Yes | COMPLETE |
