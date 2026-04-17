# SHADOW JUDGE REVIEW - Phase 4: API + MCP Implementation
**Date:** 2026-02-28
**Scope:** REST API layer (8 route files), MCP server, auth helper, skill definition
**Context files reviewed:** DB schema, server actions, middleware, auth config, package.json

---

## Core Intent Assessment

This implementation adds two parallel access layers to an existing Next.js project manager:
1. A RESTful API (v1) for external HTTP clients with Bearer token + session auth
2. An MCP (Model Context Protocol) server enabling Claude/AI tool-use directly against the DB

The intent is clear and well-scoped. The API surface mirrors the existing server actions, and the MCP server provides the same operations as structured tools. This is a legitimate dual-interface pattern for an AI-augmented project management app.

---

## Standards Compliance (adapted for TypeScript/Next.js)

- **Auth pattern (DRY):** PASS - `authenticateRequest`, `verifyProjectOwnership`, `jsonError`, `jsonData` are properly extracted to `src/lib/api/auth.ts`. Every route uses the same 3-line auth preamble.
- **Import style:** PASS - All imports use `@/lib/` path aliases. No relative imports.
- **Documentation:** PASS - Minimal code, self-documenting. SKILL.md provides adequate tool documentation for MCP consumers.
- **Design focus:** PASS - No unnecessary abstractions. Routes are thin controllers over Drizzle queries.
- **OOP/Composition:** N/A - This is idiomatic Next.js route handlers (functional), which is correct for this context.

---

## Detailed Assessment by Criteria

### 1. Code Architecture

**Rating: B+**

Positives:
- Clean file structure following Next.js App Router conventions
- Auth helper properly extracted to shared module
- Consistent pattern across all routes (auth -> ownership check -> query -> respond)
- Route files are small (60-115 lines each) - well within maintainability limits

Issues found:

**P1 - `verifyProjectOwnership` exists in 4 places:**
- `src/lib/api/auth.ts` (API layer)
- `src/lib/actions/board.ts` (server actions)
- `src/lib/actions/gantt.ts` (server actions)
- `src/lib/actions/labels.ts` (server actions)

Each is an identical query. The API version returns `null`, the action versions `throw`. This should be one function.

**P2 - GET then SELECT on project detail route:**
In `src/app/api/v1/projects/[id]/route.ts`, the GET handler calls `verifyProjectOwnership` (which selects `{id}` only) then immediately does a full `select()` on the same project. That is two queries when one suffices. `verifyProjectOwnership` could return the full row, or the route should combine ownership check with the full select.

### 2. API Design

**Rating: B+**

Positives:
- Consistent `{ data: ... }` / `{ error: ... }` envelope
- Proper HTTP status codes: 200, 201, 400, 401, 404, 500
- RESTful URL structure: `/api/v1/projects/:id/tasks/:taskId`
- Filtering via query params on task list (status, priority)
- JSON parse errors caught with 400 response

Issues found:

**P1 - No input validation beyond "field exists":**
The API accepts any string for `status`, `priority`, `timeScale`, `color` without validating against allowed values. The MCP server uses Zod enums (`z.enum(['todo', 'in-progress', 'done'])`) but the REST routes do not. A client could POST `{ "status": "banana" }` and it would be stored. This is a data integrity gap.

**P1 - No pagination on list endpoints:**
`GET /api/v1/projects` and `GET /api/v1/projects/:id/tasks` return unbounded result sets. For an MCP-facing API where an AI might query projects with hundreds of tasks, this is a real concern. At minimum, add `limit` and `offset` query params with sensible defaults (e.g., limit=100).

**P2 - DELETE returns 200 with `{ data: { deleted: true } }` instead of 204 No Content:**
Standard REST practice for DELETE is 204. The current approach works but is non-idiomatic.

**P2 - No PATCH support:**
PUT is used for partial updates (only provided fields are updated). This is semantically PATCH behavior. While functional, a strict API review would expect PUT to replace the entire resource and PATCH for partial updates.

**P2 - `new Date(body.startDate as string)` without validation:**
If `startDate` is `"not-a-date"`, `new Date("not-a-date")` produces `Invalid Date` which will be stored in the DB. Date inputs need validation.

### 3. MCP Implementation

**Rating: A-**

Positives:
- Correct use of `createMcpHandler` from `mcp-handler`
- All 11 tools are well-defined with Zod schemas and descriptions
- `basePath: '/api'` is correct for the `[transport]` dynamic route at `/api/[transport]/route.ts`
- The `project_summary` tool is a smart addition that aggregates data for AI consumption
- Tool schemas use `.uuid()`, `.optional()`, `.describe()` properly
- Export pattern `{ handler as GET, handler as POST, handler as DELETE }` matches mcp-handler expectations

Issues found:

**P1 - MCP server bypasses project ownership verification:**
The MCP tools query directly with `userId()` from env var but do NOT verify that the `projectId` actually belongs to that user for operations like `list_tasks`, `create_task`, `update_task`, `delete_task`, `create_gantt_task`, etc.

For example, `delete_task` does:
```typescript
await db.delete(boardTasks)
  .where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, projectId)))
```
It checks `projectId` matches the task, but never verifies the project belongs to `userId()`. If the API user somehow knows another user's project ID, they could manipulate tasks in it. The `get_project` tool does check ownership, and `list_projects` is scoped, but all task-level operations skip it.

**P2 - `project_summary` fetches ALL tasks into memory:**
```typescript
const tasks = await db.select().from(boardTasks).where(eq(boardTasks.projectId, projectId))
```
Then iterates in JS for counting. This should use SQL aggregation (`COUNT`, `GROUP BY`) instead of fetching full rows to count in application code. For projects with many tasks this is wasteful.

**P2 - No `delete_project` or `update_project` MCP tools:**
The REST API has PUT and DELETE for projects, but MCP only has `list_projects`, `get_project`, and `create_project`. An AI agent cannot update project dates or delete a project through MCP.

**P2 - `sql` imported but unused in MCP route:**
Line 11 imports `sql` from `drizzle-orm` but it is never used.

### 4. Type Safety

**Rating: B**

Issues found:

**P1 - `Record<string, unknown>` for update payloads:**
Every PUT handler and MCP update tool builds `const updates: Record<string, unknown> = {}`. This bypasses Drizzle's type system entirely. Drizzle provides inferred types:

```typescript
// Better approach
import { boardTasks } from '@/lib/db/schema'
type BoardTaskUpdate = Partial<typeof boardTasks.$inferInsert>

const updates: BoardTaskUpdate = { updatedAt: new Date() }
```

This would catch typos in field names and type mismatches at compile time.

**P1 - Unsafe type assertions throughout:**
```typescript
body.name as string
body.description as string
(body.status as string) || 'todo'
(body.onTimeline as boolean) || false
```
These `as` casts bypass TypeScript's protection. If `body.onTimeline` is the string `"false"`, the cast `as boolean` still passes and `|| false` does not trigger because `"false"` is truthy. The Zod schemas in MCP are the right pattern -- the REST routes should also validate with Zod.

**P2 - `body` typed as `Record<string, unknown>` after JSON parse:**
The initial parse is fine, but then each field is accessed with manual type assertions instead of parsing through a schema. This is the most fragile part of the codebase.

### 5. DRY Principle

**Rating: C+**

This is the biggest architectural concern.

**P0 - Complete logic duplication across three layers:**

| Operation | Server Action | REST API Route | MCP Tool |
|-----------|--------------|----------------|----------|
| List projects | `getProjects()` | `GET /projects` | `list_projects` |
| Create project | `createProject()` | `POST /projects` | `create_project` |
| Update project | `updateProject()` | `PUT /projects/:id` | -- |
| Delete project | `deleteProject()` | `DELETE /projects/:id` | -- |
| List tasks | `getBoardTasks()` | `GET /tasks` | `list_tasks` |
| Create task | `createBoardTask()` | `POST /tasks` | `create_task` |
| Update task | `updateBoardTask()` | `PUT /tasks/:id` | `update_task` |
| Delete task | `deleteBoardTask()` | `DELETE /tasks/:id` | `delete_task` |

The `createProject` logic (insert project + insert 3 default rows) is literally copy-pasted three times:
- `src/lib/actions/projects.ts` lines 30-46
- `src/app/api/v1/projects/route.ts` lines 50-66
- `src/app/api/[transport]/route.ts` lines 64-83

The correct architecture is a **data access layer** (repository pattern or service functions) that all three consumers call:

```
src/lib/data/
  projects.ts    -> findProjects(), createProject(), updateProject(), deleteProject()
  tasks.ts       -> findTasks(), createTask(), updateTask(), deleteTask()
  gantt.ts       -> findGanttTasks(), createGanttTask(), updateGanttTask()
```

Then:
- Server actions call data functions + revalidatePath
- API routes call data functions + return JSON
- MCP tools call data functions + return text content

This eliminates triple-maintenance and ensures business logic changes propagate everywhere.

### 6. Performance

**Rating: B**

**P1 - Task list filtering rebuilds entire query:**
In `src/app/api/v1/projects/[id]/tasks/route.ts`, the filter logic is:
```typescript
let query = db.select().from(boardTasks).where(eq(boardTasks.projectId, id))....$dynamic()
if (status) {
  query = db.select().from(boardTasks).where(and(...))....$dynamic()  // completely new query
}
if (priority) {
  query = db.select().from(boardTasks).where(and(...))....$dynamic()  // completely new query again
}
```
Each filter branch reconstructs the query from scratch. The Drizzle `$dynamic()` method exists specifically to avoid this -- build conditions array then apply once:

```typescript
const conditions = [eq(boardTasks.projectId, id)]
if (status) conditions.push(eq(boardTasks.status, status))
if (priority) conditions.push(eq(boardTasks.priority, priority))

const data = await db.select().from(boardTasks)
  .where(and(...conditions))
  .orderBy(asc(boardTasks.orderIndex))
```

Note: the MCP `list_tasks` tool already does this correctly. Another consequence of the duplication problem.

**P2 - No unbounded query protection:**
All list queries return every matching row. With AI agents as consumers, this is riskier than with human users -- an agent might query frequently or across all projects.

**P2 - `verifyProjectOwnership` + full select = 2 round trips:**
Already noted above. The project detail GET does two sequential queries.

### 7. Error Handling

**Rating: B+**

Positives:
- Consistent `{ error: string }` format
- try-catch around JSON parsing
- Auth failures return proper 401
- Ownership failures return 404 (correct -- don't leak existence info)

Issues found:

**P1 - No top-level try-catch on route handlers:**
If a Drizzle query fails (DB connection, constraint violation, etc.), the error propagates as an unhandled exception. Next.js will return a generic 500, but the client gets no structured error response. Every handler should wrap in try-catch:

```typescript
export async function GET(request: NextRequest, { params }: Params) {
  try {
    // ... existing logic
  } catch (error) {
    return jsonError('Internal server error', 500)
  }
}
```

Or better yet, create a `withErrorHandler` wrapper.

**P2 - DELETE operations don't verify the entity existed:**
```typescript
await db.delete(boardTasks).where(and(eq(boardTasks.id, taskId), eq(boardTasks.projectId, id)))
return jsonData({ deleted: true })
```
If the task ID doesn't exist, the DELETE is a no-op and still returns `{ deleted: true }`. Should check affected rows or use `.returning()` to verify something was actually deleted.

### 8. Maintainability

**Rating: B**

Positives:
- Consistent patterns across all routes -- easy to add new endpoints by copying existing ones
- Auth pattern is centralized
- Small file sizes
- Skill documentation is clear for MCP consumers

Issues:
- The triple-duplication (DRY section) is the main maintainability risk. A schema change requires updates in 3 places.
- No shared validation schemas mean business rules (valid statuses, priorities, colors) are scattered.

### 9. State-of-the-Art Assessment (Feb 2026)

**What this implementation does well:**
- `mcp-handler` is the current standard library for Next.js MCP integration
- The `[transport]` dynamic route pattern is the recommended approach
- Zod schemas on MCP tools are best practice
- Bearer token + session hybrid auth is practical
- The API is versioned (v1)

**What top-1% implementations would do differently:**

1. **Zod-first validation everywhere** -- Define schemas once, share between REST validation, MCP tool schemas, and TypeScript types. Libraries like `zod` are already in the dependency tree.

2. **Data access layer** -- As described in the DRY section. This is the single biggest architectural gap.

3. **Rate limiting on API routes** -- No rate limiting exists. For a public-facing API with Bearer token auth, this is expected.

4. **OpenAPI spec generation** -- Top implementations would auto-generate an OpenAPI spec from the route definitions (e.g., using `next-swagger-doc` or `zod-to-openapi`).

5. **Request ID / correlation logging** -- No request tracing. The `onEvent` callback in mcp-handler config is unused.

6. **MCP auth integration** -- The `withMcpAuth` export from mcp-handler is not used. The MCP server runs completely unauthenticated (relies on being local only via `.mcp.json` pointing to localhost). For production, this needs the auth wrapper.

7. **Transaction support** -- `createProject` inserts a project then inserts default rows. If the row insert fails, you have an orphaned project. This should be wrapped in a transaction.

### 10. Streamlining Opportunities

**Merge 1 -- Shared data layer (eliminates ~40% of duplicated code):**
Create `src/lib/data/projects.ts`, `src/lib/data/tasks.ts`, etc. as pure data functions. Both server actions and API routes become thin wrappers.

**Merge 2 -- Shared Zod schemas:**
```typescript
// src/lib/schemas/tasks.ts
export const createTaskSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['todo', 'in-progress', 'done']).default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  color: z.string().default('purple'),
})
```
Use in REST routes (parse body), MCP tools (pass to `server.tool`), and server actions (validate input).

**Remove -- Unused `sql` import in MCP route.**

**Simplify -- Project GET double-query.** Make `verifyProjectOwnership` optionally return the full row.

---

## Priority Summary

### P0 (Must-fix)
1. **Extract data access layer** to eliminate triple-duplication of business logic across server actions, API routes, and MCP tools.

### P1 (Should-fix)
2. **Add input validation** on REST routes (Zod schemas, shared with MCP).
3. **Add top-level error handling** wrapper for all route handlers.
4. **Fix MCP ownership gap** -- task-level MCP tools must verify project belongs to the configured user.
5. **Fix task list filter logic** in REST route (build conditions array instead of rebuilding query).
6. **Use Drizzle inferred types** instead of `Record<string, unknown>` for updates.
7. **Add pagination** to list endpoints.
8. **Eliminate double-query** on project detail GET.

### P2 (Nice-to-have)
9. Add `delete_project` and `update_project` MCP tools for feature parity.
10. Use SQL aggregation in `project_summary` instead of fetching all rows.
11. Return 204 for DELETE operations (or at minimum verify deletion occurred).
12. Validate date strings before `new Date()` conversion.
13. Remove unused `sql` import.
14. Add transaction wrapping for `createProject` (project + default rows).
15. Consider `PATCH` vs `PUT` semantic distinction.
16. Add rate limiting for production deployment.

---

## Strategic Recommendation

The implementation is solid for an initial Phase 4 -- it works, the patterns are consistent, and the MCP integration is correctly structured. However, the **triple-duplication** is the architectural landmine. Before adding any more features, extract the data access layer. The effort is moderate (one session), and it prevents every future change from requiring three coordinated edits.

The second strategic priority is **shared Zod schemas**. You already have Zod as a dependency and use it correctly in MCP tools. Extending that pattern to REST routes eliminates an entire class of data integrity bugs and removes the manual `as string` casts.

Both of these changes are structural -- they don't add features but dramatically improve the codebase's resistance to rot over time.
