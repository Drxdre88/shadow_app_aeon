# Architecture — Recent Changes (append-only trail)

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

Reverse-chronological. The most recent work is at the top; the pre-2026-06-06 trail is preserved
verbatim below.

### 2026-07-24 (evening) — Live Mind wave: continuous awareness + incident lifecycle + quality retier

Operator directive: Kairos's JARVIS gap is his eyes (nightly-batch mind, day-behind chat), and quality now beats cost. One branch, swarm-built (3 recon prowlers → 2 parallel executioners + main-agent retier → 5-horsemen review incl. Codex → consolidated fix pass):

1. **Live chat grounding** — recency term (14d half-life) added to chat substrate scoring on both search paths (was absent entirely — root cause of the same-day-reflection miss); deterministic LAST-24H block every turn; agentic tools DEFAULT ON with new `recent_activity` + `synthesis_status` (self-certification) tools; `search_brain` upgraded to the hybrid path; 30s tool budget; sessions data layer gains a `since` filter.
2. **Micro-consolidation** — `micro-consolidate` cron 6×/day: per-Dominion `delta` fold of the day's new memories; cortex/aether prompts gain "Today so far" grounding. Cron fleet 14. New streamClass `delta`.
3. **Incident lifecycle** — `resolves` link type stamps targets' `invalidAt` (create-time AND post-hoc via addLink); `validAsOfNow` gate unified into one shared helper and applied across synthesis inputs + traces + chat retrieval. Kills the post-heal narrative-hysteresis class.
4. **Quality-over-cost retier** — archetype/cortex/contradiction/chat/reflect/digest/delta all heavy tier (operator standing directive; ~1.3-1.5× nightly cost accepted).
5. Hardening from review: resolves stamping transactional + UUID-filtered; recency clamp for future timestamps; Telegram update_id best-effort dedup + hard tool-loop deadline; micro-consolidate truncation visibility.

### 2026-07-24 — Kairos 0.9.0: reliability heal (PRs #95–98) + Evening Digest + guide refresh

1. **Synthesis reliability arc closed** — one-shot JSON repair shared across all 4 standard generators + health scorecard + 2-strike Telegram ops alert (PR #95); TRUE root cause of the ~12-night outage was output-cap truncation, caps raised (PR #97); ask-mine string-date crash + cron maxDuration 800 + title clamp (PR #96); introspection citation tolerance — schema degrades per-proposal, unique ≥8-char prefix resolution, repair call now gets the system block + valid-id list (PR #98). First 9/9 synthesis day in ~13 nights on 07-24.
2. **Evening Digest** (`lib/kairos/digest.ts` + `digest-prompt.ts` + `api/cron/digest`, 18:00 UTC — cron fleet now **13**) — guaranteed daily speak in the new `digest:true` register; layered fallbacks (model → counts-only template → minimal message), stale-rollup freshness check, `delivery_blocked` visibility, `externalId` dedup closing the double-send race. New window-bounded `countTasksCompletedBetween`/`countTasksCreatedBetween` in `board-signals.ts`.
3. **Speak registers hardened** — `opsAlert`/`digest` rows excluded from cadence counting AND `getConversationState` (fixes latent ops-alert `awaitingReply` deadlock); optional `externalId` on `speakSchema` with dedup-hit fan-out skip (`alreadyDelivered`). First test file for `deliverKairosSpeak`.
4. **Kairos versioned as its own product** — `lib/kairos/version.ts` (0.9.0) + `docs/kairos/CHANGELOG.md` era history 0.1→0.9; sidebar/Learn-modal pills now derive from it.
5. **In-app guide refresh** — KairosGuideContent rewritten to current reality (galaxy-only, full-screen visor, whole-brain threads, live board grounding) + new Aether/speaks-first/Evening-Digest sections; McpTab rebuilt from the real registry (109 tools, count derived); galaxy page gained a help button.

### 2026-07-17 — Kairos autonomy wave (PRs #71–89): whole-brain chat, Telegram, speaks-first, chat-distill

Full refresh of the architecture set (all 9 subsystem files) covering three weeks of Kairos work:

1. **Mind hardening** — bi-temporal `validAt`/`invalidAt` (0025) + belief trail (PR #72); read-time confidence decay (PR #73, same fn drives galaxy brightness); Voyage `rerank-2.5` cross-encoder stage (PR #75); Dominion **auto-filing** as resolution step 4 (PR #76, cortex-centroid cosine). Retrieval pipeline is now fuse → decay → rerank → top-5.
2. **Subtract pass (PR #81)** — Aether UI + `/aether` route + `Kairos2D` DELETED; the galaxy is the only spatial view. Lieutenants cut 4→1 (Sentinel); Oracle's pulse became the brain-tick.
3. **Whole-brain chat (PRs #75/#77)** — Dominion picker dropped; unanchored threads ground in the **Aether self-model**; turn engine extracted to `lib/kairos/chat-turn.ts` so web + Telegram share it.
4. **Will inbox (PR #82)** — bell/panel with brief/ask/notify/proposal kinds; same idempotent triage fns serve web + Telegram callbacks.
5. **Telegram two-way (PRs #85/#87)** — webhook + speak fan-out + markdown→Telegram-HTML renderer + surface-steered texting persona.
6. **Speaks-first (PR #88)** — `POST /api/v1/kairos/speak` with server-side interrupt throttle (4h gap / 3 per day / force ceiling 10); brain-tick playbook `docs/kairos/29-brain-tick.md` executed by a Claude cloud routine 3×/day.
7. **Chat→brain closed (PR #89)** — nightly `chat-distill` cron (02:00 UTC, before archetypes) distils operator signal from the day's threads into reflections. Cron fleet now **11**.
8. **Platform** — all 109 MCP tools annotated (PR #83); cost retier + prompt caching (PR #84: synthesis → standard tier, `cacheSystem` seam); `maxTokens`→`maxOutputTokens` fix (`1512228` — per-call caps were silently ignored); GPT-5.6 catalog; tiers sonnet-5/opus-4-8. Project favorites (PR #80, 0026) + checklist ghost-input fix (PR #86).

### 2026-06-27 — Mobile app (Google login slice) + memory-capture overhaul + architecture-folder restructure

1. **Mobile app scaffolded** — new `apps/mobile/` Expo app (SDK 53 / RN 0.79 / React 19), v1 = Kairos chat. The **login slice** is built: native Google sign-in (`@react-native-google-signin/google-signin`) → POST id token to the pre-existing `/api/v1/auth/mobile/google` → 90-day `aeon_s1_` session in the keychain → `apiFetch` Bearer. Reverses the Capacitor-over-RN decision. Awaiting operator Google Cloud client IDs + a dev build to run. See [mobile.md](mobile.md).
2. **Claude session-capture hook overhauled** (`apps/web/scripts/claude-session-capture.mjs` + `~/.claude/hooks/summarise-memories`) — child-session guard (no more "memories about summarising memories"), stronger substance gate (drops stubs, keeps design sessions), deterministic in-hook `aiTitle`/`execSummary`, and the summariser now drains the backlog (batch 12, looped) instead of 3-at-a-time. See [kairos/memory-and-capture.md](kairos/memory-and-capture.md).
3. **Architecture docs split into the `architecture/` folder** (this restructure) — mirroring the Swarm convention: `ARCHITECTURE.md` is now a router/index; detail lives in `architecture/{directory-map,data-layer,platform,pm-app,mobile,inventory-and-gaps,history}.md` + `architecture/kairos/{overview,memory-and-capture,synthesis,chat}.md`. Content refreshed to current code (MCP 109 tools/19 cats; migrations through 0024; embeddings + Aether/ask/dialogue + 9-cron pipeline).

### 2026-06-22 — Smooth UI Renders master motion switch

One General-settings toggle (default ON) that makes the whole app instant when OFF, via a global `html[data-reduce-motion='true']` stylesheet (`globals.css:208`), Framer `MotionConfig reducedMotion="always"` (`ThemeProvider.tsx:104`), and gated JS timers. State `smoothUiRenders` on `themeStore` (`useSmoothUiRenders()`, `themeStore.ts:407`), persisted via theme prefs. +3 tests. (commit `056d8f2`)

### 2026-06-22 — Never-asleep saves: auto-retry + durable offline queue

Board writes no longer vanish when Neon is waking or the network drops. `persistMutation` (`lib/store/persistMutation.ts`) retries transient failures over a `[400,1000,2200]`ms ladder before any rollback; hard rejections fail fast. A durable `zustand/persist` mutation queue (`lib/store/mutationQueue.ts`, localStorage `aeon-mutation-queue`, FIFO, idempotent replay) survives tab close / hours offline and re-syncs on `online`/visible/load. `SaveStatusPill` shows Saving / Reconnecting / Offline (N) / Saved. +15 tests. (commit `fc9806c`)

### 2026-06-21 — Drop keep-warm cron (let Neon scale to zero)

Removed the `*/4` `SELECT 1` keep-warm cron — it sat just inside Neon's 5-min scale-to-zero window so compute never suspended (~720h/month, blowing the budget). Cold-start risk is now absorbed by the never-asleep save queue + Neon's sub-second resume. Supersedes the 2026-06-06 keep-warm entry. (commit `5c759e1`)

### 2026-06-20 — Owner + realm members in the task assignee list

Fixed an empty assignable list on realm projects (and a never-assignable owner). New `findAssignableMembers` (`lib/data/members.ts:27`) unions owner + explicit members + realm members; used by `TaskAssigneeOverlay` + `assignTaskAction`. (commit `22b281a`)

### 2026-06-16 — Avatar pile on task cards (shipped)

The assignee feature is now visible: cards render an overlapping pile (image/initials, +N overflow) via `AssigneeDot` (`SortableTaskCard.tsx:337,494`); assignees bulk-load into `boardStore.assigneesByTask` and update live from the overlay. (commit `95537d0`) Also in this window: card autosave (`22b55ba`), instant card-edit open + suspended ambient effects (`487c618`), memoized column task-ids (`c4a6ac4`), prefetch nav + lifted 200-card cap (`942abcc`), assign-member hotkey on hover (`1c54a94`).

---

## Preserved trail (2026-06-06 → 2026-04-16)

### 2026-06-06 (later) — claude.ai MCP connector connects (discovery → middleware)
Root-caused the persistent connector failure: discovery routes returned empty `500` shells because Next.js statically prerenders `force-dynamic` GET route handlers (Turbopack/PPR delivery bug). A failed first fix (importing `next/headers` into the shared `lib/oauth/origin.ts`) poisoned every OAuth route. Working fix: serve both discovery docs from `middleware.ts` (`serveOAuthDiscovery`), per-request, never statically optimised. Verified against claude.ai's 2026 requirements (DCR/RFC 7591 + PKCE S256 + protected-resource/AS metadata + streamable HTTP). Connected end-to-end.

### 2026-06-06 — DB/cold-start reliability hardening + AI key decrypt safety
Pool `connectionTimeoutMillis` 20s→8s + `max` 10→20 + `maxDuration=30` so a hung connection surfaces as a caught 503 (not a silent Vercel function-kill). (Keep-warm cron added here was later removed 2026-06-21.) OAuth `lastUsedAt` throttled to 1/60s. `AiCredentialDecryptError` wraps rotated-master-key decrypt failures so synthesis skips with a clear message instead of crashing. Session-capture backfill paced + backed off. Tests 1688 → 1777.

### 2026-06-05 — OAuth 2.1 remote connector + recipes/dispatcher (Phase 3C)
OAuth 2.1 AS (migration 0022): `oauthClients`/`oauthAuthCodes`/`oauthAccessTokens` + `/api/oauth/{register,authorize,token}` (DCR + PKCE S256 + refresh rotation). `verifyOAuthAccessToken` accepts `aeon_at_` in `authenticateRequest`. Recipes + dispatcher: `runRecipe` is the single synthesis-write entry; BRIEF is the first recipe; MCP `recipes` category added.

### 2026-06-02 (afternoon) — Phase 1C C2 + horsemen fix-pack
Memory-grounded chat replies (cortex + archetypes + top-5 substrate, `[[uuid]]` citation chips, hallucination guard, "Reading:" line). `KairosVisor.tsx` split 512 → 220 lines across 5 files; mapping + payload modules extracted to be DB-free + unit-testable. Tests 1622 → 1688.

### 2026-06-02 (morning) — Kairos Phase 2: synthesis layer, reflections, chat surface
Phase 1A: `streamClass` column (mig 0021) + 8 Dominions partitioned + Briefer reframed to live board awareness. Phase 1B: nightly archetype generator (02:30) + Dominion cortex regen (03:00) + `kairos_reflect` MCP tool. Phase 1C C1: per-Dominion chat Visor reusing `agent_sessions`/`session_events`. Cron cycle wired (snapshot→archetypes→cortex→briefer + weekly compaction). Tests 1584 → 1622.

### 2026-05-30 — Kairos companion: BYOK, briefer, spawn, sidebar overhaul
BYOK three-tier model routing (Anthropic/OpenAI/Google, AES-256-GCM, admin-gated `/settings/ai`). Kairos Phase 1 (memory taxonomy + capture + engine router + Briefer). Spawn primitive (`agent_sessions`/`session_events`, mig 0019, `apps/kairos-worker/`). Dominions (migs 0016/0017, 16 MCP tools). Task assignees (mig 0020). Daily Briefing + EOD → sidebar popovers; Sidebar Home button; Notes bento page. Tests 1576 → 1584.

### 2026-05-23 — Kairos rebrand + Dominions + memory schema
`brain/` → `kairos/` across app/components/docs. Kairos 2D WebGL rebuild on @react-three/fiber + d3-force-3d. Dominions table family; `projects.dominionId` + `memories.dominionId` FKs. Memory schema `aiTitle` + `execSummary` (mig 0015); `list_memories_needing_summary` MCP + REST mirror.

### 2026-04-17 — checklist atomic ordering + board perf
`checklist.ts` `db.transaction()` with `MAX(orderIndex)`; `VirtualizedTaskList` height + opacity gate; `TaskBoard` `tasksByColumn` Map pre-compute.

### 2026-04-16 — Gantt MCP/REST parity
Gantt MCP 52 → 63 tools; 7 new REST route files; `gantt-parity.test.ts` 53-assertion static parity lock.
