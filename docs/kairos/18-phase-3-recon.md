# Phase 3 Recon — File Touch-Point Map

**Generated:** 2026-06-03 via Track A reconnaissance, prior to Phase 3 implementation.
**Use:** drop-in reference for the implementer. Every path verified.

---

## 1. chat-retrieval.ts

**Path:** `apps/web/src/lib/kairos/chat-retrieval.ts:61-73`

**Public exports:**
- `retrieveForChat(userId, dominionId, userQuery): Promise<ChatRetrieval>` — three-bucket retrieval
- `RetrievedMemory` interface: `{ id, title, body, streamClass, createdAt }`
- `ChatRetrieval` interface: `{ cortex: RetrievedMemory | null; archetypes: RetrievedMemory[]; substrate: RetrievedMemory[] }`
- Citation helpers: `extractCitationIds`, `intersectWithRetrieved` (re-exported from `chat-retrieval-citations`)

**What it reads:**
- **cortex:** `memories` where `streamClass='cortex'`, not archived, dominion-scoped, order by `createdAt desc`, limit 1
- **archetypes:** `memories` where `streamClass='archetype'`, not archived, dominion-scoped, limit 10 safety cap
- **substrate:** FTS on `memories.fts` with `websearch_to_tsquery` over user message; filter to `streamClass IN ['reflection', 'idea', 'agentic']`; 90-day window; dominion-scoped; reflection boost; top-5

**Current callers (3):**
- `apps/web/src/lib/actions/kairos-chat.ts:19-23` — `sendKairosMessage` at line 104+
- `apps/web/src/lib/kairos/chat-retrieval-mapping.ts:5` — for prompt building
- `apps/web/src/lib/actions/__tests__/kairos-chat.test.ts` — mocked

---

## 2. briefer.ts

**Path:** `apps/web/src/lib/kairos/briefer.ts:125-226`

**Retrieval shape:**
- `runBrieferForUser(userId, opts?)` iterates Dominions via `findDominionsByUser`
- For each active Dominion calls **`inspectDominion(dominionId, userId, { memoryLimit: 25 })`** directly (line 152)
- `inspectDominion` returns `{ name, vision, missionLong, objectives[], projects[], recentMemories[], boardTasks[] }`
- Builds `BriefingContext` (lines 158-180), then `buildPrompt(ctx, date)`
- Calls `getProviderForTask(userId, { taskType: 'brief', dominionId })` for heavy-tier BYOK (line 184)
- Writes back `type='advisory', source='cron'` memory via `captureMemory` with idempotency key `briefer:{date}:{dominionId}`

**The asymmetry Phase 3 fixes:** briefer never reads cortex/archetypes/substrate — only Dominion top-of-mind state. Unified `retrieveContext` will offer briefer the option to pull those too.

**Callers (2):**
- **Cron:** `apps/web/src/app/api/cron/briefer/route.ts:53` — daily 07:00 UTC via Vercel
- **On-demand:** `apps/web/src/lib/actions/memories.ts` — "Run briefing now" button

---

## 3. streamClass enum — varchar, not pgEnum

**Path:** `apps/web/src/lib/db/schema.ts:421`

**Definition:**
```typescript
streamClass: varchar('stream_class', { length: 20 }).default('idea').notNull()
```

**Current values (six, all inline string literals):**
`'idea' | 'agentic' | 'execution' | 'reflection' | 'cortex' | 'archetype'`

**No CHECK constraint** — values enforced only by code discipline. Migration 0021 added the column + backfilled but did NOT add a constraint.

**Implications for Phase 3:**
- `'trace'` is already DB-level legal — no schema migration required
- A typed constant `STREAM_CLASSES` in a single file is the right safety addition (replaces scattered string literals over time)
- If we ever want a DB-enforced CHECK constraint, that's a separate future migration

**No typed constant exists today** — every reference is `eq(memories.streamClass, 'cortex')`-style.

---

## 4. Briefer cron route

**Path:** `apps/web/src/app/api/cron/briefer/route.ts`

**Entry:** `GET /api/cron/briefer` (maxDuration 300s)

**Call chain:**
1. `isAuthorized(req)` — Vercel `CRON_SECRET` Bearer or dev passthrough (line 20-24)
2. `select distinct userId from dominions where archived = false` (line 30-33)
3. Filter to users with ≥1 active BYOK credential (line 40-46)
4. `for (const userId of eligibleIds) { await runBrieferForUser(userId) }` (line 51-57)
5. Aggregate, return JSON (line 60-69)

**Phase 3 wiring:** replace `runBrieferForUser(userId)` call with `runRecipe('BRIEF', { userId, dominionId, surface: 'byok' })` inside the existing Dominion loop (which moves up from inside briefer.ts to the cron handler).

---

## 5. summarise-memories — currently MCP-only

**MCP tool:** `list_memories_needing_summary` at `apps/web/src/app/api/[transport]/tools/memories.ts:280-320+`

**Shape:**
- Zod params: `limit (1-50, default 20), offset, realmId, projectId, type, missing ('execSummary'|'aiTitle'|'either'), oldestFirst`
- Backend: `listMemoriesNeedingSummary(userId, options)` from `@/lib/data/memories`
- Returns rows with empty `execSummary` or null `aiTitle`

**REST mirror:** `apps/web/src/app/api/v1/memories/needs-summary/route.ts`

**Trigger today:** manual MCP call only. **No scheduled hook.** This is the slot Acolyte (Phase 4) fills.

---

## 6. MCP tool registration pattern

**Main handler:** `apps/web/src/app/api/[transport]/route.ts:38-55`

**Pattern:**
```typescript
createMcpHandler((server) => {
  registerDominionTools(server)
  registerMemoryTools(server)
  // ...
  registerRecipeTools(server)  // ← Phase 3 adds this
})
```

**Each tool family** exports a `register<Family>Tools: RegisterFn` where `RegisterFn = (server: MCPServer) => void`.

**Tool registration call shape:**
```typescript
server.tool('snake_case_name', 'description', zodSchemaObject, async (args, extra) => {
  const uid = getUserId(extra)
  const parsed = mySchema.safeParse(args)
  // ...
})
```

**Naming:** code uses `'create_dominion'`; MCP exposes as `mcp__aeon__create_dominion` (prefix auto-applied).

---

## 7. REST parity pattern

**Mirror location:** `apps/web/src/app/api/v1/<resource>/<action>/route.ts`

**Examples:**
- `mcp__aeon__create_memory` ↔ `POST /api/v1/memories/capture`
- `mcp__aeon__search_memories` ↔ `GET /api/v1/memories/search`
- `mcp__aeon__list_memories_needing_summary` ↔ `GET /api/v1/memories/needs-summary`

**REST handler shape:**
```typescript
export const GET = apiHandler(async (req) => {
  // withRateLimit(..., API_READ_LIMIT)
  const result = await authenticateRequest(req)
  if (!isApiUser(result)) return result
  // Zod parse query params, call business fn, return jsonData({...})
})
```

**Phase 3 REST mirrors needed:**
- `POST /api/v1/recipes/run` (mirrors `mcp__aeon__run_recipe`)
- `GET /api/v1/recipes` (mirrors `mcp__aeon__list_recipes`)
- `GET /api/v1/recipes/traces` (mirrors `mcp__aeon__get_trace_history`)

---

## Implementer's checklist (Phase 3 net new files)

| File | Purpose |
|---|---|
| `apps/web/src/lib/kairos/retrieve.ts` | Unified retrieval module — superset of current `retrieveForChat` |
| `apps/web/src/lib/kairos/streamClass.ts` | Typed constant `STREAM_CLASSES` + `StreamClass` type (includes `'trace'`) |
| `apps/web/src/lib/kairos/recipes/_recipe.ts` | `Recipe`, `RecipeContext`, `RecipeOutput` interfaces |
| `apps/web/src/lib/kairos/recipes/registry.ts` | `RECIPES`, `getRecipe`, `listRecipes` |
| `apps/web/src/lib/kairos/recipes/brief.ts` | BRIEF recipe — `flat()` ports current briefer prompt |
| `apps/web/src/lib/kairos/dispatch.ts` | `runRecipe(name, args)` — retrieves, dispatches, writes output + trace |
| `apps/web/src/app/api/[transport]/tools/recipes.ts` | MCP tools: `list_recipes`, `run_recipe`, `get_trace_history` |
| `apps/web/src/app/api/v1/recipes/run/route.ts` | REST mirror — POST |
| `apps/web/src/app/api/v1/recipes/route.ts` | REST mirror — GET (list) |
| `apps/web/src/app/api/v1/recipes/traces/route.ts` | REST mirror — GET (trace history) |
| `apps/web/src/lib/kairos/__tests__/retrieve.test.ts` | Tests for unified retrieval |
| `apps/web/src/lib/kairos/__tests__/dispatch.test.ts` | Tests for dispatcher |

## Phase 3 touch edits

| File | Edit |
|---|---|
| `apps/web/src/lib/kairos/chat-retrieval.ts` | Shim through to `retrieveContext` (preserve `retrieveForChat` export for callers) |
| `apps/web/src/lib/kairos/briefer.ts` | Replace direct `inspectDominion` call with `retrieveContext`; eventually deprecate when cron switches to `runRecipe('BRIEF', ...)` |
| `apps/web/src/app/api/cron/briefer/route.ts` | Move Dominion iteration up; call `runRecipe('BRIEF', { surface: 'byok' })` per Dominion |
| `apps/web/src/app/api/[transport]/route.ts` | Add `registerRecipeTools(server)` |
