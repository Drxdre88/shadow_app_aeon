# Architecture — Recent Changes (append-only trail)

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

Reverse-chronological. The most recent work is at the top; the pre-2026-06-06 trail is preserved
verbatim below.

### 2026-10-02 (later) — Kairos 0.18 "Catch-up mornings, watched boards, voice notes" · app v0.35.0
- **06:00 message + numbered open questions:** delivery moves to 06:00 London (cron `0 5,6 * * *`; plan window 04:00Z, settled 04:35Z). Code appends an "Open questions" block from `kairosAsk.seq` (stable per-user numbers, cap 10, 14-day expiry, `dismissed` status). `lib/kairos/ask-numbered.ts` routes `Q12: …` / `skip Q12` on Telegram before chat. Any open ask can be answered by id. New MCP/REST `list_open_kairos_asks`, `dismiss_kairos_ask` (parity test).
- **Watched boards:** `settings.kairosFeed` set via `setProjectKairosFeed` (merge; owner only) — action, MCP `set_project_kairos_feed`, REST `PUT /api/v1/projects/{id}/kairos-feed`. `update_project` merges settings. Same-day `board_card_done` memories (agentic, origin activity, excluded from belief signals and BackUp support). Board-day pages gain a summary line; cortex reads watched boards' finished titles. Connect Kairos gains Watched (boards + core repos) and Voice notes views.
- **Voice notes:** MCP `kairos_voice_note` / REST `POST /api/v1/kairos/voice-notes` stage verbatim parts as pending agent proposals (`voiceNote:{noteId,part,of}`); `confirmVoiceNote` (UI only) accepts them as operator reflections; belief extraction reads up to 2,000 chars of confirmed parts.
- **Constitution seed on Max:** thinking kind `constitution_seed`; the cron moves to `58 5 * * 1` as fallback. BRIEF recipe, `run_recipe` and `/api/v1/recipes/run` retired.

### 2026-10-02 — Kairos 0.17 "Simplified brain: one Max routine" · app v0.34.0
- **Audit first:** each thinking job was traced to its readers and checked against live data (`research/kairos_0210/02_brain_jobs_audit.md`). 14 kinds stay. Retired: `brief`, `introspection`, `contradiction`, `micro_consolidate`, and the `briefer`, `introspection`, `contradiction-scan`, `micro-consolidate` and `memory-dedup` crons with their handlers and libs.
- **Daily message without briefs:** it plans from 05:30Z once aether, ideas and ask are settled (from 06:25Z regardless), and reads each area's latest cortex headline (`readAreaHeadlines`). The inbox pins today's message, filters out old contradiction notices, and the sidebar briefing button and advisory feed are gone.
- **Routines in code:** `lib/kairos/routines/catalog.ts` is the single source of truth: two routines (`Kairos brain`, cron `40 1-6 * * *`, claims with `{}`; `Kairos chat`, API-triggered), self-contained prompts, and `BRAIN_JOBS` (kind → brain area). `PLANNED_THINKING_KINDS` must equal the catalog (test). Claims drop retired kinds instead of failing.
- **Connect Kairos modal** (`components/kairos/brain/*`): Status, Brain map, Connect, Routines (web form vs `/schedule`) and Telegram views, fed by `getKairosBrainStatus` (`lib/data/brain-status.ts`).
- **Memory engine fix** (the 02/10 failure): per-step time budgets with a Sunday reserve for Concepts. Weigh writes in 100-row transactions, only when standing moves ≥ 0.05 from the stored value, and rotates through id-hash buckets. BackUp works in chunks of 25 with batched writes. `statement_timeout` 10 s inside engine transactions. Old contradiction notices no longer count as open challenges.

### 2026-10-01 (night) — Kairos 0.16 "All on Max" (PR #141) · app v0.33.0
- **New thinking kinds:** the seven remaining paid-key crons become thinking kinds: `chat_distill`, `archetype`, `ask_mine`, `contradiction` (one batched job per Dominion), `brief`, `introspection` and `micro_consolidate`. There are now 18 kinds.
- **Crons become fallbacks:** each kind is planned in a window that closes 2 min before its old cron. The cron is now only the fallback, guarded by `isJobDone` (`lib/data/thinking-jobs.ts`).
- **One write path per lib:** `prepareRecipeContext` / `persistRecipeOutput`, `persistArchetypes`, `persistChatDistillReflections`, `stageContradictionProposals`, `persistIntrospectionProposals`, `persistMicroConsolidateDelta`, `prepareAskMine` / `finishAskMine`.
- **Answer format and timing:** `brief` and `micro_consolidate` take markdown answers (`TEXT_ANSWER_KINDS`). The daily message waits for every brief job, or 06:25Z. Tidy-up windows anchor on `sourceMetadata.until`.
- **Schedule:** `embed-backfill` moves 04:00 → 03:25 UTC. No migration.
- **Routines:** six, all Opus 5.5: dusk 01:40, thinking 02:40, ideas 03:35, dawn 04:00, morning 05:40, tidy at :05 past 09/12/15/18/21/23 UTC. The paid key is left only for fallbacks and Telegram chat.

### 2026-10-01 (evening) — Kairos 0.14 Ground & Protect (#137, #138) · 0.15 Creativity (#139) · Max routines live
- **0.14 Ground & Protect (PR #137, hotfix #138):**
  - **Origin at write:** `sourceMetadata.origin` (`lib/kairos/origin.ts`), stamped by the trusted surface and capped by `source`. Agent edits and classifier-distilled ask answers lower it.
  - **Trust and promotion:** SourceTrust weighs reflections by origin. BackUp needs ≥1 operator or activity support (`anchoredSupports`).
  - **Belief caps and re-check:** belief `sourceType` and confidence are computed from provenance origins (caps 0.95 / 0.8 / 0.6). New engine step `recheck` (flag / remap / normalise / retire; ops `recheck` and `retire`). `belief_extract` can retire flagged beliefs.
  - **Conscience block** (`lib/kairos/conscience-context.ts`) goes into chat, the daily message, the weekly review and BRIEF. The briefer now reads cortex plus an Aether digest.
  - **Nightly conscience checks:** a `drift_probe:<day>:conscience` job.
  - **Retrieval fixes:** retrieval and `prepareContext` drop superseded and invalid rows; belief and constitution are exempt from the 90-day window; new half-lives; Merge window 96 h / 400.
  - **#138:** night order is now Merge → Weigh → OwnMind → Recheck → BackUp → Concepts.
- **0.15 Creativity (PR #139):**
  - **New thinking kinds** `idea_generate` and `idea_judge` (11 kinds total).
  - **Pipeline:** `lib/kairos/ideas/*` and `lib/data/ideas.ts` (archive, novelty gate, outcomes, diversity) plus `idea-inputs.ts`. Survivors are inbound `kind:'idea'` proposals; the others are archived `idea_candidate` trace rows.
  - **Surfaces:** inbox idea cards, daily "Idea of the day", and a weekly-review ideas section, lessons and belief diff (`lib/data/belief-diff.ts`).
  - **Retiring the raw dump:** `KAIROS_RAW_INTROSPECTION` flag. synthesis-health gains an `idea-tournament` stage.
  - **Limits:** thinking-job submit `maxDuration` 300. MCP `claim_thinking_job` takes up to 11 kinds.
- **Max-plan routines created** on claude.ai: Kairos thinking 02:40Z, ideas 03:35Z, morning 06:30Z; all Opus with the Aeon connector only. The first contest ran on the routine.
- **No schema change in 0.14–0.15**; 17 crons and the MCP tool count are unchanged.

### 2026-10-01 — Kairos 0.11–0.13: Eyes & Heal (#133) · Memory Engine (#134) · undo hotfix (#135) · Beliefs & Strategy (#136)
- **0.11 Eyes & Heal (PR #133, 30/09)** — asks unblocked (only real questions await a reply); server-minted ids for every synthesis stage + one repair path; per-cron daily ok/skipped health rows; capture choke point (`stream-class-default.ts`) + session record v1 (`sourceMetadata.session`) for all three coding clients; Hangar mission memory; board feed (`settings.kairosFeed` → `board_day`/`board_week`) + `card_notes` nudge written back to cards; shared 14-day recency; `micro-consolidate` gains a 23:15 pulse; `memory-compaction` stub removed.
- **0.12 Memory Engine (PR #134, 30/09)** — migration `0039_kairos_memory_engine` (`standing`, `standing_at`, `last_used_at`, `use_count`; `memory_ops`; `thinking_jobs`); nightly `memory-engine` cron 01:30 (Merge → Weigh → BackUp → OwnMind → Concepts); shared ranker relevance × standing; undo via `list_memory_ops`/`revert_memory_op`; reactions rescore immediately; thinking queue claimed by Claude Max routines with paid-key fallback.
- **Hotfix (PR #135, 01/10)** — first engine night lost undo records at the 300s limit; `memory_ops` now written in each change's transaction; `scripts/backfill-memory-ops-1001.mjs` restored 349.
- **0.13 Beliefs & Strategy (branch `feat/kairos-beliefs-strategy`, PR open)** — two minds (aligned via `belief_extract`, own via OwnMind mirror; Monday `mind_compare`); constitution (one live version, operator-only amendments, `constitution-seed` Mon 04:20) + 24 drift probes; **daily message** 08:00 Europe/London replaces the 18:00 Evening Digest (`digest` cron + `digest.ts` deleted); Monday weekly review; hourly `thinking-sweep` plans all sweep kinds; chat `undo_kairos_change` (HMAC-confirmed); chat turn split into `chat-turn-{assistant,reply}.ts` with an exactly-once reply ledger; Telegram chat routine behind `KAIROS_TELEGRAM_ROUTINE`; briefer 06:15, synthesis-health 06:45.
- **Surface totals:** 17 Vercel crons; MCP 127 tools / 25 categories (new memory-ops, thinking, beliefs, constitution) with REST mirrors under `api/v1/kairos/`; new parity tests incl. sessions.

### 2026-09-21 — v0.29.0 release preparation (PR #130)
Owner authorized publishing the mission-card and runner wave. Final workflow review corrected incomplete draft saving: Save draft uses the existing draft validator, while Launch requires repository and instruction. Documented the dedicated Agent OS board workflow, per-flight auto-run opt-in, and human-owned Done. Three focused Cartographer lanes reconciled UI semantics, runner prompt transport/account availability, and dated verification. The supervised Swarm research exercise and separate saved-evidence audit are not an autonomous harness PASS. CI/deployment evidence belongs to PR #130; no new migration is required.

### 2026-09-21 — Mission cards, repository management and runner tier · v0.29.0 (local preparation)
Restores the bespoke mission UI promised by the August blueprint: distinct board face, mission-first card details, recorded result fields and direct configure/launch access. The new Repositories toolbar opens realm-scoped registration/edit/retire controls; repository labels no longer have to explain execution context. Uses the existing mission metadata and registry tables, without a migration. Result-column mapping now also recognizes the UI's enabled setting. Copilot effort/context are explicitly passed and checked, research receipts record tier/budget, and the Windows launcher resolves its environment file by script path. Documentation corrects stale claims that Sprint 3 and the first exact review PASS were complete: artifact preservation, publication-state tracking, automatic PRs and runner recovery remain open. This entry describes local implementation, not deployment or a new live mission receipt.

### 2026-09-17 — Completion claim guard and CI review gate (PR #129)
The REST result ingress downgrades empty implement/bug-fix completion claims to needs-input and records the downgrade; the runner stamps local branch/HEAD before posting. The gate suite now runs in CI. Handover records post-merge production acceptance 15/15 plus successful authentication smoke. Best live independent review is PASS_WITH_CORRECTIONS with four minor findings, which exact-PASS policy correctly refuses.

### 2026-09-16 — Aeon OS review gate fired for real · v0.28.0 (PR #127 + `fix/aeon-os-review-gate`)
Independent-review PASS gate (`aeon_os/workflows/review.mjs`) merged 15/09 and exercised live 16/09: three production runs, two harness defects found and fixed (Copilot CLI ignores piped stdin when `-p` is present → whole prompt on stdin; reviewer provenance read from the real `--usage-output-file` shape), a bundle gap closed (shorthand `:N` citation continuations), a random **receipt token** as proof of receipt, marker-consistency check at gate evaluation, first legitimate verdict a FAIL with 10 findings (three confirmed citation drift by hand). Browser **Save & Launch** exercised for the first time (Playwright, receipt in `results/ui-2026-09-16-browser/`). PR #127 also: REST 404 on malformed ids, 400 on bad objectives, 409 naming the live session on duplicate launch; mission editor **model picker**; missions record the observed model; Windows worktree teardown retry. New doc **`architecture/hangar.md`**. Gate suite 56 tests. Horsemen (4 reviewers, cross-model) PASS_WITH_NOTES → all findings folded in.

### 2026-09-04 → 09-07 — Board waves v0.24–v0.27 (PRs #122–#126)
Card fusion v2 + the fusion effect (ghosts fly into the survivor), hold-to-move, phone drag-right scroll fix + slim Add Column on touch, member avatar styling (palette / text colour / shape / realm-wide initials — styling beats the photo; migrations 0036/0037). Chronos P0 reset guard + P1.5 engine (0034/0035) built but unwired. Flight Deck telemetry + parallel mission worktrees (PR #120, 03/09).

### 2026-08-26 — Night-swarm PM wave: focus surfaces, virtual members, trophy rebuild (PR #107)

Owner directive: four live board bugs plus five UX asks, delivered by a parallel swarm in one night, then reviewed hard. 16 commits on `feat/night-swarm-2608`.

1. **Bugs** — checklist **group order** no longer reshuffles when an empty group precedes a filled one (order is remembered, not derived from items; `checklist/groupOrder.ts`); **custom priority appearance** now renders inside the card editor via one `resolvePriority` accessor, with every duplicated factory palette deleted; **contained pinch-zoom** replaces the browser zoom that escaped the app canvas, and the zoomed board is laid out at container-height ÷ scale so it fills the screen instead of leaving void below (owner-reported); **touch scroll/drag** fixed — cards had `touch-action: none`, so the browser ignored every pan starting on a card.
2. **Focus surfaces** — **pinnable floating card windows** (`pinnedCardsStore`, no backdrop so the board stays live, fold-to-dock, side by side) and **column Zen mode** (FLIP flight out of the board, blurred backdrop, finger-friendly scroller, reorder routed through the board's own `dropIndex.ts`).
3. **Virtual team members** — realm-scoped accountless people, assignable and filterable, on new tables `virtual_members` + `task_virtual_assignees` (migration **0032**, applied by script; journal stays frozen), with REST routes + mirrored MCP tools and a parity test. Assignment itself became optimistic (`assigneeMutations.ts` with a per-pill FIFO lane) and the assignable list is now prefetched and cached.
4. **Sidebar favorites** + **trophy room rebuild** (gold identity, inline-SVG charts, sortable table, priority-aware aggregation; `TrophyStats.tsx` deleted).
5. **Correctness pass** — five reviewers (butcher/warden/judge/stalker + cross-model Codex) over a branch that was already green on 2828 tests, typecheck, lint and a live deploy. They found **two separate data-loss paths** (a pinned window flushing its mount-time snapshot; unpin reseeding the modal from a stale render closure), a whole-map assignee rollback clobbering concurrent work, a checklist rollback that could delete a row still in Postgres, a trophy crash on custom priority ids, and a REST surface that never ran. All fixed; suite now **3040 tests**.
6. **`api/v1/realms/**` was dead** — Next 16 hands route handlers a `params` **Promise** and these read it synchronously, so ids were `undefined` and every call answered 403. Five of the seven routes date from 2026-04-02 and had never worked; the new virtual-member routes inherited the pattern by copying them. All seven now `await`. **Any new v1 route must use `params: Promise<{…}>` + `await`.**
7. **CI gained a production-build gate** — lint, typecheck and the full suite all passed a malformed Tailwind `color-mix()` shadow that broke the deploy; only `next build` catches that class.

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
