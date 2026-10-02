# Architecture — Feature Inventory · Known Gaps & Tech Debt

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

## Feature Inventory

Per-domain inventories live in the subsystem docs (this avoids drift):
- **PM surface** (board, gantt, canvas, vault, velocity, realms, notes, theming) → [pm-app.md](pm-app.md) "Feature Inventory (PM surface)".
- **Kairos brain** (substrate, capture, synthesis, chat, asks, dialogue, lieutenants) → [kairos/overview.md](kairos/overview.md) + siblings.
- **Platform** (REST, MCP, OAuth, mobile auth, AI engine, crons) → [platform.md](platform.md).
- **Mobile app** → [mobile.md](mobile.md).
- **AI Hangar + Aeon OS harness** (missions, runner, review gate, receipts) → [hangar.md](hangar.md).

Top-line status: the PM app is feature-complete + hardened; Kairos is a multi-layer brain
(substrate → synthesis → Aether self-model → chat/ask/dialogue), now
with a nightly **memory engine** (undoable `memory_ops`), a **thinking queue** answered by two Claude Max
routines defined in code (*Kairos brain*, *Kairos chat*) with a paid-key fallback the owner can switch off (0.19),
**two-mind beliefs**, an operator-governed **constitution** + drift
probes, the guaranteed 06:00 London **daily message** with numbered open questions (0.18), write-time **origin** labels + nightly **belief re-check** + a **conscience** block in chat and daily-message prompts (0.14), a nightly **idea tournament** feeding idea cards to the inbox (0.15), **watched boards** and **voice notes** (0.18) and one **Set up Kairos** checklist (0.19) — running a **12-cron** Vercel fleet (mostly fallbacks) plus the two cloud routines; models come from one shared registry (`packages/shared/src/ai/model-registry.json`) and a weekly freshness check flags drift ([../docs/aeon-living-world.md](../docs/aeon-living-world.md)); the mobile
app is at the login slice (Google auth scaffolded, awaiting operator client IDs).

## Known Gaps & Technical Debt

**Status 2026-10-02 (Kairos 0.19 / app v0.36.0):** Kairos rows below were re-checked against
0.17–0.19. Items fixed or made moot are marked *Resolved* with the version; the rest stay open. 0.17
retired the morning briefs, raw introspection, contradiction notices, micro-consolidation and the weekly
dedup cron (all retired in 0.17), so gaps that only concerned them are closed.

Hangar inventory refreshed: 2026-09-21. The completion claim guard shipped in PR #129; durable artifact/publication delivery, draft PRs and runner recovery remain open. Mission-card/result UI and repository management are implemented for the v0.29.0 release candidate (PR #130). See [hangar.md](hangar.md) §6. The previously recorded REST UUID/membership gaps remain outside this wave; this refresh is not a new general safety audit. Other inventory entries below retain their original verification dates.

### New gaps (2026-10-01, Kairos 0.14–0.15)

| Severity | Issue | Details |
|---|---|---|
| Resolved 0.16 | ~~Direct paid-key crons bypass the thinking queue~~ (PR #141: all are thinking kinds; crons are fallbacks) | the eight paid-key crons became thinking kinds; five of them were then retired in 0.17 and the rest are fallbacks only |
| Medium | Bearer claim/submit trust | any user-scoped bearer can claim and submit that user's thinking jobs; output is persisted after id grounding only |
| Medium | `update_memory` can archive the constitution | `archivedAt` is not barred for `type='constitution'` rows while amendments are operator-only |
| Low | Idea archive skipped when the judge never succeeds | candidates stay only in the generate job output if both routine and paid judge fail |
| Low | Belief-ledger ops write `before: null` | create/mirror ops cannot be reverted to a prior state |
| Resolved 0.17 | ~~Legacy dedup writes no `memory_ops`~~ | the weekly dedup cron was retired in 0.17; the engine's Merge step folds duplicates with undo records |
| Low | Duplicate paid calls | `constitution/seed.ts`, `thinking/handlers/concept.ts` own paid calls instead of `paid-fallback.ts` (both still honour the paid backup switch via `getModelForUser`) |
| Low | Origin of older rows is inferred | rows before 0.14 carry no `sourceMetadata.origin` |
| Low (changed 0.19) | Chat routine flag is an owner step | one flag `KAIROS_CHAT_ROUTINE` (alias `KAIROS_TELEGRAM_ROUTINE`) + `ROUTINE_CHAT_ID`/`ROUTINE_CHAT_TOKEN` now serve web and Telegram; until the owner sets them, chat answers on the paid key (or not at all with paid backup off) |
| Low | One TODO | `lib/kairos/chat-turn-reply.ts` DB access outside `lib/data` |

### New gaps (2026-10-01, Kairos 0.11–0.13)

| Severity | Issue | Details |
|---|---|---|
| Resolved 0.17 / 0.19 | ~~Thinking routines not yet created~~ | the routines are now defined in code (`lib/kairos/routines/catalog.ts`, two of them) and the 0.19 *Set up Kairos* checklist walks the owner through creating them, ticking live once the brain routine claims; Health shows "on Max / on backup / missed" per job |
| Resolved 0.19 (superseded) | ~~Telegram chat routine flag off~~ | replaced by the single `KAIROS_CHAT_ROUTINE` flag for web + Telegram — see the 0.14–0.15 table above |
| Resolved 0.17 | ~~`drift_probe` deadline vs morning routine~~ | the brain routine runs hourly 01:40–06:40Z and claims everything due, so the probe is picked up inside its 2h window |
| Low | Layering: `lib/kairos` reaches into `db` | `chat-turn-reply.ts` / `chat-turn-assistant.ts` import `db` directly instead of going through `lib/data` (TODO) |
| Low | Old proposal backlog draining | BackUp processes ≤400 pending proposals/night with a 21-day TTL, so the historic backlog takes several nights to clear |

### Standing inventory

| Severity | Issue | Status / Details |
|---|---|---|
| Low | Avatar pile missing from task cards | **RESOLVED** (`95537d0`) — pile via `AssigneeDot` (`SortableTaskCard.tsx:337,494`); live from overlay |
| Medium | Assignee list excluded owner + realm members | **RESOLVED** (`22b281a`) — `findAssignableMembers` (`members.ts:27`) unions owner + members + realm |
| — | Keep-warm cron pinning Neon 24/7 | **REMOVED** (`5c759e1`) — cold-start now absorbed by the durable mutation queue + retry ladder + Neon sub-second resume |
| Medium | Dominion REST API missing | OPEN — 15 MCP tools, no `/api/v1/dominions/` |
| Medium | `broadcastMemoryEvent` is a no-op stub | OPEN — memory mutations don't push via Pusher |
| Medium | Orphan running sessions on worker restart | OPEN — heartbeat exists (`/sessions/[id]/heartbeat`, 30s) but no reconcile cron marks a silent runner's sessions dead |
| Medium | Engine router has no CRUD surface | OPEN — `enginePolicies` editable via no MCP/REST |
| Medium | Cost budget tripwires absent | OPEN — `costUsd` recorded; no cap / rollup / kill switch |
| Medium | Sessions parity test missing | **CLOSED** (2026-10-01) — `app/api/__tests__/sessions-parity.test.ts` locks REST↔MCP sessions |
| Medium | Archetype + cortex cron concurrency (TOCTOU) | OPEN — advisory-lock fix queued; both crons are fallbacks since 0.16, so the race needs a late routine plus the cron |
| Medium | `memories.ts` past 500-line standard | LIKELY OPEN — split into core/capture/graph/context pending |
| Medium | Chat assistant Markdown rendered as text | OPEN |
| Medium | Cross-user cron snapshot leak | OPEN — see `docs/kairos/14-quality-gates.md` §3 |
| Medium | Orphan-retry multi-tab race (chat) | OPEN |
| Medium | Memory-prompt injection defence missing | OPEN |
| Medium | Chat history full-thread refetch per turn | OPEN |
| Medium | Neon driver `FOR UPDATE` behaviour unverified | OPEN — `appendChatMessage` row-lock may be a no-op on Neon HTTP driver |
| Low | MCP lacks canvas tools | OPEN (intentional) |
| Low | Gantt mutations don't fire Pusher / `touchProject` | OPEN |
| Low | Activity feed has no UI | OPEN — table populated, no feed page |
| Low | Desktop app scaffold only | OPEN / Parked |
| Low | Test coverage thin / no E2E | PARTIALLY IMPROVED (~1777 → ~1902); still no E2E |
| Low | Sessions/OAuth parity & smoke tests | OPEN |
| Low | Inbound channel adapters absent | OPEN |
| Low | Memory titles backfill not automated | OPEN — hook + Acolyte cover it; no server cron sweep |
| Low | Cron `isAuthorized` copied N times | OPEN — 12 cron routes as of 2026-10-02 (down from 17); hoist to `lib/cron/auth.ts` |
| Low | Kairos pure helpers untested | OPEN |
| Low | Chat Visor lacks focus trap | OPEN |
| Low | `chat_with_kairos` MCP tool absent | OPEN |
| Low | Visor send-race against thread switch | OPEN |
| Low | `MIN_QUERY_CHARS` retrieval cutoff untested | OPEN |

### New gaps (2026-08-26, night-swarm wave — verified against the diff)

| Severity | Issue | Details |
|---|---|---|
| Medium | `TrophyRoom.tsx` at the size cap | 434 → **497** lines in the trophy rebuild; the orchestrator itself has no test (its children `TrophyInsights`/`TrophyTable` do) |
| Medium | `SortableTaskCard.tsx` further past the cap | 506 → **517**. Already over on main, but this wave added to it rather than leaving it alone — next file to split |
| Low | Board overlay/Zen wiring untested | `useBoardOverlays.ts`, `useBoardSensors.ts`, `BoardOverlays.tsx`, `AssignCheck.tsx`, `TaskEditContent.tsx`, `TaskAssigneeVirtualSection.tsx`, `zenModeStore.ts`, `TrophyHero.tsx`, `trophy-theme.ts` shipped with no test file — the sibling modules in the same features *are* covered, so these are the honest gap |
| Low | Pinned card windows don't survive a reload | `pinnedCardsStore.ts` is explicitly in-memory ("nothing here persists or syncs"). A user who arranges several pinned cards and refreshes loses the layout — plausibly not what they expect. Same for Zen focus state |
| Low | Virtual members scoped to a project's *first* realm | `findRealmIdsForProject` takes the oldest realm membership; a project spanning several realms only gets members from one. Documented simplification, same class as existing single-project scoping debt |
| Low | Trophy stats computed over a 200-row window | Charts/streaks reflect the most recent 200 vaulted tasks while totals come from server aggregates — a SQL month-bucket query is the cheap fix if a vault outgrows it |

### Closed by the 2026-08-26 wave

| Was | Now |
|---|---|
| `TaskBoard.tsx` over the 500-line standard | **556 → 455** — overlay/card-editor cluster extracted to `useBoardOverlays.ts` + `BoardOverlays.tsx` |
| `TaskAssigneeOverlay.tsx` growing into eight components | **637 → 263** — virtual section, `MemberAvatar`, `AssignCheck` extracted |
| `api/v1/realms/**` returning 403 unconditionally (undetected since 2026-04-02) | All 7 param-reading route files now `await` their params Promise (`daeb93d`) |
| No production-build gate in CI | `npm run build` added to the Quality Gate — lint + typecheck + 2828 tests had all passed a CSS bug that broke the deploy |
| Test count | now **3,040** (from 2,695); still no E2E |
| TODO/FIXME/HACK debt | **zero** across `apps/web/src` (verified by two independent searches) |

### Closed since 2026-06-28 (verified 2026-07-17)

| Was | Closed by |
|---|---|
| Proposal inbox had no UI (search-only) | **Will inbox** bell/panel — brief/ask/notify/proposal kinds (PR #82) |
| No outbound push channel (Kairos couldn't reach the operator) | **Telegram** — speak fan-out + tap-to-triage + whole-brain chat (PRs #85/#87), speak throttle (PR #88) |
| Chat→brain one-way (free chat never became memories) | **chat-distill** nightly cron (PR #89) |
| Per-call AI output caps silently ignored | `maxTokens`→`maxOutputTokens` fix (`1512228`) + wire-level regression test |
| MCP tools unannotated (~50K always-on context) | All 109 tools annotated (PR #83) |
| Test count | now **2,144** (from ~1,902); still no E2E |

### Open gaps (2026-07-17)

| Severity | Issue | Details |
|---|---|---|
| Resolved 0.17 | ~~Brain-tick delivery not wired~~ | the brain-tick routine is retired; the 06:00 daily message is the one guaranteed push |
| Resolved 0.18 (superseded) | ~~Board digest unbuilt~~ | board feed (0.11) + watched boards and same-day `board_card_done` rows (0.18) feed cortex and the daily message's board-day section, instead of a separate /speak digest |
| Resolved 0.17 | ~~Introspection parse_failed streak~~ | raw introspection (and its cron) was retired in 0.17; the idea tournament replaced it |
| Low | Chat-distill error branches undertested | Stalker findings 2026-07-17: resolveDate/parse-failure/cron-catch branches dark (fix queued) |
| Low | Stale remote branches | ~40 old `feature/*` + post-merge `feat/*` refs on origin; `git remote prune origin` + a cleanup pass |
| Medium | Chat-distill trust model (Codex cross-model finding, 2026-07-17) | Distilled chat auto-persists as operator-grade reflections (0.9 confidence) with no review step; alternative = stage as `inbound` proposals through the Will inbox (propose-not-commit pattern). **Operator decision pending** |
| Low | externalId dedup lacks a DB constraint | select-then-insert only; hand-write migration 0027: partial unique index on (user, source, `sourceMetadata->>'externalId'`) + conflict-safe insert |
| Low | Chat-distill edges (Codex) | 80-msg/day cap silently drops the earliest turns of very long days; eligibility starts from Dominions (a credentialed user with only chat threads is skipped) |

### New gaps (2026-06-28)

| Severity | Issue | Details |
|---|---|---|
| Medium | Mutation-queue side-effect closures lost on reload | `rollback`/`onSuccess` live in an in-memory Map keyed by mutation id (`mutationQueue.ts:27`); after reload a pending record replays without its rollback. Correctness relies on idempotent replay + next version-check; no test of reload-then-hard-reject, and a post-reload hard reject silently drops with no user-facing toast |
| Low | Avatar pile / assignee list not realtime across sessions | `assigneesByTask` updates live only for the acting client; no Pusher broadcast (same class as `broadcastMemoryEvent`) |
| Low | `isTransientError` regex is broad | `persistMutation.ts:9` matches substrings (`connection`/`timeout`/`socket`); a hard error containing those words would be retried not rolled back |
| Low | Durable queue has no size cap / TTL | `aeon-mutation-queue` grows unbounded while offline; no eviction / max-age |
| Low | `smoothUiRenders` not in shared `DEFAULT_PREFERENCES` | default hard-coded in `themeStore.ts`; absent from `packages/shared/src/config/defaults.ts` (drift risk) |
| Low | Cron concurrency surface grew without auth/idempotency refactor | `vercel.json` then scheduled 9 crons (17 at the 0.16 peak, 12 as of 2026-10-02); shared-auth-helper + idempotency-lock debt scales with each |
| Medium | Mobile chat engine not REST-reachable | Chat is a server action; the planned mobile chat needs a REST + streaming exposure (see [kairos/chat.md](kairos/chat.md) PLANNED) |
