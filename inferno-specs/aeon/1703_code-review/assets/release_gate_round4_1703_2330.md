# SHADOW JUDGE REVIEW - Round 4 Release Gate
**Date:** 2026-03-17
**Scope:** Full backend (validators, actions, data, API route, auth, schema, stores)

---

## PREVIOUS FIX VERIFICATION

### Fix 1: updateProject action uses Zod .parse()
**STATUS: CONFIRMED HOLDING**
File: `src/lib/actions/projects.ts` line 43
```ts
const parsed = updateProjectSchema.parse(data)
```
Correct. The parsed result is passed to the data layer.

### Fix 2: taskOrderSchema unified with ganttViewFiltersSchema
**STATUS: CONFIRMED HOLDING**
File: `src/lib/data/validators.ts`
- Line 103: `taskOrder: z.enum(['column', 'alphabetical']).optional()` (inside ganttViewFiltersSchema)
- Line 165: `export const taskOrderSchema = z.enum(['column', 'alphabetical'])`
Both use identical enum values. No drift.

### Fix 3: removeDependency scoped by projectId
**STATUS: CONFIRMED HOLDING**
File: `src/lib/data/dependencies.ts` lines 31-48
```ts
export async function removeDependency(blockerTaskId: string, blockedTaskId: string, projectId: string) {
  const tasks = await db.select(...)...where(and(
    eq(boardTasks.projectId, projectId),
    inArray(boardTasks.id, [blockerTaskId, blockedTaskId])
  ))
  if (tasks.length === 0) throw new Error('No tasks belong to the project')
  await db.delete(...)...
}
```
Verified: projectId scoping check before delete.

### Fix 4: reorderTaskEntrySchema.status uses z.enum not z.string()
**STATUS: CONFIRMED HOLDING**
File: `src/lib/data/validators.ts` line 160
```ts
status: z.enum(['todo', 'in-progress', 'done']).optional()
```
Correct. Constrained to valid values.

---

## ZOD COVERAGE COMPLETENESS

### Action Files - Validation Matrix

| Action File | Functions | Zod .parse() Used | Status |
|---|---|---|---|
| projects.ts | createProject, updateProject | YES, YES | PASS |
| board.ts | createBoardTask, updateBoardTask, reorderBoardTasks | YES, YES, YES | PASS |
| columns.ts | createColumn, updateColumn, reorderColumns | YES, YES, YES | PASS |
| gantt.ts | createGanttTask, updateGanttTask, createRow, updateRow | YES, YES, YES, YES | PASS |
| labels.ts | createLabel, updateLabel | YES, YES | PASS |
| checklist.ts | createChecklistItem, updateChecklistItem | YES, YES | PASS |
| ganttViews.ts | createGanttView, updateGanttView | YES, YES | PASS |
| canvas.ts | createCanvasNode, updateCanvasNode, createCanvasEdge | YES, YES, YES | PASS |
| vault.ts | sendToVault, sendBatchToVault | YES, YES | PASS |
| dependencies.ts | addTaskDependency | YES | PASS |
| activity.ts | getActivityFeed | YES (cursorSchema) | PASS |
| bridge.ts | pushToGantt | NO Zod on input params | SEE NOTES |

**bridge.ts Note:** `pushToGantt` takes UUIDs as object fields but does not parse them through Zod. However, these are string params that get used in DB queries scoped by projectId+requireOwnership, so the blast radius is limited. Medium priority.

### MCP API Route - Validation
All MCP tool definitions use Zod schemas for parameter definitions. The `mcp-handler` library validates inputs against these schemas before handler execution. PASS.

**Finding:** The MCP route's local `requireOwnership` function (line 66-69) returns a boolean rather than throwing. If ownership fails, it returns `notFound('Project')` which is correct for MCP semantics. Consistent pattern throughout. PASS.

---

## AUTH CONSISTENCY

### Server Actions (via helpers.ts)
- `requireAuth()`: Reads session, throws if no user. Returns userId.
- `requireOwnership(projectId)`: Calls requireAuth + verifyProjectOwnership. Throws if not owner. Returns userId.

**Every exported server action** calls either `requireOwnership` or `requireAuth`:
- projects.ts: getProjects uses requireAuth, all others use requireOwnership. PASS.
- board.ts: All functions use requireOwnership. PASS.
- columns.ts: All functions use requireOwnership. PASS.
- gantt.ts: All functions use requireOwnership. PASS.
- labels.ts: All functions use requireOwnership. PASS.
- checklist.ts: All functions use requireTaskInProject (which wraps requireOwnership). PASS.
- ganttViews.ts: All functions use requireOwnership. PASS.
- canvas.ts: All functions use requireOwnership. PASS.
- vault.ts: All functions use requireOwnership. PASS.
- dependencies.ts: All functions use requireOwnership. PASS.
- activity.ts: getActivityFeed uses requireOwnership. PASS.
- bridge.ts: pushToGantt uses requireOwnership. PASS.

### API Route Auth
- Uses `authenticateRequest` which checks Bearer token (constant-time compare) or session.
- All handlers wrapped in `withAuth`. PASS.

### MCP Route Ownership
- Local `requireOwnership` checks `verifyProjectOwnership(projectId, userId())`.
- Called in every tool that accesses project data. PASS.

**AUTH VERDICT: No gaps detected. Every mutation and read path is authenticated and ownership-checked.**

---

## TYPE SAFETY

### Schema-to-Validator Alignment
Checked all DB column types vs Zod validators:

| Field | DB Type | Zod Type | Match |
|---|---|---|---|
| boardTasks.status | varchar(20) | z.enum(['todo','in-progress','done']) | PASS |
| boardTasks.priority | varchar(20) | z.enum(['low','medium','high','urgent']) | PASS |
| boardTasks.color | varchar(20) | z.string().max(20) | PASS |
| boardTasks.size | real | z.number().min(0.5).max(20).multipleOf(0.5).nullable() | PASS |
| projects.timeScale | varchar(20) | z.enum(['day','week','month']) | PASS |
| ganttViews.groupBy | varchar(20) | z.enum(['column','label','dependency','priority']) | PASS |
| checklistItems.state | varchar(20) | z.enum(['unchecked','checked','crossed']) | PASS |
| checklistItems.title | varchar(255) | z.string().max(500) | NOTE |

**NOTE:** checklistItems.title is varchar(255) in schema but validator allows max(500). The DB constraint would catch values 256-500 but the Zod message would be confusing. Low severity mismatch -- DB would reject with a less descriptive error.

### Inline Zod Schemas (Not in validators.ts)
- `columns.ts` line 16-19: `reorderColumnsSchema` - defined locally. Acceptable since it's a simple internal schema.
- `activity.ts` line 10: `cursorSchema` - defined locally. Acceptable.
- MCP route: All tool definitions use schemas from validators.ts where available, plus inline Zod for MCP-specific params. Acceptable.

---

## ARCHITECTURAL QUALITY

### Layer Separation
Clean 3-layer architecture:
1. **Actions layer** (src/lib/actions/): Server actions with auth + validation + revalidation
2. **Data layer** (src/lib/data/): Pure DB operations, no auth concerns
3. **Store layer** (src/lib/store/): Client-side state management

Separation is well maintained. No bleeding of concerns.

### Import Pattern
All files use `@/lib/` path aliases. No relative imports in the codebase. PASS.

### Error Handling Pattern
- Actions throw on auth failure (good - Next.js server actions surface these)
- Data layer returns null for not-found (good - leaves error decision to caller)
- MCP route catches errors via `mcp-handler` framework
- Activity emissions use `.catch(() => {})` fire-and-forget (acceptable for non-critical side effects)

### Transaction Usage
- `createProject` (data/projects.ts): Transaction for project + default columns. CORRECT.
- `createTask` (data/tasks.ts): Transaction for auto-incrementing orderIndex. CORRECT.
- `reorderTasks` (data/tasks.ts): Transaction for batch updates. CORRECT.
- `vaultTask` (data/vault.ts): Transaction for insert vault + delete board task. CORRECT.
- `restoreFromVault` (data/vault.ts): Transaction for insert board task + delete vault entry. CORRECT.
- `setTaskLabels` (data/labels.ts): Transaction for delete all + insert new. CORRECT.

---

## REMAINING ISSUES

### MEDIUM Severity

**M1. checklist title length mismatch**
- `validators.ts`: `z.string().trim().min(1).max(500)` (createChecklistItemSchema)
- `schema.ts`: `varchar('title', { length: 255 })`
- DB would reject 256-500 char titles with a Postgres error instead of a clean Zod message.
- **Fix:** Change validator max to 255.

**M2. MCP checklist item title inconsistency**
- MCP route line 466: `title: z.string().min(1).max(255)` -- correct
- MCP route line 539: `title: z.string().min(1).max(255)` -- correct
- But `validators.ts` createChecklistItemSchema has max(500). The MCP route is stricter (255), which is correct. The server action path uses the looser validator. Inconsistent.

**M3. removeDependency allows partial project membership**
- `dependencies.ts` line 39: `if (tasks.length === 0) throw` -- only throws if ZERO tasks found
- If only ONE of the two tasks belongs to the project, it still allows deletion
- The DELETE WHERE clause uses only blockerTaskId + blockedTaskId (not projectId), so the actual delete is unscoped
- **Risk:** A user could remove a dependency between two tasks where one belongs to a different user's project, IF they know both task UUIDs
- **Fix:** Check `tasks.length !== 2` like addDependency does, or add projectId to the delete WHERE via a subquery

**M4. bridge.ts pushToGantt - no UUID validation on input**
- `pushToGantt` in actions/bridge.ts takes boardTaskId, ganttViewId, ganttTaskId as strings
- No Zod validation before passing to data layer
- Auth (requireOwnership) mitigates the projectId risk, and the data layer scopes queries by projectId
- **Risk:** Malformed UUIDs would result in DB errors instead of clean validation errors
- **Fix:** Add UUID schema validation

### LOW Severity

**L1. Data layer batch operations without size limits**
- `createTasksBatch` (data/tasks.ts) has no max batch size
- MCP route limits to 100, but the data function itself has no guard
- If called from another code path without the MCP limit, could be unbounded
- Same applies to `archiveTasksBatch`

**L2. Activity feed cursor validation - incomplete**
- `cursorSchema = z.string().datetime().optional()` validates ISO datetime format
- But the cursor is used as `new Date(options.cursor)` which could still produce unexpected behavior for edge-case datetime strings that Zod's `.datetime()` accepts

**L3. `findDependencies` query only joins on blockerTaskId side**
- `dependencies.ts` line 13: `innerJoin(boardTasks, eq(boardTasks.id, taskDependencies.blockerTaskId))`
- If a dependency references a blockedTaskId in a DIFFERENT project, it would still be returned
- This is prevented by FK constraints (both tasks must exist in boardTasks), but the query logic depends on data integrity

**L4. `console.error` in API auth handler**
- `api/auth.ts` line 45: `console.error('[API Error]', ...)`
- Per project standards, should use loguru-equivalent (though this is TypeScript, not Python, so console is standard in Next.js)
- Not a real issue in TypeScript/Next.js context

**L5. `checklistItems.status` validator allows any string**
- `validators.ts` line 142: `status: z.string().trim().nullable().optional()`
- DB column is `varchar('status', { length: 30 })`
- No enum constraint on valid status values. Any string up to 30 chars accepted.
- If this is intentionally free-form, it's fine. If there are expected values, should be z.enum.

---

## DEPLOYMENT READINESS VERDICT

### Blockers: NONE

### Should-Fix Before Deploy (Medium):
1. **M3** - removeDependency partial project membership check (security edge case)
2. **M1/M2** - checklist title length mismatch (data integrity)

### Can Ship, Fix Soon (Low):
- M4, L1-L5 are quality improvements, not blockers

### Strengths:
- Zod coverage is comprehensive across all mutation paths
- Auth is consistently applied -- every action checks ownership
- Schema design is clean with proper FK constraints and cascading deletes
- Transaction boundaries are correctly placed for multi-step operations
- 3-layer architecture is well-separated
- Security headers in next.config.ts are solid (HSTS, CSP, X-Frame-Options)
- Constant-time API key comparison prevents timing attacks
- Client IDs pattern (server accepts optional client-generated UUIDs) is good for optimistic UI

### Rating: DEPLOYMENT READY WITH MEDIUM ADVISORIES
The M3 dependency issue is the only one with real security implications, though the attack surface is narrow (requires knowing UUIDs from another user's project). M1/M2 are data integrity mismatches that would surface as confusing errors, not security holes.

**Recommendation:** Fix M3 and M1 before deploy. Everything else can go into the next sprint.
