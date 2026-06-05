# Handover — Phase 3 Implementation Start (2026-06-04)

**Branch:** `feature/kairos_phase2`
**Last commit on this branch:** `b8455ec` — `feat(kairos): Phase 3 scaffolding — recipes, lieutenants, dark_lab convention`
**This doc:** the operational handover. What just shipped, what's next, how to start.

---

## TL;DR — start here

Open `docs/kairos/16-handover-2026-06-03-jarvis-arc.md` (Phase 3 design) and `docs/kairos/18-phase-3-recon.md` (precise touch-point map). Then begin **workstream 3A — unified retrieval module**. Detailed starting prompt at the bottom of this doc.

Do **not** touch `briefer.ts` until workstream 3C. Don't add new MCP tools until 3B. The order matters because each workstream unblocks the next.

---

## What just shipped (commit `b8455ec`)

In-repo:
- `apps/web/src/lib/kairos/streamClass.ts` — `STREAM_CLASSES` const (8 values incl. `'trace'`, `'advisory'`), `StreamClass` type, `isStreamClass` guard
- `apps/web/src/lib/kairos/recipes/_recipe.ts` — `Recipe`, `RecipeContext`, `RecipeOutput`, `MemoryWriteSpec`, `RetrievalResult`, `RetrievedMemory`, `RetrievalBundle` (`Awaited<ReturnType<typeof inspectDominion>>`)
- `apps/web/src/lib/kairos/recipes/registry.ts` — frozen `RECIPES` map (empty, by design); `getRecipe()` / `listRecipes()` only
- `apps/web/src/lib/kairos/__tests__/streamClass.test.ts` — 24 tests
- `apps/web/src/lib/kairos/recipes/__tests__/registry.test.ts` — 5 tests
- `apps/web/src/lib/db/schema.ts` — `streamClass` column comment now points at `streamClass.ts` as canonical
- `docs/kairos/16` — Scribe → Acolyte rename throughout
- `docs/kairos/17` — Ring 2 strategy, `dark_lab_*` AI-entity repo convention, boundary-based approval (locked 2026-06-03)
- `docs/kairos/18` — Phase 3 recon report (every file path verified, MCP/REST patterns documented)

Out of repo but on this machine:
- `.claude/agents/{acolyte,sentinel,cartographer,oracle}.md` — lieutenant prompts (gitignored — local-only)
- `~/.claude/skills/kairos-brief/SKILL.md` — on-demand briefing skill
- `~/.claude/projects/.../memory/project_kairos_three_rings.md` — three-rings strategic memory

29 tests pass, typecheck clean. Horsemen review applied (verdicts went FAIL → fixes → green).

---

## Phase 3 — the three workstreams (must ship in this order)

### 3A — Unified retrieval module (~half day)

**Goal:** one canonical `retrieveContext()` function powering both BYOK and Claude Code surfaces.

**New file:** `apps/web/src/lib/kairos/retrieve.ts`

Signature:
```typescript
export interface RetrievalArgs {
  userId: string
  dominionId: string
  query?: string            // FTS, null/empty → skip substrate
  memoryLimit?: number      // for bundle, default 25
  includeBoardState?: boolean
}

export async function retrieveContext(args: RetrievalArgs): Promise<RetrievalResult>
```

`RetrievalResult` shape is already exported from `recipes/_recipe.ts` — do NOT redefine.

**Source code to port:**
- `inspect_dominion` call from `briefer.ts:152` → `retrieveContext` bundle field
- All three buckets from `chat-retrieval.ts:61-73` → cortex / archetypes / substrate fields
- **Traces** is new — read recent `streamClass='trace'` memories for the Dominion (limit 10, ordered by `createdAt desc`)

**Refactor:** `chat-retrieval.ts` becomes a thin shim:
```typescript
export { retrieveContext as retrieveForChat } from './retrieve'
```
…or keep the function as a wrapper if its signature differs. Three callers (per doc 18 §1) — verify each compiles.

**Tests:** `apps/web/src/lib/kairos/__tests__/retrieve.test.ts`
- Briefer-mode (no query): asserts bundle populated, substrate empty
- Chat-mode (with query): asserts substrate populated, traces present if any exist

**Do NOT touch in 3A:** `briefer.ts` (that's 3C), MCP tools (that's 3B), the cron route (that's 3C).

**Acceptance:**
- `npm run typecheck --workspace=apps/web` clean
- `npm run test --workspace=apps/web` clean (existing tests still pass + new retrieve tests pass)
- Commit message: `feat(kairos): Phase 3A — unified retrieve module`

---

### 3B — MCP search-surface extension (~half day)

**Goal:** unblock Sentinel/Cartographer/Oracle from their "Phase 3 blocking" notes.

**Changes:**

1. **Extend `search_memories`** MCP tool + Zod schema at `apps/web/src/app/api/[transport]/tools/memories.ts` and `apps/web/src/lib/data/validators.ts:searchMemoriesSchema`:
   - Add `dominionId?: string (uuid)`
   - Add `sinceDays?: number (1..365)`
   - Make `query` optional when `dominionId` is provided (the dominion scope + time filter is sufficient to bound result set)

2. **Mirror to REST** at `apps/web/src/app/api/v1/memories/search/route.ts` — pull new params from `searchParams`, map them through.

3. **New MCP tool** `mcp__aeon__get_trace_history` at `apps/web/src/app/api/[transport]/tools/recipes.ts` (new file — use the pattern from `dominions.ts`):
   - Input: `{ dominionId?: string, recipe?: string, limit?: number (1..100, default 25) }`
   - Returns: memories where `streamClass='trace'`, ordered `createdAt desc`
   - REST mirror at `apps/web/src/app/api/v1/recipes/traces/route.ts`

4. **Register `registerRecipeTools(server)`** in `apps/web/src/app/api/[transport]/route.ts` (single line addition).

5. **Update the Gantt parity test** if `get_trace_history` belongs in the parity invariant set (check `apps/web/src/app/api/__tests__/gantt-parity.test.ts` first — likely no, but verify).

**Tests:**
- MCP tool input validation tests
- REST mirror tests (auth + Zod parse)
- Trace history correctness — given N traces with various recipe names, filter works

**Acceptance:**
- Existing tests pass (no regression)
- New search filter usable: `search_memories({ dominionId, sinceDays: 7, query: undefined })` returns recent Dominion memories
- `get_trace_history({ dominionId, recipe: 'BRIEF' })` returns trace rows
- Commit message: `feat(kairos): Phase 3B — search dominionId/since filters + get_trace_history`

**After 3B lands:** update the three lieutenant docs to remove their "Phase 3 blocking" notes (or convert them to "still needs the dispatcher — see 3C"). Lieutenants live at `.claude/agents/{sentinel,cartographer,oracle}.md`.

---

### 3C — BRIEF recipe + dispatcher + cron rewire (~full day)

**Goal:** first end-to-end recipe run. The on-demand `/kairos-brief` skill stops returning "Phase 3 not deployed" and the 07:00 cron writes its first dispatcher-routed briefing.

**New files:**

1. `apps/web/src/lib/kairos/recipes/brief.ts` — `BRIEF: Recipe`
   - `flat()` ports the current `briefer.ts` prompt + BYOK call exactly. Source the prompt builder from `briefer.ts:buildPrompt` — don't re-author it.
   - `expanded()` stays undefined for now (Cartographer takes that path in Phase 4)
   - `reads: ['cortex', 'archetype', 'execution', 'reflection']`, `writes: ['advisory']`

2. `apps/web/src/lib/kairos/recipes/index.ts` — barrel exporting BRIEF; **update `registry.ts`** to import and freeze it into the `RECIPES` map:
   ```typescript
   import { BRIEF } from './brief'
   const RECIPES = Object.freeze({ BRIEF }) as Readonly<Record<string, Recipe>>
   ```

3. `apps/web/src/lib/kairos/dispatch.ts` — `runRecipe(name, { userId, dominionId, args, surface })`:
   - Look up recipe; throw if unknown
   - Call `retrieveContext` to build `RecipeContext`
   - Dispatch: `surface === 'claude_code' && recipe.expanded ? recipe.expanded(ctx) : recipe.flat(ctx)`
   - On output: write `primary` via existing `captureMemory()`; write each `extras` if present; write one `streamClass='trace'` memory with `{ recipe: name, mode, traceMeta, durationMs, primaryMemoryId }`
   - Honour idempotency: if `captureMemory` short-circuits on the BRIEF idempotency key (`briefer:{date}:{dominionId}`), return `{ status: 'existing', memoryId, traceId: null }`

4. MCP tools (at `apps/web/src/app/api/[transport]/tools/recipes.ts` — same file as 3B's `get_trace_history`):
   - `list_recipes()` → `listRecipes()`
   - `run_recipe({ name, dominionId, args? })` → `runRecipe(name, { ..., surface: 'claude_code' })`

5. REST mirrors:
   - `GET /api/v1/recipes` → `listRecipes()`
   - `POST /api/v1/recipes/run` → `runRecipe(...)`

**Edits:**

- `apps/web/src/app/api/cron/briefer/route.ts` — replace `runBrieferForUser(userId)` with a per-Dominion loop calling `runRecipe('BRIEF', { userId, dominionId, surface: 'byok' })`. Aggregate results the same way.
- `apps/web/src/lib/kairos/briefer.ts` — once the cron + on-demand action both go through `runRecipe`, this file can be deleted OR kept as legacy. Recommendation: keep its `buildPrompt` export (the BRIEF recipe imports it) and delete `runBrieferForUser` if it has no remaining callers.

**Tests:**
- `apps/web/src/lib/kairos/__tests__/retrieve.test.ts` (from 3A) — keep
- `apps/web/src/lib/kairos/__tests__/dispatch.test.ts` — new: mock retrieve + recipe, assert dispatcher writes primary + trace
- `apps/web/src/lib/kairos/recipes/__tests__/brief.test.ts` — new: BRIEF.flat() given a known retrieval produces an advisory write spec
- Update `registry.test.ts` — `listRecipes()` now returns `[{ name: 'BRIEF', ... }]`

**Acceptance per doc 16 §3.6:**
- Running the briefer cron in dev produces the same advisory as before (regression check via dev DB)
- `/kairos-brief` from a Claude Code session writes an advisory visible in the Daily Briefing modal
- Every recipe run writes a `streamClass='trace'` row

**Commit message:** `feat(kairos): Phase 3C — BRIEF recipe + dispatcher + cron rewire`

---

## After Phase 3 — what's next

**Phase 4 — Lieutenants operational.** With 3B + 3C done, Cartographer's nightly + Acolyte's session-end hook can ship as Claude Routines (skill: `schedule`). Oracle's pulse can run as a 2-hourly Routine but the operator should gate it manually for the first week.

**Phase 5 — Decision graph + 3D layer.** See doc 16 §Phase 5. Adds `'decision'` + `'decision_edge'` to `streamClass`.

Strategic Ring 2 work (Phases 8–12) is documented in `docs/kairos/17`. Don't pull it forward — it depends on Ring 1 being solid.

---

## Things to know before you start

1. **Stop hook runs typecheck + tests on every turn with code changes.** If something breaks, the commit will be rejected — that's the safety net, not an annoyance. Fix the root cause.

2. **MCP/REST parity is enforced by CI.** `apps/web/src/app/api/__tests__/gantt-parity.test.ts` is the lock for Gantt specifically; for new recipe tools, mirror MCP ↔ REST as you add them, or CI will fail.

3. **The dispatcher must not import from `briefer.ts` directly.** BRIEF imports `buildPrompt` if needed, but the dispatcher only sees the recipe interface — that's the layering invariant.

4. **Lieutenants stay local.** Don't try to commit `.claude/agents/*.md` — `.claude/` is gitignored deliberately. The lieutenants are operator-machine config.

5. **`/kairos-brief` skill** currently degrades gracefully when BRIEF isn't registered ("Phase 3 dispatcher not yet deployed"). Once 3C lands, it just works — no skill change needed.

6. **No new memory or doc changes expected during implementation.** The strategic decisions are locked in docs 16 + 17. If you find yourself wanting to re-debate the recipe interface shape or the boundary approval model, stop and ask the operator first.

---

## Starting prompt for the next session

Paste verbatim:

> Read `docs/kairos/19-handover-2026-06-04-phase-3-implementation.md` then start **workstream 3A — unified retrieval module**. Create `apps/web/src/lib/kairos/retrieve.ts` with `retrieveContext({ userId, dominionId, query?, memoryLimit?, includeBoardState? })` returning the `RetrievalResult` shape already exported by `lib/kairos/recipes/_recipe.ts` (bundle, cortex, archetypes, substrate, traces). Port retrieval logic from `chat-retrieval.ts` (cortex/archetypes/substrate) and `briefer.ts:152` (`inspectDominion` → bundle); add the new `traces` bucket (read recent `streamClass='trace'` memories scoped to the Dominion, limit 10, ordered `createdAt desc`). Refactor `chat-retrieval.ts` to re-export `retrieveContext` as `retrieveForChat` so the three existing callers still compile. Write tests at `apps/web/src/lib/kairos/__tests__/retrieve.test.ts` covering briefer-mode (no query) and chat-mode (with query). Do NOT touch `briefer.ts`, the cron route, or MCP tools — those are 3B and 3C. Stay on `feature/kairos_phase2`, structured commit when typecheck + tests are clean.
