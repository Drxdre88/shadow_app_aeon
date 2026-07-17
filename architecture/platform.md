# Architecture — Platform & Integration Surface

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

Aeon exposes four programmatic front doors over the same three-layer data core (`lib/data` pure queries → `lib/actions` auth-guarded actions → API surfaces):

1. **REST API** (`/api/v1/*`) — session- or bearer-authenticated; the surface the web app, scripts, and the mobile app call.
2. **Mobile auth** (`/api/v1/auth/mobile/*`) — issues 90-day bearer sessions for the mobile app.
3. **OAuth 2.1 authorization server** (`/api/oauth/*` + `/.well-known/*`) — lets claude.ai's OAuth-only remote MCP connector reach the MCP server.
4. **MCP tool server** (`/api/[transport]/`) — **109 tools across 19 categories** for AI agents.

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
| `realms` | `realms`, `[realmId]` + members/projects |
| `memories` | `memories`(+search,capture,context,needs-summary), `[id]`(+export,neighbours,accept,links) |
| `ai` | `ai/credentials`(+`[id]`,test), `ai/preferences` — **admin-gated** |
| `sessions` | `sessions`, `[id]`(+events,kill) |
| `recipes` | `recipes`, `recipes/run`, `recipes/traces` — REST mirror of `run_recipe`, sharing `runRecipeArgs` + `dispatch.runRecipe` so MCP/REST never drift |
| `projects/[id]/favorite` | PUT toggle for per-user project favorites (PR #80; mirrors MCP `set_project_favorite`) |
| `kairos/speak` | `POST /api/v1/kairos/speak` — **Kairos-initiated delivery** (Will-inbox `notify` memory + best-effort Telegram fan-out). Auth `Bearer ${CRON_SECRET}` (cron idiom, not user bearer). Server-side interrupt throttle: 4h min gap + 3/24h cap → 429; `force:true` bypass audit-logged and ceilinged at 10/24h. **Deliberately OUTSIDE MCP/REST parity** — internal delivery channel, no MCP mirror. |

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

Auth: Bearer only (API key, master key, mobile session, or OAuth `aeon_at_`) via `verifyToken` → `authenticateRequest`. **109 tools across 19 categories** (`tools/index.ts`, `route.ts:44-62`). **As of PR #83 every tool carries MCP annotation hints** (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint:false`) — 109/109 coverage, enabling client-side defer-loading and safe-tool filtering:

| Category | Count | Notes |
|---|---|---|
| projects | 7 | list, get, create, update, delete, summary, **set_project_favorite** (PR #80) |
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
| memories | 9 | create, update, search, link, prepare_context, get_with_neighbours, list_needs_summary, **accept_proposal**, **get_belief_trail** (bi-temporal chain walk, PR #72) |
| dominions | 15 | CRUD + vision/objectives + repo mapping + project assignment (MCP-only) |
| sessions | 5 | spawn, list, get, list_events, kill |
| reflections | 1 | `kairos_reflect` |
| recipes | 2 | run_recipe, get_trace_history |
| **synthesis** | 2 | `prepare_aether_context`, `commit_aether` — Aether (global self-model) via the Claude-Code cognition path (no BYOK) |
| **ask** | 3 | `run_kairos_ask`, `get_pending_kairos_ask`, `answer_kairos_ask` — proactive one-question loop |
| **dialogue** | 5 | `open_dialogue`, `prepare_dialogue_context`, `append_dialogue_turn`, `get_dialogue`, `commit_dialogue` |

**Parity locks:** `gantt-parity.test.ts` (Gantt MCP↔REST), `memories-parity.test.ts` (8 memory tools vs REST). Sessions have matching shapes but **no parity test** (drift risk). **Intentional surface gaps:** dominions, synthesis/ask/dialogue, and reflections are MCP-only; AI credentials/preferences are REST-only; canvas is REST-only.

---

## 5. AI engine (`apps/web/src/lib/ai/`)

Three-tier BYOK routing (cheap / standard / heavy) over user-supplied keys, all through the **Vercel AI SDK** envelope.

- **`route-task.ts`** — `routeTask(userId, req)` is the single entry for Kairos inference: user `enginePolicies` → global row → hard-coded `DEFAULT_POLICIES`. Task→tier (post cost-retier PR #84): `brief`/`advisory`/`aether` → heavy; `archetype`/`cortex`/`contradiction`/`chat`/`reflect`/`shell_heavy`/`code` → standard; `classify`/`summarise`/`voice` → cheap.
- **`router.ts`** — `resolveTier` from `userAiPreferences`; `getDecryptedKey` loads the active credential, stamps `lastUsedAt`, decrypts; wraps decrypt failures in `AiCredentialDecryptError`. `buildModel` maps `anthropic`/`openai`/`google` → `@ai-sdk/*`.
- **`provider.ts`** — `VercelAIProvider` implements `ask()` (generateText) **and `stream()` (streamText)**. Streaming is available at the provider level; the chat action currently uses `ask()`. `cacheSystem` seam (PR #84) sends the system prompt with an Anthropic `cache_control` breakpoint via `providerOptions` (no-op on other providers). **Fixed latent bug (commit `1512228`):** `toSdkArgs` now maps `req.maxTokens` → the SDK's `maxOutputTokens` — the old key was silently dropped by AI SDK v5, so per-call output caps were no-ops until this fix (wire-level regression test pins it).
- **`providers.ts`** — model catalog. Anthropic tier defaults: `claude-haiku-4-5` cheap / `claude-sonnet-5` standard / `claude-opus-4-8` heavy. OpenAI catalog carries the **GPT-5.6 family** (`gpt-5.6-luna`/`-terra`/`-sol`) alongside legacy 5.5 entries — catalog-only until a user selects OpenAI in prefs. Google: gemini-2.5-flash/pro.
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
| MCP Protocol | AI tool server | Active (109 tools) |
| claude.ai remote connector | OAuth 2.1 MCP client → `/api/mcp` | Active (DCR + PKCE) |
| Pusher Channels | Real-time (30s polling fallback) | Active |
| ReactFlow (`@xyflow/react`) | Canvas | Active |
| `@react-three/fiber` / `three` / drei | Kairos + Aether WebGL | Active |
| `@dnd-kit/*` | Board DnD | Active |
| `@tanstack/react-virtual` | Virtual scroll | Active |
| `kairos-worker` subprocess | Long-running CLI engine for spawn | Active |
| Capacitor | Legacy mobile shell (superseded by the Expo app for the chat slice) | Configured |
| Tauri | Desktop wrapper | Scaffold (parked) |

The app-owned **embedding layer** (Voyage primary / OpenAI fallback, single server key, `lib/kairos/embeddings.ts`) is distinct from per-user BYOK chat keys. When neither embedding key is set, retrieval degrades to pure FTS.

---

## 7. DB / cold-start reliability + cron schedule

- **Pool tuning** (`lib/db/index.ts`): `max:20`, `connectionTimeoutMillis:8000` (8s acquire < 30s route `maxDuration` so a hung connection surfaces as a caught 503).
- **OAuth `lastUsedAt` throttle** — 1/60s so per-request auth doesn't burn a second pool connection.
- **Keep-warm cron REMOVED** (commit `5c759e1`): the `*/4` `SELECT 1` was pinning Neon compute 24/7. Cold-start risk is now absorbed by the durable mutation queue + retry ladder (see [pm-app.md](pm-app.md)) and Neon's sub-second resume.

Cron schedule (`apps/web/vercel.json`, all `Bearer ${CRON_SECRET}`):

| UTC | Cron | Purpose |
|---|---|---|
| 23:00 | `project-snapshot` | per-project snapshot + ephemeral lifecycle compost |
| **02:00** | **`chat-distill`** | **distil yesterday's kairos-chat threads (incl. Telegram) into reflections — runs BEFORE archetypes so they feed the same night's chain (PR #89)** |
| 02:30 | `archetype-synthesis` | 3–7 archetypes / Dominion |
| 03:00 | `cortex-regen` | living cortex / Dominion |
| 03:15 | `aether-regen` | global Aether self-model |
| 04:00 | `embed-backfill` | drain missing/stale embeddings |
| **05:00** | **`contradiction-scan`** | **belief-contradiction sweep (standard tier, `contradiction` task policy)** |
| 06:30 | `introspection` | staged `inbound` proposals / Dominion |
| 07:00 | `briefer` | one advisory / Dominion |
| Sun 03:00 | `memory-compaction` | weekly substrate count/report (stub) |
| Sun 05:00 | `memory-dedup` | weekly near-duplicate supersession |

**11 crons total.** The Kairos **brain-tick** is deliberately NOT a Vercel cron — it runs as a Claude cloud routine 3×/day executing `docs/kairos/29-brain-tick.md`, POSTing to `/api/v1/kairos/speak` when a signal clears the interrupt bar.

See [kairos/synthesis.md](kairos/synthesis.md) for what each synthesis cron produces.
