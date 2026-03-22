# Aeon MCP & REST API Audit

**Date:** 22/03/2026
**Scope:** Full inventory of MCP tools, REST routes, data layer, gap analysis, recommendations

---

## 1. MCP Tool Inventory (33 tools)

All tools live in `src/app/api/[transport]/route.ts` (860 lines). Every tool calls `lib/data/` directly with Zod validation from `lib/data/validators.ts`. All require Bearer token auth via `withMcpAuth`. All verify project ownership via `requireOwnership()`.

| # | Tool | Category | Data Function | Has REST Equivalent |
|---|------|----------|---------------|---------------------|
| 1 | `list_projects` | Projects | `findProjects` | GET /projects |
| 2 | `get_project` | Projects | `findProjectById` | GET /projects/[id] |
| 3 | `create_project` | Projects | `createProject` | POST /projects |
| 4 | `update_project` | Projects | `updateProject` | PUT /projects/[id] |
| 5 | `delete_project` | Projects | `deleteProject` | DELETE /projects/[id] |
| 6 | `project_summary` | Projects | `getProjectSummary` | **NO** |
| 7 | `list_columns` | Columns | `findColumns` | **NO** |
| 8 | `create_column` | Columns | `createColumn` | **NO** |
| 9 | `update_column` | Columns | `updateColumn` | **NO** |
| 10 | `delete_column` | Columns | `deleteColumnData` | **NO** |
| 11 | `reorder_columns` | Columns | `reorderColumns` | **NO** |
| 12 | `list_tasks` | Tasks | `findTasks` | GET /projects/[id]/tasks |
| 13 | `create_task` | Tasks | `createTask` | POST /projects/[id]/tasks |
| 14 | `update_task` | Tasks | `updateTask` | PUT /projects/[id]/tasks/[taskId] |
| 15 | `delete_task` | Tasks | `deleteTask` | DELETE /projects/[id]/tasks/[taskId] |
| 16 | `get_task_detail` | Tasks | `findTaskWithDetails` | **NO** |
| 17 | `batch_create_tasks` | Tasks | `createTasksBatch` | **NO** |
| 18 | `list_gantt_tasks` | Gantt | `findGanttTasksWithRows` | GET /projects/[id]/gantt |
| 19 | `create_gantt_task` | Gantt | `createGanttTask` | POST /projects/[id]/gantt |
| 20 | `update_gantt_task` | Gantt | `updateGanttTask` | PUT /projects/[id]/gantt/[taskId] |
| 21 | `list_dependencies` | Dependencies | `findDependencies` | **NO** |
| 22 | `add_dependency` | Dependencies | `addDependency` | **NO** |
| 23 | `remove_dependency` | Dependencies | `removeDependency` | **NO** |
| 24 | `batch_add_dependencies` | Dependencies | `addDependenciesBatch` | **NO** |
| 25 | `list_labels` | Labels | `findLabels` + `findTaskLabels` | GET /projects/[id]/labels |
| 26 | `create_label` | Labels | `createLabel` | POST /projects/[id]/labels |
| 27 | `delete_label` | Labels | `deleteLabel` | **NO** |
| 28 | `add_label_to_task` | Labels | `addLabelToTask` | **NO** |
| 29 | `remove_label_from_task` | Labels | `removeLabelFromTask` | **NO** |
| 30 | `set_task_labels` | Labels | `setTaskLabels` | **NO** |
| 31 | `create_checklist_item` | Checklist | `createChecklistItem` | **NO** |
| 32 | `update_checklist_item` | Checklist | `updateChecklistItem` | **NO** |
| 33 | `delete_checklist_item` | Checklist | `deleteChecklistItem` | **NO** |
| 34 | `batch_create_checklist_items` | Checklist | `createChecklistItemsBatch` | **NO** |
| 35 | `list_comments` | Comments | `findComments` | **NO** |
| 36 | `add_comment` | Comments | `createComment` | **NO** |
| 37 | `update_comment` | Comments | `updateComment` | **NO** |
| 38 | `delete_comment` | Comments | `deleteComment` | **NO** |
| 39 | `setup_board` | Bulk | multiple | **NO** |
| 40 | `get_velocity_stats` | Analytics | `getVelocityStats` | **NO** |

**MCP-only operations (no REST):** 27 of 40 tools have no REST equivalent.

---

## 2. REST API Route Inventory

All routes under `src/app/api/v1/`. Auth via `authenticateRequest()` (Bearer token or session). Wrapped in `apiHandler()` for top-level try-catch.

| Method | Path | Zod Validation | Data Layer | Issues |
|--------|------|----------------|------------|--------|
| GET | `/projects` | No (parseInt pagination) | `findProjects` | `parseInt \|\| default` treats limit=0 as unset; no total count |
| POST | `/projects` | `createProjectSchema` | `createProject` | Clean |
| GET | `/projects/[id]` | N/A | `findProjectById` | Clean |
| PUT | `/projects/[id]` | `updateProjectSchema` | `updateProject` | Double-fetch for ownership |
| DELETE | `/projects/[id]` | N/A | `deleteProject` | Double-fetch for ownership |
| GET | `/projects/[id]/tasks` | Inline statusSchema/prioritySchema | `findTasks` | Duplicates enums from validators.ts; no total count |
| POST | `/projects/[id]/tasks` | `createTaskSchema` | `createTask` | Clean |
| GET | `/projects/[id]/tasks/[taskId]` | N/A | `findTaskById` | Clean |
| PUT | `/projects/[id]/tasks/[taskId]` | `updateTaskSchema` | `updateTask` | Clean |
| DELETE | `/projects/[id]/tasks/[taskId]` | N/A | `deleteTask` | Clean |
| GET | `/projects/[id]/gantt` | N/A | `findGanttTasksWithRows` | No pagination |
| POST | `/projects/[id]/gantt` | `createGanttTaskSchema` | `createGanttTask` | Clean |
| PUT | `/projects/[id]/gantt/[taskId]` | `updateGanttTaskSchema` | `updateGanttTask` | Clean |
| DELETE | `/projects/[id]/gantt/[taskId]` | N/A | `deleteGanttTask` | Clean |
| GET | `/projects/[id]/labels` | N/A | `findLabels` | No pagination |
| POST | `/projects/[id]/labels` | `createLabelSchema` | `createLabel` | Clean |
| GET | `/api-keys` | N/A | `listApiKeys` | Clean |
| POST | `/api-keys` | Manual cast (no Zod) | `createApiKey` | Unsafe `body as { name? }` |
| PATCH | `/api-keys/[id]` | Manual cast (no Zod) | `renameApiKey` | Unsafe `body as { name? }` |
| DELETE | `/api-keys/[id]` | N/A | `revokeApiKey` | Clean |

**REST coverage: 20 endpoints across 5 resources (projects, tasks, gantt, labels, api-keys).**

---

## 3. Data Layer Inventory

`src/lib/data/` — 17 modules, 2,784 lines total. This is the single source of truth that both MCP and REST consume.

| Module | Lines | Functions | Used by MCP | Used by REST |
|--------|-------|-----------|-------------|--------------|
| `projects.ts` | 131 | 6 | All 6 | 5 of 6 (no `getProjectSummary`) |
| `tasks.ts` | 214 | 6 | All 6 | 4 of 6 (no batch, no findById) |
| `columns.ts` | 148 | 5 | All 5 | 0 |
| `labels.ts` | 113 | 7 | All 7 | 2 of 7 |
| `dependencies.ts` | 110 | 5 | All 5 | 0 |
| `checklist.ts` | 165 | 6 | All 6 | 0 |
| `comments.ts` | 87 | 4 | All 4 | 0 |
| `gantt.ts` | 145 | 5 | All 5 | All 5 |
| `ganttViews.ts` | 181 | 5 | 0 | 0 |
| `bridge.ts` | 570 | 8 | 0 | 0 |
| `canvas.ts` | 100 | 4 | 0 | 0 |
| `vault.ts` | 202 | 5 | 0 | 0 |
| `velocity.ts` | 184 | 1 | 1 | 0 |
| `activity.ts` | 59 | 1 | Used as side-effect | 0 |
| `api-keys.ts` | 93 | 5 | 0 | All 5 |
| `validators.ts` | 258 | Schemas | Shared | Partial |
| `preferences.ts` | 24 | 1 | 0 | 0 |

---

## 4. Gap Analysis

### 4a. Resources with NO REST endpoints

| Resource | MCP Tools | Data Functions | REST Routes |
|----------|-----------|----------------|-------------|
| **Columns** | 5 tools | 5 functions | **0 routes** |
| **Checklist** | 4 tools | 6 functions | **0 routes** |
| **Comments** | 4 tools | 4 functions | **0 routes** |
| **Dependencies** | 4 tools | 5 functions | **0 routes** |
| **Vault** | 0 tools | 5 functions | **0 routes** |
| **Velocity** | 1 tool | 1 function | **0 routes** |
| **Canvas** | 0 tools | 4 functions | **0 routes** |
| **GanttViews** | 0 tools | 5 functions | **0 routes** |
| **Bridge** | 0 tools | 8 functions | **0 routes** |
| **Preferences** | 0 tools | 1 function | **0 routes** |

### 4b. Operations that exist nowhere

| Operation | Notes |
|-----------|-------|
| Delete gantt task via MCP | `deleteGanttTask` exists in data layer but no MCP tool |
| Gantt view CRUD | Data functions exist, no MCP or REST |
| Canvas CRUD | Data functions exist, no MCP or REST |
| Board-Gantt bridge ops | Data functions exist (570 lines), no external interface |
| Vault send/restore via MCP | Only exposed via server actions (UI), not MCP or REST |
| User preferences via REST | Only via server actions |

### 4c. Consistency issues

| Issue | Details |
|-------|---------|
| Response envelope | REST uses `{ data }` / `{ error }`. MCP uses `{ content: [{ type: 'text', text: JSON.stringify(data) }] }`. Different shapes. |
| Activity emission | MCP tools emit activity events. REST routes do NOT. Same operation via REST vs MCP produces different audit trails. |
| Pagination | MCP `list_tasks` and `list_labels` support limit/offset. REST `GET /tasks` supports it. REST `GET /labels`, `GET /gantt` do not. |
| PATCH vs PUT | REST uses PUT for partial updates (semantically should be PATCH). MCP doesn't use HTTP verbs. |
| Api-keys validation | Only REST resource that skips Zod — uses manual type casts. |

---

## 5. Recommendations

### 5a. REST API expansion (priority order)

| Priority | Resource | Routes to Add |
|----------|----------|---------------|
| P1 | Columns | GET/POST `/projects/[id]/columns`, PATCH/DELETE `/projects/[id]/columns/[colId]`, POST `/projects/[id]/columns/reorder` |
| P1 | Checklist | GET/POST `/projects/[id]/tasks/[taskId]/checklist`, PATCH/DELETE `.../checklist/[itemId]` |
| P1 | Comments | GET/POST `/projects/[id]/tasks/[taskId]/comments`, PATCH/DELETE `.../comments/[commentId]` |
| P1 | Dependencies | GET/POST/DELETE `/projects/[id]/dependencies` |
| P2 | Vault | POST `/projects/[id]/vault/send`, POST `/projects/[id]/vault/restore/[vaultId]`, GET `/projects/[id]/vault` |
| P2 | Velocity | GET `/projects/[id]/velocity?range=30d` |
| P2 | Task detail | GET `/projects/[id]/tasks/[taskId]/detail` (composite: task + checklist + labels + deps) |
| P2 | Project summary | GET `/projects/[id]/summary` |
| P3 | Batch ops | POST `/projects/[id]/tasks/batch`, POST `/projects/[id]/setup` |
| P3 | Canvas | CRUD under `/projects/[id]/canvas/nodes` and `/edges` |
| P3 | Gantt views | CRUD under `/projects/[id]/gantt/views` |

### 5b. Standardisation fixes

| Fix | Details |
|-----|---------|
| Consistent envelope | All routes: `{ data: T, error: null, meta?: { total, limit, offset } }` on success, `{ data: null, error: { message, code } }` on failure |
| Pagination everywhere | All list endpoints get `limit` + `offset` params + `meta.total` in response |
| PATCH not PUT | Use PATCH for partial updates, reserve PUT for full replacement (or just use PATCH exclusively) |
| Zod everywhere | Replace manual casts in api-keys routes with Zod schemas |
| Activity emission | REST routes should emit activity events same as MCP tools |
| Import shared enums | Tasks route should import status/priority enums from validators.ts |

### 5c. MCP monolith split

Break `[transport]/route.ts` (860 lines) into:

```
src/app/api/[transport]/
  route.ts              # Server init, auth, helpers, exports (~80 lines)
  tools/
    projects.ts         # 6 tools
    columns.ts          # 5 tools
    tasks.ts            # 5 tools (+ batch, detail)
    gantt.ts            # 3 tools
    labels.ts           # 6 tools
    checklist.ts        # 4 tools
    comments.ts         # 4 tools
    dependencies.ts     # 4 tools
    analytics.ts        # 2 tools (summary, velocity)
    bulk.ts             # 1 tool (setup_board)
```

Each file exports a `register(server)` function. Route.ts calls them all.

### 5d. URL convention

```
/api/v1/projects
/api/v1/projects/[id]
/api/v1/projects/[id]/columns
/api/v1/projects/[id]/columns/[colId]
/api/v1/projects/[id]/tasks
/api/v1/projects/[id]/tasks/[taskId]
/api/v1/projects/[id]/tasks/[taskId]/checklist
/api/v1/projects/[id]/tasks/[taskId]/checklist/[itemId]
/api/v1/projects/[id]/tasks/[taskId]/comments
/api/v1/projects/[id]/tasks/[taskId]/comments/[commentId]
/api/v1/projects/[id]/dependencies
/api/v1/projects/[id]/labels
/api/v1/projects/[id]/gantt
/api/v1/projects/[id]/gantt/[taskId]
/api/v1/projects/[id]/gantt/views
/api/v1/projects/[id]/vault
/api/v1/projects/[id]/velocity
/api/v1/projects/[id]/summary
/api/v1/api-keys
/api/v1/api-keys/[id]
```

All nested under project for ownership scoping. Consistent pluralisation.

---

## 6. Architecture Decision

**Recommended: Option B (pragmatic) — MCP and REST both call `lib/data/` directly.**

Rationale:
- MCP and REST live in the same Next.js process — no benefit to MCP fetching its own REST routes (adds latency, error surface, and self-referential auth complexity)
- `lib/data/` already serves as the single source of truth (2,784 lines, 17 modules)
- Both interfaces are thin wrappers: MCP translates tool calls → data functions → JSON text. REST translates HTTP → data functions → JSON response.
- Adding a new feature = add data function + add MCP tool + add REST route. Each layer is ~5-10 lines of glue code.

The MCP→REST wrapper pattern (Option A from original spec) makes sense when MCP runs as a separate service. In a monolithic Next.js app, it's unnecessary indirection.
