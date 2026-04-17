# Architectural Archaeology — REST API Rebuild Recon
**Date:** 2403 10:45
**Scope:** Full gap analysis for REST /api/v1/ rebuild

---

## SHADOW PROWLER RECONNAISSANCE

### Mission Objective
Map the current /api/v1/ REST surface, the MCP tool surface, and the lib/data/ layer to produce a precise gap analysis for the REST rebuild: thin wrappers, shared Zod schemas, consistent { data, error } envelope, full CRUD for all 10 domains, pagination on all list endpoints, PATCH for partial updates.

---

## Structural Intelligence

### Class Architecture
The codebase uses a three-layer flat architecture — no classes, no ORM abstractions beyond Drizzle's query builder:

```
Route handlers (HTTP/MCP)
    ↓
lib/api/auth.ts  ← shared auth utilities
    ↓
lib/data/*.ts    ← single source of truth, Drizzle ORM, direct SQL
    ↓
lib/db/schema.ts ← Drizzle schema (22 tables)
```

Three parallel consumer surfaces all hit lib/data/ directly:
1. `src/app/api/v1/` — REST routes (20 endpoints, 5 resources)
2. `src/app/api/[transport]/tools/` — MCP tools (40 tools, 10 resources)
3. `src/lib/actions/` — Next.js Server Actions (UI-only, session auth)

### Component Relationships

**lib/api/auth.ts** exports:
- `authenticateRequest(req)` — Bearer (master key or `aeon_k1_` API key) or session fallback
- `isApiUser(result)` — type guard
- `apiHandler(fn)` — top-level try/catch wrapper, logs to console
- `jsonData(data, status)` — wraps in `{ data }`
- `jsonError(message, status)` — wraps in `{ error }`

**lib/data/validators.ts** — single Zod schema file, 260 lines. Exports:
- createProjectSchema, updateProjectSchema
- createTaskSchema, updateTaskSchema
- createColumnSchema, updateColumnSchema
- createGanttTaskSchema, updateGanttTaskSchema
- createGanttViewSchema, updateGanttViewSchema
- createLabelSchema, updateLabelSchema
- createChecklistItemSchema, updateChecklistItemSchema
- createRowSchema, updateRowSchema
- addDependencySchema
- reorderTaskEntrySchema
- createCanvasNodeSchema, updateCanvasNodeSchema, createCanvasEdgeSchema
- sendToVaultSchema, batchVaultSchema
- preferencesSchema
- Missing: createCommentSchema, updateCommentSchema (comments have no Zod schemas — inline in MCP tools)

### Data Flow Patterns
All data flow is synchronous request/response. No pub/sub, no WebSockets in data layer.
Activity events (`emitActivity`) are fire-and-forget (`.catch(() => {})`).
Checklist→Gantt bridge sync (`syncChecklistToGanttProgress`) is also fire-and-forget.

---

## Database Schema (22 tables via Drizzle, PostgreSQL)

| Table | PK | Key FKs | Notes |
|-------|-----|---------|-------|
| `users` | uuid | — | NextAuth |
| `accounts` | (provider, providerAccountId) | users.id | NextAuth OAuth |
| `sessions` | sessionToken | users.id | NextAuth |
| `verification_tokens` | (identifier, token) | — | NextAuth |
| `projects` | uuid | users.id | cascade delete |
| `gantt_views` | uuid | projects.id | cascade delete |
| `rows` | uuid | projects.id, ganttViews.id | Gantt rows |
| `gantt_tasks` | uuid | projects.id, rows.id, boardTasks.id | boardTaskId is set null on delete |
| `board_columns` | uuid | projects.id | cascade delete |
| `board_tasks` | uuid | projects.id, boardColumns.id, ganttTasks.id | columnId set null on delete |
| `labels` | uuid | projects.id | cascade delete |
| `task_labels` | (taskId, labelId) | boardTasks.id, labels.id | join table |
| `task_dependencies` | (blockerTaskId, blockedTaskId) | boardTasks.id | cascade delete |
| `checklist_items` | uuid | boardTasks.id | cascade delete |
| `canvas_nodes` | uuid | projects.id | cascade delete |
| `canvas_edges` | uuid | projects.id, canvasNodes×2 | cascade delete |
| `user_preferences` | userId | users.id | 1:1 with user |
| `api_keys` | uuid | users.id | cascade delete |
| `task_vault` | uuid | projects.id | originalTaskId NOT FK (nullable, task deleted) |
| `task_comments` | uuid | boardTasks.id, users.id | cascade delete |
| `activity_events` | uuid | projects.id | entityId is NOT a FK (polymorphic) |

**Critical coupling:** `board_tasks.ganttTaskId` and `gantt_tasks.boardTaskId` form a bidirectional soft link. `lib/data/bridge.ts` (570 lines) manages sync between board and gantt state — setting status, progress, timeline flags. This is entirely internal and not externally exposed.

---

## Design Pattern Detection

**apiHandler wrapper** — Thin decorator pattern. Every route wrapped in try/catch. Pattern is consistent across all 20 REST routes but the ownership check inside each handler is copy-pasted (not abstracted like Server Actions use `requireOwnership()`).

**MCP tool registration** — Register function pattern. Each tool file exports `registerXTools(server)`. Route.ts calls them all on init. Clean separation.

**Zod safeParse + first-error message** — All REST routes use `schema.safeParse(body)` then return `parsed.error.issues[0].message`. This is consistent but only surfaces the first validation error. MCP uses the same schemas but calls `.parse()` directly (would throw on failure, caught by MCP framework).

**verifyProjectOwnership alias** — `verifyProjectOwnership` is literally `export const verifyProjectOwnership = findProjectById`. It returns the project row or null. The ownership check is a byproduct of a SELECT. Both REST and MCP duplicate this pattern per-handler.

---

## Current API Response Patterns

### REST envelope (CONSISTENT)
Success: `{ data: T }` via `jsonData()`
Error: `{ error: "message string" }` via `jsonError()`
HTTP status codes are used appropriately (200, 201, 400, 401, 404, 500).
No `meta` field — pagination info (total count) is never returned.

### MCP envelope (DIFFERENT)
Success: `{ content: [{ type: "text", text: JSON.stringify(data) }] }`
Error: `{ content: [{ type: "text", text: "Entity not found" }], isError: true }`
Not an HTTP-style envelope at all — MCP protocol format.

### Pagination (INCONSISTENT)
- REST `/projects` — limit/offset, no total count
- REST `/tasks` — limit/offset, no total count
- REST `/labels` — NO pagination params
- REST `/gantt` — NO pagination params
- MCP tools — limit/offset on list_tasks, list_labels; none on list_gantt_tasks

### HTTP verb usage (INCONSISTENT)
All REST updates use PUT (semantically full replacement, but implementations are partial patch logic). The api-keys route already uses PATCH. Mixed signal.

---

## MCP Access Pattern
MCP tools call lib/data/ DIRECTLY. They do NOT go through REST routes. Auth bridge: `verifyToken` in `[transport]/route.ts` creates a fake NextRequest, calls `authenticateRequest`, extracts userId into `extra.authInfo.extra.userId`. Each tool calls `getUserId(extra)` to retrieve it.

---

## Gap Analysis

### What EXISTS (REST /api/v1/)
```
GET    /projects                           findProjects (paginated)
POST   /projects                           createProject
GET    /projects/[id]                      findProjectById
PUT    /projects/[id]                      updateProject (partial)
DELETE /projects/[id]                      deleteProject
GET    /projects/[id]/tasks                findTasks (paginated, status/priority filter)
POST   /projects/[id]/tasks                createTask
GET    /projects/[id]/tasks/[taskId]       findTaskById
PUT    /projects/[id]/tasks/[taskId]       updateTask (partial)
DELETE /projects/[id]/tasks/[taskId]       deleteTask
GET    /projects/[id]/gantt                findGanttTasksWithRows
POST   /projects/[id]/gantt                createGanttTask
PUT    /projects/[id]/gantt/[taskId]       updateGanttTask
DELETE /projects/[id]/gantt/[taskId]       deleteGanttTask
GET    /projects/[id]/labels               findLabels
POST   /projects/[id]/labels               createLabel
GET    /api-keys                           listApiKeys
POST   /api-keys                           createApiKey
PATCH  /api-keys/[id]                      renameApiKey
DELETE /api-keys/[id]                      revokeApiKey
```

### What is MISSING (has data layer + MCP but no REST)

| Resource | Missing REST endpoints | Data functions available |
|----------|------------------------|--------------------------|
| Projects | GET /projects/[id]/summary | getProjectSummary |
| Columns | ALL — GET/POST /columns, PATCH/DELETE /columns/[colId], POST /columns/reorder | findColumns, createColumn, updateColumn, deleteColumn, reorderColumns |
| Tasks | GET /tasks/[taskId]/detail, POST /tasks/batch | findTaskWithDetails, createTasksBatch |
| Labels | PATCH /labels/[labelId], DELETE /labels/[labelId], POST /tasks/[taskId]/labels, DELETE /tasks/[taskId]/labels/[labelId], PUT /tasks/[taskId]/labels | updateLabel, deleteLabel, addLabelToTask, removeLabelFromTask, setTaskLabels |
| Checklist | ALL — GET/POST /tasks/[taskId]/checklist, PATCH/DELETE /checklist/[itemId], POST /checklist/batch | findChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem, createChecklistItemsBatch |
| Comments | ALL — GET/POST /tasks/[taskId]/comments, PATCH/DELETE /comments/[commentId] | findComments, createComment, updateComment, deleteComment |
| Dependencies | ALL — GET/POST/DELETE /dependencies | findDependencies, addDependency, removeDependency, addDependenciesBatch |
| Vault | ALL — GET /vault, POST /vault/send, POST /vault/restore/[id] | findVaultTasks, getVaultStats, vaultTask, vaultTasksBatch, restoreFromVault |
| Velocity | GET /velocity | getVelocityStats |
| Gantt GET | No GET /gantt/[taskId] | findGanttTasks (individual lookup not exposed) |

### What EXISTS NOWHERE (no data layer, no MCP, no REST)
- Canvas CRUD (data layer exists: lib/data/canvas.ts — 4 functions)
- Gantt views CRUD (data layer exists: lib/data/ganttViews.ts — 5 functions)
- User preferences via REST (data layer exists: lib/data/preferences.ts)
- Bridge operations (internal only, by design)

---

## Refactoring Issues

| Issue | Location | Description |
|-------|----------|-------------|
| PUT should be PATCH | /projects/[id], /projects/[id]/tasks/[taskId], /projects/[id]/gantt/[taskId] | All are partial updates; PUT semantically implies full replacement |
| No activity emission | All REST routes | MCP emits activity events on mutations; REST routes do not. Same operation produces different audit trail depending on caller. |
| No total count in pagination | /projects, /tasks | list responses return array with no total, making cursor-based UI impossible |
| Inline enum duplication | /tasks route (line 10-11) | statusSchema and prioritySchema defined inline, duplicate validators.ts |
| Manual body cast | /api-keys, /api-keys/[id] | `body as { name?: string }` bypasses Zod — inconsistent with all other routes |
| Double ownership fetch | /projects/[id] PUT and DELETE | Calls findProjectById for ownership check, then again inside updateProject/deleteProject |
| No total count returned | All list endpoints | Response is bare `{ data: [...] }` with no meta object |
| Missing GET for gantt individual task | /projects/[id]/gantt | No GET /gantt/[taskId], only list all |
| No createCommentSchema in validators.ts | lib/data/validators.ts | Comments have no Zod schema; MCP tools use inline z.string() |
| Labels list returns no task assignments | /projects/[id]/labels | MCP list_labels returns {labels, taskLabels}; REST only returns labels array |

---

## Hidden Dependencies

1. **Bridge coupling**: `lib/data/bridge.ts` is called from checklist and board actions as fire-and-forget. If REST routes add checklist/task updates, they should also call bridge sync functions the same way Server Actions do.

2. **Vault is destructive**: `vaultTask()` and `vaultTasksBatch()` run a transaction that INSERTs into task_vault AND DELETES from board_tasks. Any REST endpoint for vault must make this clear — it is not an archive, it is a move with deletion.

3. **orderIndex auto-assignment**: `createTask`, `createColumn`, `createGanttTask` all compute `max(orderIndex) + 1` inside transactions. REST routes do not need to pass orderIndex — the data layer handles it. The validators mark it as optional for this reason.

4. **api-keys rate limit**: POST /api-keys enforces a 10-key cap via `countActiveKeys`. This business rule lives in the route handler, not the data layer.

5. **taskLabels bidirectional read**: The MCP `list_labels` tool returns BOTH the project labels AND task-label assignments in one call. The REST GET /labels only returns project labels. Any REST rebuild of labels needs to decide whether to split this or match MCP behavior.

6. **Gantt GET has no [taskId]**: `lib/data/gantt.ts` has `findGanttTasks(projectId)` but no `findGanttTaskById`. The individual delete/update routes accept taskId but there is no corresponding GET.

---

## Reconnaissance Warnings

- `task_vault.originalTaskId` is nullable and NOT a foreign key. The original boardTask is deleted at vault time. Do not attempt joins.
- `activity_events.entityId` is NOT a foreign key. It is a polymorphic UUID. Do not attempt joins.
- `boardTasks.archivedAt` and `boardTasks.completedAt` are managed by the data layer, not Zod validators. The archive/restore endpoints (Server Actions only currently) bypass these through `archiveTask()` / `restoreTask()`.
- `ganttTasks.boardTaskId` / `boardTasks.ganttTaskId` form a bidirectional link. Creating a gantt task with `boardTaskId` does NOT automatically update the boardTask's `ganttTaskId`. That sync is `bridge.ts`'s responsibility.

---

## Strategic Recommendations

### Architecture Decision (already documented in docs/mcp-api-audit.md)
MCP and REST both call lib/data/ directly. Do NOT make MCP proxy through REST. Rationale: same process, adds latency and auth complexity for zero benefit.

### Priority Order for REST Rebuild

**P0 — Fix existing routes:**
- PUT → PATCH on /projects/[id], /tasks/[taskId], /gantt/[taskId]
- Add Zod to api-keys POST and PATCH
- Add `meta: { total, limit, offset }` to all list responses
- Import status/priority enums from validators.ts in tasks route
- Emit activity events on all mutations

**P1 — New routes (data + MCP already proven):**
- Columns CRUD + reorder
- Checklist CRUD + batch
- Comments CRUD
- Dependencies (list/add/remove/batch)
- Labels update/delete + task assignment endpoints

**P2 — Composite + analytics:**
- GET /projects/[id]/summary
- GET /projects/[id]/tasks/[taskId]/detail
- GET /projects/[id]/vault + vault send/restore
- GET /projects/[id]/velocity

**P3 — Currently unexposed:**
- Canvas CRUD
- Gantt views CRUD
- User preferences

### Shared infrastructure needed for rebuild
```
lib/api/respond.ts   ← jsonOk(data, meta?, status), jsonFail(message, code, status)
lib/api/paginate.ts  ← parsePagination(url) → { limit, offset }
```
The `{ data, error }` envelope already exists in `lib/api/auth.ts` as `jsonData` / `jsonError`. A `meta` field needs to be added for pagination responses. The cleanest approach is a new `jsonOk(data, meta?, status)` helper that returns `{ data, error: null, meta }` and a `jsonFail(message, code, status)` that returns `{ data: null, error: { message, code } }`.
