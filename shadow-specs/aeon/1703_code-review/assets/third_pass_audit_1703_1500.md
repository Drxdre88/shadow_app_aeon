# Third-Pass Code Quality Audit - 2026-03-17

## Audit Scope
Full codebase audit after two prior security/cleanup rounds. Reviewed every server action, data layer function, API route, validator schema, auth module, extracted hooks, stores, and key UI components.

## Files Reviewed
- All 13 action files in `src/lib/actions/`
- All 11 data layer files in `src/lib/data/`
- `src/lib/data/validators.ts` (full Zod schema inventory)
- `src/lib/auth.ts`, `src/lib/api/auth.ts`
- `src/app/api/[transport]/route.ts` (MCP API)
- `src/middleware.ts`
- `src/app/project/[id]/page.tsx` (server page)
- `src/app/project/[id]/ProjectContent.tsx`
- All 6 extracted hooks: `useProjectData`, `useBoardHandlers`, `useLabelHandlers`, `useDependencyHandlers`, `useGanttHandlers`, `useCanvasHandlers`
- Board hooks: `useBoardDnD`, `useBoardKeyboardShortcuts`, `useBoardHover`, `useConnectMode`
- `src/lib/store/boardStore.ts`, `src/lib/store/ganttStore.ts`
- `src/components/board/TaskBoard.tsx`, `SortableColumn.tsx`

---

## FINDINGS

### CRITICAL - None found

The two prior rounds resolved all critical issues (auth bypass, missing validation, SQL injection vectors).

---

### HIGH SEVERITY

#### H1. `updateProject` action skips Zod .parse() validation
- **File:** `src/lib/actions/projects.ts`, line 41
- **Issue:** `updateProject` accepts `data: UpdateProjectInput` (already typed) but never calls `updateProjectSchema.parse(data)`. TypeScript types are stripped at runtime -- the server action receives raw JSON from the client. Without `.parse()`, a malicious client can send extra fields or malformed date strings that bypass the schema constraints (e.g. name exceeding 255 chars, invalid date formats).
- **All other actions call .parse() correctly.** This is the only gap.
- **Fix:** Add `const parsed = updateProjectSchema.parse(data)` before passing to `_updateProject`.
- **Severity: HIGH** -- Direct data integrity risk on a core entity.

#### H2. `taskOrderSchema` enum mismatch with `ganttViewFiltersSchema`
- **File:** `src/lib/data/validators.ts`, lines 103 vs 165
- **Issue:** `ganttViewFiltersSchema.taskOrder` allows `['column', 'priority', 'name', 'createdAt']` but the standalone `taskOrderSchema` only allows `['column', 'alphabetical']`. The `createGanttView` action (ganttViews.ts:40) uses `taskOrderSchema.parse()` on the incoming `taskOrder` value, which means values like `'priority'` or `'name'` that the filters schema allows will FAIL validation when creating a view.
- **Fix:** Reconcile the two enums -- either the filters schema should match the standalone schema, or vice versa. Determine which values `bulkPushAllTasksToGantt` actually supports (it only handles `'column'` and `'alphabetical'`), and make both schemas match that reality.
- **Severity: HIGH** -- Runtime Zod parse failure on valid-looking user input.

#### H3. MCP route `removeDependency` lacks project scoping
- **File:** `src/app/api/[transport]/route.ts`, line 367
- **Issue:** The MCP `remove_dependency` tool calls `removeDependency(blockerTaskId, blockedTaskId)` without passing `projectId`. Looking at `src/lib/data/dependencies.ts:31`, the `removeDependency` function deletes by blocker+blocked ID only, without verifying project ownership on the specific dependency record. While the `requireOwnership` check confirms the user owns the project, a user could provide task IDs from a different project to remove someone else's dependency.
- **Fix:** Either add a project ownership check on both task IDs before removal (like `addDependency` already does), or scope the delete query with a join to verify the tasks belong to the project.
- **Severity: HIGH** -- Cross-project data manipulation vector.

---

### MEDIUM SEVERITY

#### M1. `reorderTaskEntrySchema.status` uses `z.string()` instead of enum
- **File:** `src/lib/data/validators.ts`, line 160
- **Issue:** The `status` field in `reorderTaskEntrySchema` is `z.string().optional()` rather than `z.enum(['todo', 'in-progress', 'done']).optional()`. This allows any arbitrary string to be written to the status column during reorder operations. All other status fields in the codebase correctly use the enum.
- **Fix:** Change to `z.enum(['todo', 'in-progress', 'done']).optional()`.
- **Severity: MEDIUM** -- Data integrity risk; unlikely exploit but inconsistent validation.

#### M2. `as any` cast in SortableColumn
- **File:** `src/components/board/SortableColumn.tsx`, line 29
- **Issue:** `zIndex: isDragging ? 50 : 'auto' as any` uses `as any` to satisfy the CSS type system. This is a CSSProperties typing issue.
- **Fix:** Use `zIndex: isDragging ? 50 : ('auto' as const)` or `zIndex: isDragging ? 50 : undefined` (both are valid CSSProperties values).
- **Severity: MEDIUM** -- Type safety gap, trivial to fix.

#### M3. `as unknown as Record<string, unknown>` cast in auth callback
- **File:** `src/lib/auth.ts`, line 89
- **Issue:** `(user as unknown as Record<string, unknown>).role as string || 'user'` is a double unsafe cast needed because NextAuth's User type doesn't include custom fields.
- **Fix:** Extend the NextAuth `User` type with the `role` field in the `declare module 'next-auth'` block, which is already present in the same file. Add `interface User { role?: string }` to the module augmentation.
- **Severity: MEDIUM** -- Type safety gap, but functionally correct.

#### M4. `Record<string, unknown>` casts in handler hooks bypass Zod at call site
- **File:** `src/app/project/[id]/useBoardHandlers.ts`, line 32; `useGanttHandlers.ts`, line 29; `useCanvasHandlers.ts`, line 19
- **Issue:** Several handlers accept `Record<string, unknown>` then cast to the expected type with `as { ... }`. For example: `updates as { name?: string ... }`. While the server action will Zod-validate anyway, the cast means TypeScript won't catch caller-side bugs where wrong keys are passed.
- **Fix:** Type the handler parameter correctly instead of accepting `Record<string, unknown>`. Define a shared `TaskUpdate` type or use the Zod-inferred type directly.
- **Severity: MEDIUM** -- Developer ergonomics and compile-time safety only. Server-side validation protects at runtime.

#### M5. `filters` cast in ganttViews data layer
- **File:** `src/lib/data/ganttViews.ts`, lines 117-118
- **Issue:** `const filters = (view?.filters ?? {}) as Record<string, unknown>` and `const skipWk = !(filters.allowWeekends as boolean)` -- accessing untyped JSONB data with casts. If the stored JSON doesn't have these keys, the defaults are potentially wrong (e.g., `undefined as boolean` evaluates to `true` when negated).
- **Fix:** Parse the filters through the `ganttViewFiltersSchema` before accessing fields, or use explicit defaults: `const skipWk = !(filters?.allowWeekends === true)`.
- **Severity: MEDIUM** -- Logic error on edge case (view with no filters stored yet).

#### M6. `reflowGanttViewRows` lacks transaction wrapper
- **File:** `src/lib/data/ganttViews.ts`, lines 71-158
- **Issue:** The reflow function reads tasks, computes new dates, then updates each task individually in separate queries. If the process is interrupted mid-way (server error, timeout), some tasks will have reflowed dates and others won't.
- **Fix:** Wrap the update loop in `db.transaction()`.
- **Severity: MEDIUM** -- Data consistency on failure path.

---

### LOW SEVERITY

#### L1. `as BoardTaskData` casts in TaskBoard.tsx
- **File:** `src/components/board/TaskBoard.tsx`, lines 326, 339
- **Issue:** `activeItem.data as BoardTaskData` -- the activeItem data is typed as `BoardTask | BoardColumn` in useBoardDnD, but cast to the local `BoardTaskData` interface. The two types are compatible but not identical (BoardTaskData includes `ganttTaskId` while the cast target omits it).
- **Fix:** Use the `BoardTask` type from the store directly instead of defining a local `BoardTaskData` interface.
- **Severity: LOW** -- Types are structurally compatible, no runtime risk.

#### L2. `onDateChange` cast in ProjectContent.tsx
- **File:** `src/app/project/[id]/ProjectContent.tsx`, line 338
- **Issue:** `onDateChange={(taskId, dates) => board.handleTaskUpdate(taskId, dates as Record<string, unknown>)}` -- another `as` cast routing date changes through the generic update handler.
- **Fix:** Type `dates` explicitly as `{ startDate?: string | null; endDate?: string | null }`.
- **Severity: LOW** -- Functionally correct, server validates.

#### L3. `console.error` used consistently in hooks (no re-throw)
- **File:** All hook files under `src/app/project/[id]/`
- **Issue:** Every server action call uses `.catch((err) => console.error(...))`. Errors are swallowed on the client side -- the user sees no feedback when operations fail. For an optimistic UI pattern this is acceptable for most operations, but destructive operations (delete, vault) should show user-visible error feedback.
- **Fix:** Consider a toast/notification system for error feedback on destructive operations. Not a code bug, but a UX gap.
- **Severity: LOW** -- User experience, not security or correctness.

#### L4. `useProjectData` missing deps in first useEffect
- **File:** `src/app/project/[id]/useProjectData.ts`, line 100
- **Issue:** The effect depends on `[projectId, loadKey]` but uses `setGanttTasks`, `setRows`, `setCanvasNodes`, `setCanvasEdges` from store hooks. While Zustand store functions are stable references and this works correctly, the ESLint exhaustive-deps rule would flag it.
- **Fix:** Add them to the dep array for correctness signals, or add an ESLint disable comment explaining why they're stable.
- **Severity: LOW** -- No runtime impact.

#### L5. MCP `batch_create_tasks` and `setup_board` don't validate individual task data through Zod schemas
- **File:** `src/app/api/[transport]/route.ts`, lines 513-530, 582-676
- **Issue:** While the MCP tool parameter schemas inline Zod validation for the request shape, the `createTasksBatch` data function in `src/lib/data/tasks.ts` accepts raw objects without re-validating through `createTaskSchema`. The MCP tool's inline schema covers the fields, but subtleties like `.trim()` transforms are missed (the inline schemas don't include `.trim()`).
- **Fix:** Either ensure the MCP inline schemas match the canonical schemas exactly (including `.trim()`), or have `createTasksBatch` run each entry through `createTaskSchema.parse()`.
- **Severity: LOW** -- Strings pass through un-trimmed but are otherwise validated.

---

## ARCHITECTURE ASSESSMENT

### Positive Findings
1. **Auth pattern is consistent.** Every server action calls `requireOwnership(projectId)` (or `requireAuth()` for project listing). The helper module is clean and centralized.
2. **Data layer scoping is correct.** Every data function that modifies records includes `projectId` in its WHERE clause (with the `removeDependency` exception noted in H3).
3. **Hook extraction is clean.** Five domain-specific hooks (board, label, dependency, gantt, canvas) plus `useProjectData` for data loading. Each has a single clear responsibility. No circular dependencies between hooks.
4. **Zod schemas are comprehensive.** String length limits, enum constraints, UUID format checks, ISO date validation with refinements, numeric ranges -- all well-considered.
5. **MCP route has proper auth gate.** `withAuth()` always calls `authenticateRequest()` before passing to the MCP handler. Every tool checks `requireOwnership()`.
6. **Transactions where needed.** `reorderTasks`, `reorderColumns`, `createProject`, `vaultTask`, `vaultTasksBatch`, `restoreFromVault` all use transactions. Batch operations are correctly wrapped.
7. **Optimistic UI with rollback.** `useDependencyHandlers` shows the correct pattern: optimistically add to store, then revert on server failure.

### Component File Sizes
- `ProjectContent.tsx`: 362 lines -- PASS
- `TaskBoard.tsx`: 411 lines -- PASS
- `useBoardDnD.ts`: 145 lines -- PASS
- `useGanttHandlers.ts`: 190 lines -- acceptable
- `useProjectData.ts`: 188 lines -- PASS
- `route.ts` (MCP): 691 lines -- borderline, but acceptable given it's a single API surface definition

### No Circular Dependencies Detected
Hook dependency chain: `ProjectContent` -> hooks -> actions -> data layer -> db. No cycles observed.

---

## SUMMARY SCORECARD

| Category | Status |
|---|---|
| Zod validations on all actions | 12/13 PASS (updateProject MISSING) |
| Auth checks consistent | PASS (all endpoints covered) |
| Data scoping (projectId in WHERE) | 12/13 PASS (removeDependency gap) |
| Hook extraction quality | PASS |
| Remaining `any` types | 1 found (SortableColumn) |
| Unsafe `as` casts | 5 found (4 Medium, 1 Low) |
| Error handling | Functional but no user feedback |
| Transaction coverage | Good, one gap (reflowGanttViewRows) |
| Schema consistency | 1 enum mismatch (taskOrder) |

## REQUIRED FIXES BEFORE DEPLOYMENT

1. **H1** - Add `updateProjectSchema.parse(data)` to `updateProject` action
2. **H2** - Reconcile `taskOrderSchema` and `ganttViewFiltersSchema.taskOrder` enums
3. **H3** - Scope `removeDependency` by project, or verify task ownership before deletion

## RECOMMENDED FIXES

4. **M1** - Change `reorderTaskEntrySchema.status` to enum
5. **M2** - Remove `as any` from SortableColumn
6. **M3** - Extend NextAuth User type with `role`
7. **M5** - Parse filters through Zod before accessing in reflowGanttViewRows
8. **M6** - Wrap reflowGanttViewRows update loop in transaction
