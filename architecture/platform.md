# Architecture — Platform & Integration Surface

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

Aeon exposes four programmatic front doors over the same three-layer data core (`lib/data` pure queries → `lib/actions` auth-guarded actions → API surfaces):

1. **REST API** (`/api/v1/*`) — session- or bearer-authenticated; the surface the web app, scripts, and the mobile app call.
2. **Mobile auth** (`/api/v1/auth/mobile/*`) — issues 90-day bearer sessions for the mobile app.
3. **OAuth 2.1 authorization server** (`/api/oauth/*` + `/.well-known/*`) — lets claude.ai's OAuth-only remote MCP connector reach the MCP server.
4. **MCP tool server** (`/api/[transport]/`) — **146 tools across 40 register groups** (optional `?profile=` subsets, Connector 2.0 in 0.46) for AI agents (13 Kairos read tools added in 0.20–0.25; [kairos/mind.md](kairos/mind.md) §6).

---

## 1. REST API (`/api/v1/*`)

### Auth model (`apps/web/src/lib/api/auth.ts:19-56`)

`authenticateRequest(request)` resolves a caller to `{ id, role }` or returns a `NextResponse` error. `Authorization: Bearer <token>` is tried first — four accepted token types:

| Token shape | Source | Resolved role | Code |
|---|---|---|---|
| `AEON_API_KEY` (master key, exact match) | env, constant-time compare | **admin** (id = `AEON_API_USER_ID`) | `auth.ts:26-30` |
| `aeon_k1_…` | static REST/MCP API keys (`apiKeys`) | user | `auth.ts:32-35` → `verifyApiKey` |
| `aeon_s1_…` | mobile session tokens (`mobileSessions`) | user | `auth.ts:37-40` → `verifyMobileSession` |
| `aeon_at_…` | OAuth 2.1 access tokens (`oauthAccessTokens`) | user | `auth.ts:42-45` → `verifyOAuthAccessToken` |

NextAuth session cookie is the fallback when no bearer is present (`auth.ts:50-55`). **Only the master key and an admin web session yield `role:'admin'`** — the `aeon_k1_`/`aeon_s1_`/`aeon_at_` branches hard-code `role:'user'`, so admin-gated AI routes are unreachable by non-master bearer callers. Routes wrap handlers in `withRateLimit`; `apiHandler()` standardises the `{data}`/`{error}` envelope and a clean 500.

### Route groups

| Group | Notable routes |
|---|---|
| `api-keys` | create/revoke `aeon_k1_` keys |
| `me` | current-user identity (used by mobile app) |
| `auth/mobile` | `mobile`, `mobile/verify`, `mobile/google` (see §2) |
| `projects` | `projects`, `projects/resolve` (repo-slug → project), `[id]` + `summary`/`velocity` |
| `projects/[id]/…` | `columns`(+reorder), `rows`(+reorder), `gantt`(+`[taskId]`,batch), `gantt-views`, `labels`, `dependencies`(+batch,remove), `canvas` |
| `projects/[id]/tasks/…` | `tasks`(+batch), `[taskId]` + detail/checklist/comments/labels |
| `realms` | `realms`, `[realmId]` + members/projects, **`[realmId]/virtual-members`**(+`[virtualMemberId]`) |
| `memories` | `memories`(+search,capture,context,needs-summary), `[id]`(+export,neighbours,accept,links). Writes stamp `sourceMetadata.origin` (0.14): `[id]/accept` passes `{kind:'agent',via:'rest'}` for bearer callers, `{kind:'operator',via:'rest-session'}` for a web session |
| `ai` | `ai/credentials`(+`[id]`,test), `ai/preferences` — **admin-gated** |
| `sessions` | `sessions` (spawn: 201 / **400** malformed `metadata.hangar` / **409** naming the live session), `claim`, `[id]` (**404** on a non-uuid id, + heartbeat, events, kill) — Hangar surface, see [hangar.md](hangar.md). `projects/[id]` has the same uuid guard; ~45 other `[id]` routes do not yet |
| `recipes` | `recipes/traces` only — REST mirror of `get_trace_history`. The run route and its MCP twin were retired in 0.18 with the BRIEF recipe |
| `projects/[id]/favorite` | PUT toggle for per-user project favorites (PR #80; mirrors MCP `set_project_favorite`) |
| `projects/[id]/kairos-feed` | `PUT` — set which boards Kairos watches (`settings.kairosFeed`, merge, owner only; 0.18). Mirrors MCP `set_project_kairos_feed`, locked by `project-kairos-feed-parity.test.ts` |
| `kairos/speak` | `POST /api/v1/kairos/speak` — **Kairos-initiated delivery** (Will-inbox `notify` memory + best-effort Telegram fan-out). Auth `Bearer ${CRON_SECRET}` (cron idiom, not user bearer). Server-side interrupt throttle (adaptive since 0.20: default 8h gap + 2/24h, 4h + 3 when he replies, 24h + 1/72h after silence) plus the 0.25 moment seam (block/hold) → 429; `force:true` bypass audit-logged and ceilinged at 10/24h. **Deliberately OUTSIDE MCP/REST parity** — internal delivery channel, no MCP mirror. |
| `kairos/*` (0.11–0.19) | `memory-ops`, `memory-ops/[id]/revert`, `thinking-jobs`, `thinking-jobs/claim`, `thinking-jobs/[id]/submit` (`maxDuration = 300` since 0.15), `beliefs`, `beliefs/compare`, `constitution`, `constitution/amendments` — REST mirrors of the memory-ops / thinking / beliefs / constitution MCP tools. Added in 0.18: `asks` (GET open asks) + `asks/[id]/dismiss`, `voice-notes` (POST); in 0.19: `paid-backup` (GET/PUT) — each locked by a parity test |

> ⚠️ **Route params are a Promise in Next 16 — always `await` them.** A handler that reads `(ctx as {params:{…}}).params` synchronously gets `undefined` for every segment, so an id-scoped guard like `getGroupRole(undefined, userId)` matches nothing and the route answers **403 for every caller**. It fails closed, compiles cleanly, and no test or typecheck catches it. Five routes under `api/v1/realms/` were written that way on 2026-04-02 and had never worked; found and fixed 2026-08-26 (`daeb93d`), all 7 param-reading route files now `await`. Use `type Params = { params: Promise<{ … }> }` + `const { x } = await (ctx as Params).params` — the pattern every other v1 family already uses.

**Virtual members (REST):** `GET`/`POST` on `[realmId]/virtual-members`, `PATCH`/`DELETE` on `[realmId]/virtual-members/[virtualMemberId]`. Role gate via `getGroupRole` — reads need any realm member, writes need non-viewer; both path segments are uuid-validated before reaching Postgres (a malformed id 400s instead of surfacing as a 500). Rate-limited like the rest of v1. Mirrored by 4 MCP tools sharing the same Zod validators and `lib/data` functions; `api/__tests__/virtual-members-parity.test.ts` locks the pair, including a **deliberate asymmetry**: the board server action is *stricter* than REST/MCP — it also demands project-editor rights and project reachability, because it is reached from a board the caller is already inside.

**Auxiliary (non-v1):** `POST /api/telegram/webhook` — Telegram bot webhook (PRs #85/#87). Auth = `X-Telegram-Bot-Api-Secret-Token` match; single-operator gate (`TELEGRAM_OPERATOR_CHAT_ID`); handles inbox accept/dismiss callbacks + free text into the persistent whole-brain "Telegram · Kairos" chat thread; always returns 200 (Telegram redelivers on 5xx). Client: `lib/kairos/telegram.ts` (fetch-only, markdown→Telegram-HTML renderer + plain-text fallback). See [kairos/chat.md](kairos/chat.md).

---

## 2. Mobile auth (`/api/v1/auth/mobile/*`)

The auth path the **mobile app** uses. Login tokens (10-min, single-use) are exchanged for **90-day mobile session tokens** (`aeon_s1_…`), which then authenticate every other `/api/v1` call via the bearer branch above. All routes are `POST`, rate-limited. Backed by `apps/web/src/lib/data/mobile-auth.ts`.

| Route | Body | Behaviour |
|---|---|---|
| `POST /auth/mobile` | `{ email, callbackUrl }` | **Magic-link request** — validates same-origin path, mints a 10-min login token, emails `callbackUrl?token=…` via Resend. Enumeration-safe (`{sent:true}` even for unknown users). 503 if `AUTH_RESEND_KEY` unset. |
| `POST /auth/mobile/verify` | `{ token }` | Consumes the login token (single-use), mints a 90-day session, returns `{ token: aeon_s1_…, user }`. |
| `POST /auth/mobile/google` | `{ idToken }` | **Native Google sign-in** — `verifyGoogleIdToken` hits Google's `tokeninfo` (requires `email_verified` + `aud === AUTH_GOOGLE_ID`), `findOrCreateGoogleUser` links/creates, optional `ALLOWED_EMAILS` allowlist, returns `{ token: aeon_s1_…, user }`. **This is the path the mobile app login uses.** |

Token lifecycle (`mobile-auth.ts`): login TTL 10 min (line 7), session TTL 90 days (line 8), prefix `aeon_s1_` (line 6); raw tokens returned once, only SHA-256 hashes persisted. See [mobile.md](mobile.md).

---

## 3. OAuth 2.1 server for the claude.ai connector

The claude.ai remote MCP connector is OAuth-only (no static-token field), so Aeon runs its own OAuth 2.1 AS.

**⚠️ CRITICAL — discovery is served from `middleware.ts` (`serveOAuthDiscovery`), NOT the route handlers.** Next.js statically prerenders/stale-build-caches `force-dynamic` GET route handlers into empty `500` shells (a Turbopack/PPR delivery bug). Middleware runs per-request, can never be statically optimised, and intercepts `/.well-known/oauth-*` before they reach handlers. **Do not move discovery back into route handlers**, and **do not import `next/headers` into `lib/oauth/origin.ts`** — it bundles into every OAuth route via `OAUTH_CORS_HEADERS` and breaks them all (caused the register POST 500s on 2026-06-06). See `docs/kairos/` + the [[project_mcp_oauth_discovery_delivery]] memory.

| Method | Path | Served by | Purpose |
|---|---|---|---|
| GET | `/.well-known/oauth-authorization-server` | **middleware** | RFC 8414 AS metadata (S256 only, scope=mcp) |
| GET | `/.well-known/oauth-protected-resource` | **middleware** | RFC 9728 (`resource=/api/mcp`, scopes, bearer methods) |
| POST | `/api/oauth/register` | route handler | RFC 7591 DCR — open, validates redirect URIs, returns `client_id` (no secret) |
| GET | `/api/oauth/authorize` | route handler | Validates client + redirect, enforces PKCE S256, requires NextAuth session, mints single-use code |
| POST | `/api/oauth/token` | route handler | `authorization_code` (PKCE) + `refresh_token` (rotation) grants |

Tokens: `aeon_at_` access (30d) + `aeon_rt_` refresh (1y, rotated), SHA-256-hashed at rest. `lastUsedAt` writes throttled to 1/60s. The MCP transport wraps its handler in `withMcpAuth`, emitting a 401 with a `resource_metadata` pointer that starts claude.ai's discovery walk.

---

## 4. MCP tools (`/api/[transport]/`)

Auth: Bearer only (API key, master key, mobile session, or OAuth `aeon_at_`) via `verifyToken` → `authenticateRequest`. **146 tools across 40 register groups** (`tools/index.ts`, `route.ts`; counted from `server.tool(` calls on 2026-10-06 — 133 in the 27 categories below plus 13 Vorath read tools, one per `kairos-*.ts`, listed in [kairos/mind.md](kairos/mind.md) §6).

**Connector 2.0 (app v0.46.0):** stack is `mcp-handler` **2.2.0** on `@modelcontextprotocol/server` **2.3.1** (v2 SDK; the old `@modelcontextprotocol/sdk` was removed). `route.ts` serves only `/api/mcp` (`/api/sse` and other transports 404), server info `aeon 2.0.0`, one cached handler per profile. Speaks MCP **2026-07-28** (`server/discover`, stateless) and still answers legacy `initialize` clients (2025-06-18 / 2025-11-25) through the SDK's stateless fallback. `tool-host.ts` keeps every `server.tool(...)` call working on v2 `registerTool` and passes `authInfo` (+ `tokenKind`, `fp`) through. **Confirmations:** `confirm.ts` wraps the 20 `destructiveHint` tools — 2026-07-28 clients that advertise form elicitation get "<action> on board \"X\"? This can't be undone."; decline/cancel returns "cancelled by the user — nothing was changed"; older clients run unprompted (stateless server can't wait mid-call). **Profiles:** `?profile=all|board|vorath|hangar` (`kairos` = alias of `vorath`; `profiles.ts`): all 146 · board 72 · vorath 64 · hangar 39 (sessions, realms, repos + task and memory tools for runners); groups and their profiles are one typed `TOOL_GROUPS` table in `route.ts`; unknown → 400 (-32602); no profile = all. Auth unchanged. CIMD client registration deferred (client ids are UUID FKs in the OAuth tables; needs a migration). **As of PR #83 every tool carries MCP annotation hints** (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint:false`) — full coverage, enabling client-side defer-loading and safe-tool filtering:

| Category | Count | Notes |
|---|---|---|
| projects | 8 | list, get, create, update, delete, summary, **set_project_favorite** (PR #80), **set_project_kairos_feed** (0.18; watched boards — `update_project` also merges settings) |
| columns | 5 | CRUD + reorder |
| tasks | 6 | CRUD + get_detail + batch_create |
| gantt | 14 | tasks + rows + saved views (CRUD + batch + reorder) |
| labels | 6 | CRUD + add/remove |
| checklist | 5 | CRUD + batch_create |
| comments | 4 | CRUD |
| dependencies | 4 | list, add, remove, batch_add |
| analytics | 1 | get_velocity_stats |
| bulk | 1 | setup_board |
| realms | 14 | CRUD + members + invites + projects |
| memories | 9 | create, update, search, link, prepare_context, get_with_neighbours, list_needs_summary, **accept_proposal**, **get_belief_trail** (bi-temporal chain walk, PR #72). create/update/accept (and `kairos_reflect`) stamp origin `{kind:'agent',via:'mcp'}` (0.14) |
| dominions | 16 | CRUD + vision/objectives + repo mapping + project assignment + **`get_dominion_focus`** (0.27, REST-mirrored) · `update_dominion` accepts `pinned` |
| sessions | 6 | spawn, list, get, list_events, kill, claim |
| **virtual-members** | 4 | list / create / update / delete — accountless realm-scoped assignees; shares `createVirtualMemberSchema`/`updateVirtualMemberSchema` with the REST side, locked by `api/__tests__/virtual-members-parity.test.ts` |
| hangar | 4 | mission repo registry |
| reflections | 1 | `kairos_reflect` |
| recipes | 1 | `get_trace_history` (read-only trace surface; the on-demand recipe-run tool was retired in 0.18) |
| **synthesis** | 2 | `prepare_aether_context`, `commit_aether` — Aether (global self-model) via the Claude-Code cognition path (no BYOK) |
| **ask** | 5 | `run_kairos_ask`, `get_pending_kairos_ask`, `answer_kairos_ask`, **`list_open_kairos_asks`**, **`dismiss_kairos_ask`** (0.18; numbered open questions, REST-mirrored) |
| **dialogue** | 5 | `open_dialogue`, `prepare_dialogue_context`, `append_dialogue_turn`, `get_dialogue`, `commit_dialogue` |
| **memory-ops** | 2 | `list_memory_ops`, `revert_memory_op` — memory-engine undo ledger |
| **thinking** | 3 | `claim_thinking_job`, `submit_thinking_job`, `list_thinking_jobs` — the Claude Max routine's queue surface. 25 kinds as of 0.28 (`card_triage` added; `kinds` max = enum size); a claim naming a retired kind has it dropped. Submitting `idea_generate` plans `idea_judge` the same night |
| **beliefs** | 2 | `list_beliefs` (each belief carries `sourceType` + `recheck`, 0.14), `get_mind_comparison` |
| **constitution** | 2 | `get_constitution`, `propose_constitution_amendment` (acceptance is operator-only) |
| **voice-note** | 1 | `kairos_voice_note` (0.18) — stages verbatim voice-note parts as pending agent proposals; the owner confirms them in the UI only (`confirmVoiceNote`) |
| **paid-backup** | 2 | `get_kairos_paid_backup`, `set_kairos_paid_backup` (0.19) — the owner's paid backup switch |

**Parity locks:** `gantt-parity.test.ts` (Gantt MCP↔REST), `memories-parity.test.ts` (memory tools vs REST), `virtual-members-parity.test.ts`, `sessions-parity.test.ts`, `memory-ops-parity.test.ts`, `thinking-parity.test.ts`, `beliefs-parity.test.ts`, `constitution-parity.test.ts`, `kairos-asks-parity.test.ts`, `project-kairos-feed-parity.test.ts`, `voice-notes-parity.test.ts`, `kairos-paid-backup-parity.test.ts`, `dominions-parity.test.ts` (focus + pinned, 0.27), plus `mcp-connector.test.ts` (old/new protocol, confirmations) and `mcp-profiles.test.ts`, `mcp-route.test.ts` (real route: per-profile tool lists, 400/404/401, the 20 destructive tools) (all in `app/api/__tests__/`). **Constitution amendments are operator-only:** MCP `accept_proposal` and bearer REST `POST /api/v1/memories/[id]/accept` refuse them (403); the operator-session path (Will inbox / Telegram) goes through `lib/kairos/proposal-accept.ts` `acceptKairosProposal`. **Intentional surface gaps:** dominions (except `get_dominion_focus` ↔ `GET /api/v1/dominions/focus` and `update_dominion` ↔ `PATCH /api/v1/dominions/[id]`), synthesis, dialogue, reflections and the older ask tools (run / pending / answer) are MCP-only; AI credentials/preferences are REST-only; canvas is REST-only.

---

## 5. AI engine (`apps/web/src/lib/ai/`)

Three-tier BYOK routing (cheap / standard / heavy) over user-supplied keys, all through the **Vercel AI SDK** envelope.

- **`route-task.ts`** — `routeTask(userId, req)` is the single entry for Kairos inference: user `enginePolicies` → global row → hard-coded `DEFAULT_POLICIES`. Task→tier (quality-over-cost retier, 07-24): `advisory`/`archetype`/`cortex`/`aether`/`delta`/`chat`/`reflect`/`digest` → heavy; `shell_heavy`/`code` → standard; `classify`/`summarise`/`voice` → cheap. Since 0.19 every Kairos paid call also passes the owner's **paid backup** switch: off, `getModelForUser` throws `PaidBackupOffError` (a no-credential error), so the caller declines.
- **Model registry** — `packages/shared/src/ai/model-registry.json` (+ typed `models.ts`, imported as `@aeon/shared/ai/models`) is the one list of models, defaults and effort for every consumer: web tiers (`providers.ts`), the Hangar mission picker (`lib/hangar-models.ts`), the kairos-worker (`apps/kairos-worker/src/models.ts`), the Kairos routines (`defaults.routine`) and the aeon_os reviewer (`defaults.reviewer`). `legacyRemap` (`LEGACY_REMAP`) maps every retired id to its successor; saved preferences are remapped at read time (`remapLegacyModel`, called from `providers.ts`), never rewritten — so the DB column defaults can keep naming old ids without a migration. `reviewedAt` is checked by the freshness report ([../docs/aeon-living-world.md](../docs/aeon-living-world.md)).
- **`router.ts`** — `resolveTier` from `userAiPreferences`, **remapping retired saved ids at read time** (`LEGACY_REMAP`; the DB column defaults still name Haiku 4.5 / Sonnet 4.6 / Opus 4.7 and are never called as-is); `resolveModelForUser` also returns the tier's effort. `getDecryptedKey` loads the active credential, stamps `lastUsedAt`, decrypts; wraps decrypt failures in `AiCredentialDecryptError`. `buildModel` maps `anthropic`/`openai`/`google` → `@ai-sdk/*`.
- **`provider.ts`** — `VercelAIProvider` implements `ask()` (generateText) **and `stream()` (streamText)**. Streaming is available at the provider level; the chat action currently uses `ask()`. `cacheSystem` seam (PR #84) sends the system prompt with an Anthropic `cache_control` breakpoint via `providerOptions` (no-op on other providers). **Fixed latent bug (commit `1512228`):** `toSdkArgs` now maps `req.maxTokens` → the SDK's `maxOutputTokens` — the old key was silently dropped by AI SDK v5, so per-call output caps were no-ops until this fix (wire-level regression test pins it).
- **`providers.ts`** — model catalog **derived from the shared model registry** (`packages/shared/src/ai/model-registry.json` + typed `models.ts`, reviewed 2026-10-02; the one source of truth for web tiers, Hangar picker, worker, routines and the aeon_os reviewer). Tier defaults: heavy `claude-opus-5-5` · effort high / standard `claude-opus-5-5` · medium / cheap `claude-sonnet-5-5` · low. Also offered: `claude-fable-5-1` (top tier, never default), `claude-haiku-4-5` (only fast option, no effort, retiring), OpenAI `gpt-6-astra` / `gpt-6.1-sol` / `gpt-6-luna` / `gpt-6-sol`, Google `gemini-3.8-flash` / `gemini-3.1-pro-preview`. Effort rides `providerOptions` (`anthropic.effort` → `output_config.effort`; `openai.reasoningEffort` → `reasoning.effort`). Requires `@ai-sdk/anthropic` ≥ 3.0.127 / `@ai-sdk/openai` ≥ 3.0.124 — earlier 3.x treat the 5.5 / GPT-6 ids as unknown (send temperature, 4096-token default cap, drop reasoning effort). The key test runs on each provider's own cheap model.
- **`crypto.ts`** — AES-256-GCM at rest (`AI_KEYS_MASTER_KEY`).

---

## 6. Integrations

| Service / lib | Purpose | Status |
|---|---|---|
| Neon (PostgreSQL) | Primary DB (`@neondatabase/serverless`) | Active |
| Drizzle ORM | ORM | Active |
| NextAuth v5 | Web auth | Active |
| Google OAuth | Sign-in (web + native mobile id-token) | Active |
| GitHub OAuth | Sign-in | Optional |
| Resend | Email (web magic links + mobile login tokens) | Active |
| Vercel | Hosting + cron scheduler | Active |
| Vercel AI SDK (`ai`) | Vendor-neutral `LanguageModel` envelope | Active |
| `@ai-sdk/anthropic` / `openai` / `google` | Claude / GPT / Gemini (BYOK) | Active |
| **Voyage AI (`voyage-3.5`, 1024-dim)** | App-owned memory embeddings (primary) | Active |
| **OpenAI `text-embedding-3-small`** | Embedding fallback (truncated to 1024-dim) | Active (fallback) |
| pgvector | 1024-dim memory vector column + HNSW | Active |
| MCP Protocol | AI tool server | Active (146 tools, MCP 2026-07-28 + legacy) |
| claude.ai remote connector | OAuth 2.1 MCP client → `/api/mcp` | Active (DCR + PKCE) |
| Pusher Channels | Real-time (30s polling fallback) | Active |
| ReactFlow (`@xyflow/react`) | Canvas | Active |
| `@react-three/fiber` / `three` / drei | Kairos + Aether WebGL | Active |
| `@dnd-kit/*` | Board DnD | Active |
| `@tanstack/react-virtual` | Virtual scroll | Active |
| `kairos-worker` runner | Pull-mode Hangar runner: claims queued sessions, worktree per mission, shells claude/copilot/codex, streams telemetry, posts the result envelope; CI typecheck+test since 2026-09-03 | Implemented; operator-hosted, runtime availability external — [hangar.md](hangar.md) |
| Capacitor | Legacy mobile shell (superseded by the Expo app for the chat slice) | Configured |
| Tauri | Desktop wrapper | Scaffold (parked) |

The app-owned **embedding layer** (Voyage primary / OpenAI fallback, single server key, `lib/kairos/embeddings.ts`) is distinct from per-user BYOK chat keys. When neither embedding key is set, retrieval degrades to pure FTS.

---

## 6.5 Versioning + CI gates

- App version is `APP_VERSION` in `apps/web/src/lib/version.ts` (**0.43.0**; Kairos `KAIROS_VERSION` **0.25.0** in `lib/kairos/version.ts`), surfaced in the Changelog modal; `apps/web/src/lib/changelog.ts` mirrors `/CHANGELOG.md` — bump all three together (the freshness report checks they agree). `package.json` versions remain scaffold defaults and are not the displayed product version.
- CI (`.github/workflows/ci.yml`): lint + typecheck + Vitest + **production build** for the web app, plus kairos-worker typecheck + tests; `auth-smoke` runs on every deployment (the 2026-06-08 outage guard). `.github/workflows/freshness.yml` runs the read-only freshness report weekly (Mondays 06:30 UTC) and keeps one open issue while anything is stale — see [../docs/aeon-living-world.md](../docs/aeon-living-world.md).

## 7. DB / cold-start reliability + cron schedule

- **Pool tuning** (`lib/db/index.ts`): `max:20`, `connectionTimeoutMillis:8000` (8s acquire < 30s route `maxDuration` so a hung connection surfaces as a caught 503).
- **OAuth `lastUsedAt` throttle** — 1/60s so per-request auth doesn't burn a second pool connection.
- **Keep-warm cron REMOVED** (commit `5c759e1`): the `*/4` `SELECT 1` was pinning Neon compute 24/7. Cold-start risk is now absorbed by the durable mutation queue + retry ladder (see [pm-app.md](pm-app.md)) and Neon's sub-second resume.

Cron schedule (`apps/web/vercel.json`, all `Bearer ${CRON_SECRET}`):

| UTC | Cron | Purpose |
|---|---|---|
| 23:00 | `project-snapshot` | per-project snapshot + board feed + ephemeral lifecycle compost |
| every 15 min | `hangar-reconcile` | 0.46: time out stalled running missions (`KAIROS_HANGAR_STALE_MIN`, default 30), flag unclaimed queued ones "Runner offline" |
| 01:10 | `dominion-activity` | 0.27: nightly activity score + dormant state per Dominion (skips when `KAIROS_LIVING_DOMINIONS` is off) |
| 01:30 | `memory-engine` | Merge → Weigh → OwnMind → **Recheck** → BackUp → Concepts (per-step time budgets with a Sunday reserve for Concepts since 0.17, `?dryRun=1`) |
| hourly :50 | `thinking-sweep` | plan / expire / paid-fallback thinking jobs (incl. the nightly **idea tournament**) |
| 02:00 | `chat-distill` | fallback for `chat_distill`: yesterday's kairos-chat threads (incl. Telegram) → reflections, before archetypes |
| 02:30 | `archetype-synthesis` | fallback for `archetype`: 3–7 archetypes / Dominion |
| 03:00 | `cortex-regen` | living cortex / Dominion (fallback for `cortex` job) |
| 03:15 | `aether-regen` | global Aether self-model (fallback for `aether` job) |
| 03:25 | `embed-backfill` | drain missing/stale embeddings |
| 04:25 | `synthesis-health` | nightly trace rollup + 2-strike ops alert |
| 04:30 | `ask-mine` | fallback for `ask_mine`: Kairos Asks + `card_notes` nudges |
| Mon 05:58 | `constitution-seed` | fallback for `constitution_seed` (BYOK users only) |
| 05:00 + 06:00 | `daily-message` | guaranteed 06:00 Europe/London speak (London-hour gate; free deterministic template when paid backup is off) |

**14 crons total** (0.27 added `dominion-activity`, 0.46 `hangar-reconcile`). Retired in 0.17: the briefer, introspection, contradiction scan, micro-consolidation and weekly dedup crons (`memory-compaction` and the 18:00 `digest` went earlier). The paid-key fallbacks skip with "paid backup off" when the owner turns the switch off (`lib/kairos/paid-backup-cron.ts`). The Kairos **thinking routines** (*Vorath brain*, *Vorath chat*, *Vorath pulse* — renamed in place from Kairos in 0.26; defined in `lib/kairos/routines/catalog.ts`) are deliberately NOT Vercel crons — they run as Claude Code routines on the owner's Max plan. The older Sonnet brain-tick routine is retired.

See [kairos/synthesis.md](kairos/synthesis.md) for what each synthesis cron produces.
