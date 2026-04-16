# DB Query Audit — Aeon Web App
**Date:** 2026-04-02
**Scope:** All server-side page loads + auth layer
**Files examined:** dashboard/page.tsx, project/[id]/page.tsx, share/[token]/page.tsx, invite/[token]/page.tsx, invite/realm/[token]/page.tsx, beta-terms/page.tsx, lib/auth.ts, lib/data/*, lib/actions/*

---

## 1. AUTH SESSION COST (`auth()`)

**Driver:** NextAuth v5, `strategy: 'database'`
**What `auth()` does:** 1 DB query — SELECT from `sessions` JOIN `users` WHERE sessionToken = cookie value.

Every protected page calls `auth()` at least once. The project board page calls it **twice** — once in `generateMetadata()` and once in the page function itself. These two calls run as separate requests (Next.js invokes both independently at render time).

---

## 2. PAGE-BY-PAGE QUERY MAP

---

### 2A. Dashboard Page (`/dashboard`)

**Entry:** `app/dashboard/page.tsx`

#### Execution Order

```
[1] auth()
    → SELECT sessions JOIN users WHERE sessionToken = ?    [sessions + users]
    → REDIRECT if no session or terms not accepted

[2] Promise.all([A, B, C])  — all 3 fire in parallel

    [A] getProjectsWithStats()
        → requireAuth()
          → auth()  ← SECOND auth() call
            → SELECT sessions JOIN users                   [sessions + users]
        → findProjectsWithStats(userId)
          → SELECT DISTINCT projects LEFT JOIN project_members
            WHERE projects.userId = ? OR project_members.userId = ?
            + 2 correlated subqueries per row for totalTasks / doneTasks   [projects + project_members + board_tasks x2]

    [B] ensurePersonalWorkspace().then(() => getWorkspaceProjects())
        SEQUENTIAL CHAIN — B2 cannot start until B1 completes

        [B1] ensurePersonalWorkspace()
             → requireAuth()
               → auth()  ← THIRD auth() call               [sessions + users]
             → findOrCreatePersonalWorkspace(userId)
               → TRANSACTION:
                 SELECT workspaceGroups WHERE ownerId=? AND isPersonal=true
                 (INSERT workspaceGroups if missing)
                 (INSERT groupMembers if missing)           [workspace_groups + group_members]
             → ensureOrphanProjectsInPersonalWorkspace(userId)
               → findOrCreatePersonalWorkspace(userId)
                 → TRANSACTION: same SELECT as above       [workspace_groups] (likely cache-miss, re-queries)
               → TRANSACTION:
                 SELECT projects WHERE userId=? AND NOT EXISTS project_groups  [projects + project_groups]
                 (INSERT project_groups for orphans if any)
             → consolidateSoloWorkspaces(userId)
               → findOrCreatePersonalWorkspace(userId)
                 → TRANSACTION: same SELECT AGAIN           [workspace_groups] (third time)
               → SELECT workspaceGroups WHERE id=? (check consolidated flag)
               → SELECT workspaceGroups + member count subquery WHERE ownerId=? isPersonal=false
               (per solo workspace: SELECT recheck + SELECT projects + INSERT + DELETE x3)

        [B2] getWorkspaceProjects()
             → requireAuth()
               → auth()  ← FOURTH auth() call              [sessions + users]
             → findWorkspaceProjects(userId)
               → SELECT groupMembers JOIN workspaceGroups WHERE userId=?
                 + member count correlated subquery per row [workspace_groups + group_members]
               → SELECT projectGroups JOIN projects WHERE groupId IN (...)  [project_groups + projects]

    [C] getSharedProjects()
        → requireAuth()
          → auth()  ← FIFTH auth() call                    [sessions + users]
        → findSharedProjects(userId)
          → SELECT projects JOIN project_members
            WHERE NOT projects.userId=? AND NOT EXISTS (project_groups JOIN group_members)  [projects + project_members + project_groups + group_members]
```

#### Dashboard Summary

| Step | Query | Table(s) | Parallel? |
|------|-------|----------|-----------|
| 1 | auth() — session lookup | sessions, users | No (gate) |
| 2A-auth | auth() — requireAuth() in getProjectsWithStats | sessions, users | With 2B, 2C |
| 2A-data | findProjectsWithStats | projects, project_members, board_tasks | With 2B, 2C |
| 2B-auth | auth() — requireAuth() in ensurePersonalWorkspace | sessions, users | With 2A, 2C |
| 2B-1a | findOrCreatePersonalWorkspace (call 1) | workspace_groups, group_members | Sequential in 2B |
| 2B-1b | findOrCreatePersonalWorkspace (call 2 — inside ensureOrphans) | workspace_groups | Sequential in 2B |
| 2B-1c | ensureOrphanProjects SELECT | projects, project_groups | Sequential in 2B |
| 2B-1d | findOrCreatePersonalWorkspace (call 3 — inside consolidate) | workspace_groups | Sequential in 2B |
| 2B-1e | consolidateSoloWorkspaces SELECT consolidated flag | workspace_groups | Sequential in 2B |
| 2B-1f | consolidateSoloWorkspaces SELECT solo workspaces | workspace_groups | Sequential in 2B |
| 2B-2-auth | auth() — requireAuth() in getWorkspaceProjects | sessions, users | Sequential after 2B-1 |
| 2B-2a | findWorkspaceProjects — groups | workspace_groups, group_members | Sequential after 2B-1 |
| 2B-2b | findWorkspaceProjects — projects | project_groups, projects | Sequential after 2B-2a |
| 2C-auth | auth() — requireAuth() in getSharedProjects | sessions, users | With 2A, 2B |
| 2C-data | findSharedProjects | projects, project_members, project_groups, group_members | With 2A, 2B |

**Total auth() calls on dashboard load: 5**
**Total DB round trips (warm path, personal workspace exists, no orphans): ~10–12**
**Total DB round trips (cold path, first login): ~14–18**

---

### 2B. Project Board Page (`/project/[id]`)

**Entry:** `app/project/[id]/page.tsx`

Next.js calls `generateMetadata()` and the page function as two separate invocations. Both call `auth()`.

#### Execution Order

```
[META] generateMetadata() — runs independently
    → auth()                                               [sessions + users]
    → verifyProjectOwnership(id, userId)
      → SELECT project_members WHERE projectId=? AND userId=?     [project_members]
        IF found:
          → SELECT projects WHERE id=?                             [projects]
        ELSE:
          → SELECT projects WHERE id=? AND userId=?                [projects]
          IF not found:
            → SELECT project_groups WHERE projectId=?              [project_groups]
            → SELECT group_members WHERE groupId IN (?) AND userId=?  [group_members]
            IF found:
              → SELECT projects WHERE id=?                         [projects]

[PAGE] Page function
    → auth()  ← SECOND auth() call                        [sessions + users]
    → REDIRECT check (no session / terms)

    [P1] verifyProjectOwnership(id, userId)  — AGAIN, same as META
         (best case: 2 queries; worst case: 4 queries)

    IF project null:
      [P2] findProjectBasic(id)
           → SELECT id, name FROM projects WHERE id=?      [projects]
           → render AccessDenied (no more queries)
      RETURN EARLY

    IF project found:
      [P3] Promise.all — 7 queries in parallel

          findTasks(id)
          → SELECT board_tasks WHERE projectId=? AND archivedAt IS NULL  [board_tasks]

          findColumns(id)
          → SELECT board_columns WHERE projectId=?                       [board_columns]

          findLabels(id)
          → SELECT labels WHERE projectId=?                              [labels]

          findTaskLabels(id)
          → SELECT task_labels JOIN board_tasks WHERE board_tasks.projectId=?  [task_labels + board_tasks]

          findDependencies(id)
          → SELECT task_dependencies JOIN board_tasks WHERE board_tasks.projectId=?  [task_dependencies + board_tasks]

          findChecklistSummaries(id)
          → SELECT checklist_items JOIN board_tasks WHERE board_tasks.projectId=?  [checklist_items + board_tasks]

          findChecklistPreviews(id)
          → SELECT checklist_items JOIN board_tasks WHERE board_tasks.projectId=?  [checklist_items + board_tasks]
```

#### Project Board Summary

| Step | Query | Table(s) | Parallel? |
|------|-------|----------|-----------|
| META-auth | auth() in generateMetadata | sessions, users | With PAGE |
| META-ownership | verifyProjectOwnership | project_members → projects (2–4 queries) | Runs before page data |
| PAGE-auth | auth() in page function | sessions, users | With META |
| PAGE-ownership | verifyProjectOwnership (DUPLICATE of META) | project_members → projects (2–4 queries) | Sequential after auth |
| P3-tasks | findTasks | board_tasks | Parallel batch |
| P3-columns | findColumns | board_columns | Parallel batch |
| P3-labels | findLabels | labels | Parallel batch |
| P3-taskLabels | findTaskLabels | task_labels + board_tasks | Parallel batch |
| P3-deps | findDependencies | task_dependencies + board_tasks | Parallel batch |
| P3-summaries | findChecklistSummaries | checklist_items + board_tasks | Parallel batch |
| P3-previews | findChecklistPreviews | checklist_items + board_tasks | Parallel batch |

**Total auth() calls on project page load: 2 (META + PAGE)**
**Total DB round trips (best case — project_member row exists): 2 + 2 + 7 = 11**
**Total DB round trips (worst case — realm-only access): 2 + 6 + 7 = 15**

**Critical finding: `verifyProjectOwnership` is called twice** — once in `generateMetadata` and once in the page function, with identical arguments. In the worst-case realm path this is 4 queries duplicated = 8 extra queries.

---

### 2C. Share Page (`/share/[token]`)

No auth required. Single query.

```
[1] getBoardSnapshot(token)
    → SELECT board_snapshots WHERE token=? AND expiresAt > NOW()   [board_snapshots]
```

**Total DB round trips: 1**

---

### 2D. Project Invite Page (`/invite/[token]`)

```
[1] auth()                                                 [sessions + users]
    → REDIRECT if no session

[2] acceptProjectInvite(token)
    → requireAuth()
      → auth()  ← SECOND auth() call                      [sessions + users]
    → acceptInvite(token, userId)
      → findInviteByToken(token)
        → SELECT project_invites WHERE token=? AND acceptedAt IS NULL  [project_invites]
      → TRANSACTION:
        INSERT project_members ON CONFLICT DO NOTHING      [project_members]
        UPDATE project_invites SET acceptedAt=?            [project_invites]
```

**Total auth() calls: 2**
**Total DB round trips: 4**

---

### 2E. Realm Invite Page (`/invite/realm/[token]`)

```
[1] auth()                                                 [sessions + users]
    → REDIRECT if no session

[2] acceptRealmInvite(token)
    → requireAuth()
      → auth()  ← SECOND auth() call                      [sessions + users]
    → acceptRealmInvite(token, userId)
      → findRealmInviteByToken(token)
        → SELECT realm_invites WHERE token=? AND acceptedAt IS NULL  [realm_invites]
      → TRANSACTION:
        INSERT group_members ON CONFLICT DO NOTHING        [group_members]
        UPDATE realm_invites SET acceptedAt=?              [realm_invites]
```

**Total auth() calls: 2**
**Total DB round trips: 4**

---

### 2F. Beta Terms Page (`/beta-terms`)

```
[1] auth()                                                 [sessions + users]
    → REDIRECT if no session
    → REDIRECT if termsAccepted (no extra query)
```

**Total DB round trips: 1**

---

### 2G. Root Page (`/`) and Demo Page (`/demo`)

Both are `'use client'` components with no server-side data loading. **Zero DB queries on page load.**

---

## 3. REDUNDANT QUERIES

### RQ-1: `auth()` called 5 times on dashboard load (CRITICAL)

Dashboard fires 3 parallel branches, each calling its own `requireAuth()` which calls `auth()`. The root page also calls `auth()`. This means 5 separate `SELECT sessions JOIN users` queries are issued per dashboard load.

NextAuth v5 does NOT cache `auth()` calls across server components within the same request (no React cache() wrapper). Each call is a full DB round trip.

**Affected path:** `DashboardPage` → [getProjectsWithStats, ensurePersonalWorkspace, getWorkspaceProjects, getSharedProjects] → each calls `requireAuth()` → each calls `auth()`

### RQ-2: `findOrCreatePersonalWorkspace()` called 3 times inside `ensurePersonalWorkspace()` (HIGH)

`ensurePersonalWorkspace()` calls:
1. `_findOrCreatePersonal(userId)` — queries workspace_groups
2. `_ensureOrphans(userId)` — internally calls `findOrCreatePersonalWorkspace(userId)` again
3. `_consolidateSolo(userId)` — internally calls `findOrCreatePersonalWorkspace(userId)` a third time

On the warm path (personal workspace exists), this is 3 round trips to get the same row each time.

### RQ-3: `verifyProjectOwnership()` called twice on project board load (HIGH)

`generateMetadata()` and the page function both call `verifyProjectOwnership(id, session.user.id)` with identical parameters. This is 2–4 duplicate queries (depending on access path). Next.js does not deduplicate server action calls across `generateMetadata` and the page function.

### RQ-4: `auth()` called twice on project board load (MEDIUM)

`generateMetadata()` and the page function each call `auth()` independently. This is 2 separate session lookups.

### RQ-5: `findChecklistSummaries` and `findChecklistPreviews` scan the same data (MEDIUM)

Both functions query `checklist_items JOIN board_tasks WHERE board_tasks.projectId = ?` — identical WHERE clause and JOIN. They differ only in which columns are selected and how the result is shaped. This is the same underlying table scan done twice.

### RQ-6: `findTaskLabels` and board_tasks re-JOIN (LOW)

`findTaskLabels(projectId)` does `task_labels JOIN board_tasks WHERE board_tasks.projectId = ?`. The `board_tasks` table is already queried by `findTasks(id)` in the same `Promise.all`. Both queries hit `board_tasks` but neither result is shared.

---

## 4. SEQUENTIAL CHAINS THAT COULD BE PARALLELIZED

### SC-1: `ensurePersonalWorkspace` blocks `getWorkspaceProjects` (DASHBOARD)

```
Promise.all([
  getProjectsWithStats(),          ← runs fully in parallel
  ensurePersonalWorkspace()        ← B1: must finish before B2
    .then(() => getWorkspaceProjects()),  ← B2: blocked behind B1
  getSharedProjects(),             ← runs fully in parallel
])
```

The `.then()` chain means `getWorkspaceProjects` cannot start until all 3 `ensurePersonalWorkspace` sub-operations (findOrCreate x3 + ensureOrphans + consolidate) complete. On the warm path, `ensurePersonalWorkspace` takes 3–6 round trips before `getWorkspaceProjects` can begin its own 2 queries.

If `ensurePersonalWorkspace` were guaranteed idempotent after first run (which it effectively is — it no-ops if workspace exists and consolidated flag is set), this chain could be restructured so the two run in parallel on subsequent page loads.

### SC-2: `verifyProjectOwnership` — realm path is 3–4 sequential queries (PROJECT PAGE)

```
SELECT project_members  (miss)
→ SELECT projects WHERE userId=?  (miss)
→ SELECT project_groups  (found)
→ SELECT group_members  (check membership)
→ SELECT projects  (final fetch)
```

These 4–5 queries are unavoidably sequential due to conditional logic. However, the first two (project_members and projects-by-owner) could be parallelized since they are independent checks.

---

## 5. OPTIMIZATION RECOMMENDATIONS

### OPT-1: Wrap `auth()` with React `cache()` [HIGHEST IMPACT]

```typescript
// lib/auth.ts or lib/auth-cached.ts
import { cache } from 'react'
import { auth as _auth } from './auth'
export const auth = cache(_auth)
```

React's `cache()` deduplicates calls with the same arguments within a single server render tree. This would collapse 5 auth() calls on the dashboard down to 1, and 2 calls on the project page down to 1.

**Estimated savings:** 4 round trips on dashboard, 1 on project page, 1 on each invite page.

### OPT-2: Memoize `findOrCreatePersonalWorkspace` result in `ensurePersonalWorkspace` [HIGH IMPACT]

`ensurePersonalWorkspace` calls `findOrCreatePersonalWorkspace` three times. The result (personalGroupId) should be computed once and passed through:

```typescript
export async function ensurePersonalWorkspace() {
  const userId = await requireAuth()
  const personalId = await _findOrCreatePersonal(userId)
  const orphans = await _ensureOrphans(userId, personalId)   // pass id
  const consolidated = await _consolidateSolo(userId, personalId)  // pass id
  return orphans + consolidated
}
```

Requires modifying `ensureOrphanProjectsInPersonalWorkspace` and `consolidateSoloWorkspaces` to accept an optional `personalGroupId` parameter, skipping their internal re-fetch.

**Estimated savings:** 2 round trips on every dashboard load.

### OPT-3: Merge `findChecklistSummaries` and `findChecklistPreviews` into one query [MEDIUM IMPACT]

Both functions scan `checklist_items JOIN board_tasks WHERE board_tasks.projectId = ?`. A single query can return all columns needed for both outputs, and the two Maps can be built in one pass.

```typescript
export async function findChecklistData(projectId: string) {
  const items = await db
    .select({ taskId, title, state, groupName, orderIndex })
    .from(checklistItems)
    .innerJoin(boardTasks, ...)
    .where(eq(boardTasks.projectId, projectId))
    .orderBy(checklistItems.orderIndex)

  const summaries: Record<string, ...> = {}
  const previews: Record<string, ...> = {}
  for (const item of items) {
    // build both in one loop
  }
  return { summaries, previews }
}
```

**Estimated savings:** 1 round trip on every project board load.

### OPT-4: Eliminate `verifyProjectOwnership` duplication between `generateMetadata` and page function [MEDIUM IMPACT]

Next.js does not share data between `generateMetadata` and the page function. Options:

**Option A:** Remove `generateMetadata` from `project/[id]/page.tsx` — fall back to a static title like "Project | Aeon". Eliminates 2–4 queries and one extra `auth()` call on every board page load.

**Option B:** Use `React.cache()` on `verifyProjectOwnership` so if it runs with the same arguments in the same render cycle it returns the cached value. This only works if Next.js executes both in the same request context (not guaranteed for metadata + page).

**Estimated savings (Option A):** 3–5 round trips per project page load.

### OPT-5: Parallelize `verifyProjectOwnership` first two checks [LOW IMPACT]

The sequential `SELECT project_members` then `SELECT projects WHERE userId=?` could be issued in parallel since they are independent:

```typescript
const [membership, ownedProject] = await Promise.all([
  db.select(...).from(projectMembers).where(...),
  db.select(...).from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId))),
])
if (membership || ownedProject) { ... }
```

**Estimated savings:** Reduces latency on the realm-access path (eliminates one sequential hop when the user is a direct member or owner).

### OPT-6: Combine `findWorkspaceProjects` — avoid two-pass query [LOW IMPACT]

`findWorkspaceProjects` currently does two sequential queries:
1. SELECT user's groups
2. SELECT projects for those group IDs

These could be combined into a single JOIN query, though the current two-query approach is readable and the second query uses `inArray` which is efficient.

---

## 6. QUERY COUNT SUMMARY TABLE

| Page | auth() calls | Total DB round trips (warm) | Total DB round trips (cold/worst) |
|------|-------------|---------------------------|----------------------------------|
| `/` (root) | 0 | 0 | 0 |
| `/demo` | 0 | 0 | 0 |
| `/login` | 0 | 0 | 0 |
| `/beta-terms` | 1 | 1 | 1 |
| `/dashboard` | 5 | 10–12 | 14–18 |
| `/project/[id]` | 2 (META+PAGE) | 11 | 15 |
| `/share/[token]` | 0 | 1 | 1 |
| `/invite/[token]` | 2 | 4 | 4 |
| `/invite/realm/[token]` | 2 | 4 | 4 |

---

## 7. PRIORITY RANKING

| Priority | Change | Effort | Savings |
|----------|--------|--------|---------|
| P1 | Wrap `auth()` with `React.cache()` | 2-line change | -4 queries/dashboard, -1/project |
| P2 | Pass `personalGroupId` through `ensurePersonalWorkspace` | Low | -2 queries/dashboard |
| P3 | Merge checklist summaries + previews into one function | Medium | -1 query/project board |
| P4 | Remove `generateMetadata` or use cache on `verifyProjectOwnership` | Low–Medium | -3 to -5 queries/project board |
| P5 | Parallelize first two checks in `verifyProjectOwnership` | Low | Latency improvement on realm path |
