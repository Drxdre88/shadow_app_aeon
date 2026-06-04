# Handover — Phase 3C + End-to-End Verify (2026-06-04)

**Branch:** `feature/kairos_phase2`
**Last commit:** `e90b381` — `feat(kairos): Phase 3B — search dominionId/sinceDays filters + get_trace_history`
**Supersedes:** doc 19 §3A, §3B (now shipped). Doc 19 §3C is still the source of truth for the implementation shape but is refined below.

---

## TL;DR — start here

Phase 3A (unified retrieval module) and Phase 3B (search-surface extension + `get_trace_history`) are merged on `feature/kairos_phase2`. Three of the four lieutenants (Sentinel, Cartographer, Oracle) are now operationally unblocked.

**Next:** workstream 3C — wire the BRIEF recipe through a dispatcher, register it, and rewire the 07:00 cron. After it lands, run the end-to-end verify plan in §3 below. Starting prompt at the bottom of this doc.

---

## 1. What shipped today

### Commit `ef94661` — Phase 3A (unified retrieve module)

- **New:** `apps/web/src/lib/kairos/retrieve.ts` — `retrieveContext({ userId, dominionId, query?, memoryLimit?, includeBoardState? })` returns the canonical `RetrievalResult` shape (`bundle`, `cortex`, `archetypes`, `substrate`, `traces`).
- **Refactor:** `apps/web/src/lib/kairos/chat-retrieval.ts` is now a thin shim — `retrieveForChat()` wraps `retrieveContext` and returns the `{ cortex, archetypes, substrate }` subset. Existing callers (`kairos-chat.ts`, `chat-retrieval-mapping.ts`) compile unchanged.
- **Defensive:** `narrowStreamClass` guards against any future stray DB value.
- **Tests:** `apps/web/src/lib/kairos/__tests__/retrieve.test.ts` — 5 tests covering briefer-mode (no query → substrate empty), chat-mode (query → substrate populated), null-bundle propagation, short-query skip, unknown-streamClass narrowing.

### Commit `e90b381` — Phase 3B (search filters + trace history)

- **Validator:** `searchMemoriesSchema` now accepts optional `query`, plus `dominionId` and `sinceDays (1..365)`. Refinement requires at least one of `query` or `dominionId`.
- **Data layer:** `searchMemoriesFts` handles the no-query path (drops FTS condition, stable result row shape — `rank=0`, `snippet=''`, sort by pinned + recency).
- **New data fn:** `apps/web/src/lib/data/recipes.ts:listTraceHistory({ userId, dominionId?, recipe?, limit? })` reads `streamClass='trace'` memories, recipe-name filter via `sourceMetadata->>'recipe'`.
- **New MCP tool:** `get_trace_history` at `apps/web/src/app/api/[transport]/tools/recipes.ts`. The file also exports `traceHistoryQuery` (zod) — REST imports it for parity.
- **REST mirror:** `GET /api/v1/recipes/traces`.
- **MCP `search_memories`:** `query` optional, `dominionId` + `sinceDays` added.
- **REST `GET /api/v1/memories/search`:** `q` optional; `dominionId`, `sinceDays` query params forwarded.
- **Registered:** `registerRecipeTools(server)` in `apps/web/src/app/api/[transport]/route.ts` and the tools barrel.
- **Tests:**
  - `apps/web/src/lib/data/__tests__/validators-search.test.ts` (8) — refinement, range bounds, defaults.
  - `apps/web/src/lib/data/__tests__/recipes.test.ts` (4) — `listTraceHistory` smoke + limit clamping.
- **Lieutenant docs (local-only, gitignored):** `.claude/agents/{sentinel,cartographer,oracle}.md` — "Phase 3 blocking" sections flipped to "Phase 3B unblocked" with new tool usage shown. Acolyte was already unblocked.

### Test posture

29 → **31 files**, 1693 → **1734 tests**, all green. Memories-parity test still passes (7-tool count unchanged; new MCP tool lives in `recipes.ts` outside that lock set).

---

## 2. Workstream 3C — BRIEF recipe + dispatcher + cron rewire

This is the only remaining Phase 3 piece. Same shape as doc 19 §3C with two clarifications based on what's now in place.

### 2.1 New files

**`apps/web/src/lib/kairos/recipes/brief.ts`** — `BRIEF: Recipe`

- `name: 'BRIEF'`, `description`, `reads: ['cortex', 'archetype', 'execution', 'reflection']`, `writes: ['advisory']`.
- `flat(ctx)` ports the existing `briefer.ts` BYOK call exactly. Source `buildPrompt` from `briefer.ts` (it stays exported for this reason) — do not re-author the prompt.
- **Critical:** `ctx.retrieval.bundle` is now where the inspect_dominion data lives (Phase 3A). Map `ctx.retrieval.bundle` → the existing `BriefingContext` shape that `buildPrompt` expects. Don't call `inspectDominion` from inside the recipe.
- The provider call signature in `briefer.ts:182-189` stays identical — same `getProviderForTask`, same maxTokens/temperature.
- `expanded()` stays `undefined` for now (Cartographer takes that path in Phase 4).

Return shape:
```typescript
return {
  primary: {
    type: 'advisory',
    streamClass: 'advisory',
    source: 'cron',
    title: `${date} · ${bundle.name} briefing`,
    bodyMd: text,
    dominionId: ctx.dominionId,
    sourceMetadata: {
      externalId: `briefer:${date}:${ctx.dominionId}`,
      briefingDate: date,
      dominionId: ctx.dominionId,
    },
  },
  traceMeta: { date, model: response.modelId },
}
```

**`apps/web/src/lib/kairos/recipes/index.ts`** — barrel exporting `BRIEF`.

Update **`apps/web/src/lib/kairos/recipes/registry.ts`** to wire BRIEF in:
```typescript
import { BRIEF } from './brief'
const RECIPES = Object.freeze({ BRIEF }) as Readonly<Record<string, Recipe>>
```

**`apps/web/src/lib/kairos/dispatch.ts`** — `runRecipe(name, { userId, dominionId, args?, surface })`:

1. `getRecipe(name)` — throw `RecipeNotFoundError` if unknown (don't return null silently).
2. `retrieveContext({ userId, dominionId, memoryLimit: 25 })` — build the `RecipeContext`.
3. Dispatch: `surface === 'claude_code' && recipe.expanded ? recipe.expanded(ctx) : recipe.flat(ctx)`.
4. Time the recipe call (`durationMs`).
5. Write `primary` via `captureMemory(userId, primary)`. If `captureMemory` returns `created: false` (idempotency short-circuit on `externalId`), return `{ status: 'existing', memoryId, traceId: null }` and do NOT write a trace — the existing primary already has one.
6. Write each `extras` via `captureMemory` (when present).
7. Write the trace: `captureMemory(userId, { type: 'session_event', streamClass: 'trace', source: 'system', title: ..., bodyMd: JSON.stringify(traceBody), dominionId, sourceMetadata: { recipe: name, mode, durationMs, primaryMemoryId, ...traceMeta } })`.
8. Return `{ status: 'created', memoryId, traceId }`.

Note on streamClass routing: `captureMemory` derives `streamClass` from `type` today. Verify how it resolves for `advisory` (should be `'advisory'` already) and for the trace write. If `captureMemory` doesn't accept an explicit `streamClass` override, either extend it to pass through or insert the trace directly via `db.insert(memories)`. **Read `captureMemory` and `createMemory` first** — confirm the path before adding parameters.

### 2.2 MCP tools

Add to `apps/web/src/app/api/[transport]/tools/recipes.ts` (same file as `get_trace_history`):

- `list_recipes()` → `listRecipes()` from `registry.ts`. Returns descriptors only (name + description + reads/writes).
- `run_recipe({ name, dominionId, args? })` → `runRecipe(name, { userId, dominionId, args, surface: 'claude_code' })`.

### 2.3 REST mirrors

- `GET /api/v1/recipes` → `listRecipes()`.
- `POST /api/v1/recipes/run` (body: `{ name, dominionId, args? }`) → `runRecipe(...)`.

### 2.4 Cron rewire

`apps/web/src/app/api/cron/briefer/route.ts:53` currently calls `runBrieferForUser(userId)`. Replace with a per-Dominion loop:

```typescript
const doms = await findDominionsByUser(userId)
const active = doms.filter((d) => !d.archivedAt)
for (const dom of active) {
  const r = await runRecipe('BRIEF', { userId, dominionId: dom.id, surface: 'byok' })
  // collect into the same userResults shape the route currently emits
}
```

Keep the response shape (`{ ran, advisoriesCreated, users }`) **identical** so the dashboard's polling UI doesn't need to change.

### 2.5 What to do with `briefer.ts`

- Keep `buildPrompt` exported — BRIEF imports it.
- Keep `BriefingContext` exported as the input type for `buildPrompt`.
- Delete `runBrieferForUser` once the cron and `lib/actions/memories.ts:run-briefing-action` both go through `runRecipe`. The `force` flag in the action currently archives today's advisory before calling — replicate that in the action by archiving then calling `runRecipe('BRIEF', { userId, dominionId, surface: 'byok' })` per Dominion. Do not push the `force` semantics into `runRecipe` — it's a UI-driven affordance.

### 2.6 Tests

- `apps/web/src/lib/kairos/__tests__/dispatch.test.ts` — mock `retrieveContext` + a fake recipe; assert dispatcher writes primary, writes trace pointing at `primaryMemoryId`, skips trace on idempotent short-circuit, returns the right status string.
- `apps/web/src/lib/kairos/recipes/__tests__/brief.test.ts` — given a known retrieval, `BRIEF.flat()` returns an advisory `MemoryWriteSpec` with the expected `externalId` and `title` format. Mock the provider.
- Update `apps/web/src/lib/kairos/recipes/__tests__/registry.test.ts` — `listRecipes()` now returns `[{ name: 'BRIEF', ... }]`.
- Cron route smoke (optional but recommended): mock `runRecipe`, assert per-active-Dominion call count and aggregated response.

---

## 3. End-to-end verify plan (after 3C lands)

This is the "do all the testing" step. Run in order — each gate must pass before the next.

### Gate A — local correctness

1. `npm run typecheck --workspace=apps/web` — clean.
2. `npm run test --workspace=apps/web` — all green, no skipped suites.

### Gate B — semantic regression check

Goal: the new dispatcher-driven briefing produces output indistinguishable from the legacy path.

1. Pick one Dominion in your dev DB with an existing recent advisory (find one via `select id, title, body_md from memories where type='advisory' order by created_at desc limit 5`).
2. Soft-archive it: `update memories set archived_at = now() where id = '<that id>'`.
3. Run the dispatcher path: from a Claude Code session, `mcp__aeon__run_recipe({ name: 'BRIEF', dominionId: '<id>' })`. Or call the REST mirror.
4. Compare the new advisory against the archived one:
   - Same 4-section structure (State / Movement / Watch / Suggested next)?
   - Same idempotency key (`externalId = briefer:{date}:{dominionId}`)?
   - Word count within ±25% of the original?
   - Bold/critical markup roughly comparable?
5. Run `mcp__aeon__get_trace_history({ recipe: 'BRIEF', limit: 5 })` — confirm the trace row exists, `sourceMetadata.recipe === 'BRIEF'`, `primaryMemoryId` points at the new advisory.

### Gate C — idempotency

1. Re-run the same recipe call from Gate B step 3.
2. Expect `{ status: 'existing', memoryId: <same as before>, traceId: null }`.
3. `get_trace_history` count must NOT increase (no orphan trace from the short-circuit).

### Gate D — cron-path equivalence

1. Hit the cron route locally: `curl -X GET http://localhost:3000/api/cron/briefer` (dev mode allows unauth).
2. Response shape unchanged: `{ ran, advisoriesCreated, users: [{ userId, results: [...] }] }`.
3. Per-user `results` array has one entry per active Dominion (was the case before too — the old `runBrieferForUser` already looped per Dominion).

### Gate E — UI smoke

1. `npm run dev --workspace=apps/web`.
2. Sign in; open the Daily Briefing modal.
3. Confirm today's advisory renders (the new one from Gate B / Gate D).
4. Click "Regenerate today" → archives + re-runs through `runRecipe`. Should produce a fresh advisory.
5. Inspect chat: open a Kairos chat thread, send "how is this project going?". The chat surface should still work (it calls `retrieveForChat` which now wraps `retrieveContext`).

### Gate F — `/kairos-brief` skill

The skill at `~/.claude/skills/kairos-brief/SKILL.md` currently degrades gracefully when BRIEF isn't registered. After 3C, invoking it should succeed end-to-end:

1. `/kairos-brief` in a Claude Code session.
2. Expect the rendered advisory back, plus the memory ID in the trace history.

### Gate G — horsemen review (recommended before any merge to `main`)

The 3C diff touches the cron — heavier than 3A or 3B. Per `feedback_review_tiers.md`, run the full horsemen pass before considering a PR. `/horsemen` from the repo root.

---

## 4. Things to know

Carried forward from doc 19, refined for the current state:

1. **Stop hook runs typecheck + tests on every code-change turn.** Don't fight it; let it find regressions.

2. **MCP/REST parity:** `apps/web/src/app/api/__tests__/memories-parity.test.ts` locks the memory tool count at 7 — do NOT add new tools to `tools/memories.ts`. New MCP tools (`list_recipes`, `run_recipe`) go in `tools/recipes.ts`, which is intentionally outside both parity locks.

3. **Layering invariant:** the dispatcher imports `retrieveContext`, recipes import `buildPrompt` if they need it, but the dispatcher never reaches into `briefer.ts`. If you find yourself importing `briefer.ts` from `dispatch.ts`, you've drifted.

4. **`captureMemory` idempotency:** dedup is on `(userId, source, sourceMetadata.externalId, archived_at IS NULL)`. The `force` flag in the dashboard action archives the existing advisory first, which is what lets the next capture create a fresh row. Don't bake `force` into `runRecipe`.

5. **`streamClass` on trace writes:** verify how `captureMemory → createMemory` derives `streamClass` from `type`. Trace writes use `type: 'session_event'` historically (via the session-trace path) but the trace needs `streamClass: 'trace'` per the new convention. If `createMemory` doesn't expose a streamClass override, extend it carefully — there's a schema-level default (`'idea'`) that will silently misclassify your traces otherwise.

6. **Lieutenant docs are gitignored** — `.claude/agents/{acolyte,sentinel,cartographer,oracle}.md` live locally only. Doc 19 + this doc are the canonical written contracts; the agent prompts are operator-machine config.

7. **`/kairos-brief` skill** at `~/.claude/skills/kairos-brief/SKILL.md` is wired but currently degrades gracefully. Phase 3C makes it functional — no skill changes needed.

8. **Boundary-based approval (doc 17) is locked** — don't re-debate the lieutenant tool grants. Sentinel still doesn't have `create_task`; Cartographer still doesn't have `run_recipe`. Those unlock in later phases via earned-trust gates, not via Phase 3.

---

## 5. Starting prompt for the next session

Paste verbatim:

> Read `docs/kairos/20-handover-2026-06-04-phase-3c-and-verify.md` then start **workstream 3C — BRIEF recipe + dispatcher + cron rewire**. Implement in this order:
>
> 1. Create `apps/web/src/lib/kairos/recipes/brief.ts` (`BRIEF: Recipe`) — port the existing BYOK call from `briefer.ts`, map `ctx.retrieval.bundle` → `BriefingContext`, reuse `buildPrompt`. Return shape per doc 20 §2.1.
> 2. Create `apps/web/src/lib/kairos/recipes/index.ts` (barrel) and update `registry.ts` to freeze `BRIEF` in.
> 3. Create `apps/web/src/lib/kairos/dispatch.ts:runRecipe()` — read doc 20 §2.1 step list verbatim. Verify `captureMemory`'s `streamClass` handling before writing the trace; extend `createMemory` if needed.
> 4. Add `list_recipes` and `run_recipe` to `apps/web/src/app/api/[transport]/tools/recipes.ts` (the file from 3B).
> 5. REST mirrors at `apps/web/src/app/api/v1/recipes/route.ts` (GET = list) and `apps/web/src/app/api/v1/recipes/run/route.ts` (POST = run).
> 6. Rewire `apps/web/src/app/api/cron/briefer/route.ts` to call `runRecipe('BRIEF', { userId, dominionId, surface: 'byok' })` per active Dominion. Keep the response JSON shape unchanged.
> 7. Rewire `apps/web/src/lib/actions/memories.ts:runBrieferAction` (or equivalent — find via `grep runBrieferForUser`) so the dashboard "Regenerate today" button archives then runs through the dispatcher.
> 8. Delete `runBrieferForUser` from `briefer.ts` once it has no callers. Keep `buildPrompt` and `BriefingContext` exported.
> 9. Tests per doc 20 §2.6 — `dispatch.test.ts`, `brief.test.ts`, updated `registry.test.ts`.
>
> Then execute the end-to-end verify plan in doc 20 §3 (Gates A through F at minimum; Gate G/horsemen optional but recommended before PR). Stay on `feature/kairos_phase2`; structured commit per phase boundary (one for the recipe+dispatcher+MCP/REST, one for the cron+action rewire, one for the briefer.ts cleanup). Do NOT open a PR yet — the operator will decide on that after Gate G.
