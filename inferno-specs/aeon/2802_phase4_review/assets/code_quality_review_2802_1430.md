# SHADOW JUDGE REVIEW -- Phase 4 Second Pass
**Date:** 2026-02-28
**Scope:** AEON Phase 4 data layer refactor verification
**Previous Grade:** B (P0 x1, P1 x7)

---

## P0/P1 Issue Verification

### P0: Triple Duplication -> Data Access Layer Extraction
**STATUS: RESOLVED**

Data layer is now cleanly extracted into `src/lib/data/`:
- `projects.ts` -- all project CRUD + summary
- `tasks.ts` -- all board task CRUD + reorder
- `gantt.ts` -- gantt tasks + rows CRUD
- `labels.ts` -- labels + task-label junction
- `validators.ts` -- shared Zod schemas + inferred types

All three consumers (REST routes, Server Actions, MCP tools) import from this shared layer. No inline DB queries remain in route handlers or actions.

### P1.1: No REST Validation -> Shared Zod Schemas
**STATUS: RESOLVED**

`validators.ts` defines 7 schemas (create/update for project, task, gantt task; create label) with proper constraints:
- String length limits (255/5000/10000/100)
- Enum validation for status, priority, timeScale
- ISO date refinements with custom error messages
- Integer constraints on progress (0-100) and orderIndex
- Types inferred with `z.infer` and exported

All REST POST/PUT handlers call `.safeParse()` before proceeding.

### P1.2: MCP Ownership Bypass -> requireOwnership on Every Tool
**STATUS: RESOLVED**

Every MCP tool that takes a `projectId` calls `requireOwnership()` before any data access. `list_projects` and `get_project` use `userId()` directly in the query which is equally correct. The gantt create/update tools additionally verify row ownership.

### P1.3: No Error Handling -> apiHandler Wrapper
**STATUS: RESOLVED**

`apiHandler` in `auth.ts` wraps every REST handler with try/catch, logging to `console.error` and returning 500. JSON parse failures are caught separately with 400 responses in each POST/PUT handler.

### P1.4: Filter Query Rebuilt -> Conditions Array in Data Layer
**STATUS: RESOLVED**

`findTasks()` in `tasks.ts` builds a `conditions` array starting with the projectId filter, then conditionally pushes status/priority filters. Passed to `and(...conditions)`. Clean pattern.

### P1.5: Record<string, unknown> -> Partial<typeof table.$inferInsert>
**STATUS: RESOLVED**

All update functions in the data layer use `Partial<typeof tableName.$inferInsert>` for the updates object. The only remaining `Record<string, unknown>` instances are in UI component prop types (GanttChart, ProjectContent) and `auth.ts` -- all outside the scope of this refactor and acceptable in their context.

### P1.6: No Pagination -> Limit/Offset on List Endpoints
**STATUS: RESOLVED**

- `findProjects()` -- `limit = 100, offset = 0` defaults, REST caps at 500
- `findTasks()` -- `limit = 200, offset = 0` defaults, REST caps at 500
- MCP `list_projects` does not pass limit/offset (uses defaults), which is acceptable for MCP tooling

### P1.7: Double Query on Project GET -> Single findProjectById
**STATUS: RESOLVED**

`projects/[id]/route.ts` GET handler calls `findProjectById(id, result.id)` once, returning the result directly. No separate ownership check + data fetch.

---

## Architecture Assessment

### Layering Quality: STRONG

```
UI Components
    |
Server Actions (src/lib/actions/)    REST Routes (src/app/api/v1/)    MCP (src/app/api/[transport]/)
    |                                      |                              |
    +--------------------------------------+------------------------------+
    |
Data Layer (src/lib/data/)
    |
Drizzle ORM (src/lib/db/)
    |
PostgreSQL (Neon)
```

Clean separation. No leaky abstractions. Route handlers contain ONLY:
- Authentication
- Param extraction
- Validation
- Data layer delegation
- Response formatting

Server Actions contain ONLY:
- Session auth
- Ownership verification
- Data layer delegation
- Cache revalidation

### Remaining Observations

#### 1. Duplicate helper functions in Server Actions (P2 -- minor)
`requireAuth()` and `requireOwnership()` are defined identically in `board.ts`, `gantt.ts`, and `labels.ts`. This is a conscious trade-off: Next.js `'use server'` modules must be self-contained. Extracting these to a shared module is possible but would require that shared module to also be `'use server'`, which is valid. Not critical, but worth noting as a potential cleanup.

#### 2. `verifyProjectOwnership` vs `findProjectById` are identical queries (P2 -- minor)
Both functions in `projects.ts` (lines 6-12 and 25-31) execute the exact same query. `verifyProjectOwnership` exists as a semantic alias. This is not harmful -- the naming communicates intent -- but one could be implemented as `return findProjectById(projectId, userId)`.

#### 3. `findTaskLabels()` fetches ALL task labels globally (P2 -- design concern)
`labels.ts` line 13-15: `findTaskLabels()` has no projectId filter. It returns every row from the `task_labels` table across all users/projects. This is called from `getTaskLabels(projectId)` in the labels action, which does check ownership but then ignores the projectId for the actual query. This will return incorrect/excessive data as the app scales.

#### 4. `getProjectSummary` does not verify ownership (P2 -- security gap)
In `projects.ts`, `getProjectSummary()` takes only `projectId` with no `userId` parameter. It queries without ownership filtering. The MCP tool calls `requireOwnership` before calling it, so the MCP path is safe. But the function itself is unprotected if called from anywhere else. This is an API contract concern.

#### 5. `parseInt` without NaN guard on query params (P3 -- edge case)
In `projects/route.ts` and `tasks/route.ts`, `parseInt(url.searchParams.get('limit') || '100')` will work for the fallback but if someone passes `?limit=abc`, `parseInt('abc')` returns `NaN`. `Math.min(NaN, 500)` returns `NaN`. Drizzle may handle this gracefully but it is not explicit.

#### 6. MCP auth uses env-var userId, not request-derived (P3 -- by design)
The MCP server uses `process.env.AEON_API_USER_ID` for all operations. This is appropriate for a single-tenant MCP setup but worth documenting that it is intentionally single-user.

#### 7. No `updateLabel` schema or endpoint (P3 -- feature gap)
There is `createLabelSchema` but no `updateLabelSchema`. The labels route only has GET/POST, no PUT/DELETE at the REST level. The data layer has `deleteLabel` but no REST route exposes it. This is likely intentional for current scope but creates an asymmetry.

---

## Scores by Category

| Category | Score | Notes |
|----------|-------|-------|
| DRY Compliance | 9/10 | Triple duplication fully resolved. Minor helper duplication in actions is acceptable |
| Type Safety | 9/10 | Proper `$inferInsert` partials, Zod inferred types, schema-driven validation |
| Auth/Security | 8/10 | All paths covered. `getProjectSummary` and `findTaskLabels` lack built-in guards |
| API Design | 9/10 | Clean REST conventions, proper status codes, consistent response envelope |
| MCP Quality | 9/10 | Good descriptions, ownership on every tool, schema reuse. Single-user by design |
| Layering | 9.5/10 | Textbook clean. No leaky abstractions |
| Code Clarity | 9/10 | Functions are small, named well, obvious in purpose |

---

## Final Grade: 8.5/10 (A-)

Up from B. All P0/P1 issues are resolved. The refactored architecture is clean, well-layered, and maintainable. The remaining items are all P2/P3 level.

---

## Items That Would Move Score to 9+

1. **Fix `findTaskLabels()` to accept `projectId`** -- Join through `boardTasks` to filter by project, or add a `projectId` column to `task_labels`. Currently returns global data.

2. **Collapse `verifyProjectOwnership` into `findProjectById`** -- One function, two names, identical queries. Use `findProjectById` everywhere, or have `verifyProjectOwnership` call `findProjectById` internally.

3. **Add NaN guard to pagination params** -- `const limit = Math.min(parseInt(...) || 100, 500)` -- one `|| defaultValue` addition per param.

4. **Add `userId` param to `getProjectSummary`** -- Defense in depth. The function should not be callable without ownership context.

5. **Extract `requireAuth`/`requireOwnership` from Server Actions** -- Create `src/lib/actions/auth-helpers.ts` with `'use server'` directive. Import in board/gantt/labels/projects actions. Removes 4x identical 10-line blocks.
