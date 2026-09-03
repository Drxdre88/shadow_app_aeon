# Architecture — Feature Inventory · Known Gaps & Tech Debt

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

## Feature Inventory

Per-domain inventories live in the subsystem docs (this avoids drift):
- **PM surface** (board, gantt, canvas, vault, velocity, realms, notes, theming) → [pm-app.md](pm-app.md) "Feature Inventory (PM surface)".
- **Kairos brain** (substrate, capture, synthesis, chat, asks, dialogue, lieutenants) → [kairos/overview.md](kairos/overview.md) + siblings.
- **Platform** (REST, MCP, OAuth, mobile auth, AI engine, crons) → [platform.md](platform.md).
- **Mobile app** → [mobile.md](mobile.md).

Top-line status: the PM app is feature-complete + hardened; Kairos is a multi-layer brain
(substrate → synthesis → Aether self-model → chat/ask/dialogue → **speaks-first autonomy**)
running an **11-cron** nightly pipeline plus a 3×/day cloud-routine brain-tick; the mobile
app is at the login slice (Google auth scaffolded, awaiting operator client IDs).

## Known Gaps & Technical Debt

Last verified: 2026-06-28 (git HEAD `056d8f2`).

| Severity | Issue | Status / Details |
|---|---|---|
| Low | Avatar pile missing from task cards | **RESOLVED** (`95537d0`) — pile via `AssigneeDot` (`SortableTaskCard.tsx:337,494`); live from overlay |
| Medium | Assignee list excluded owner + realm members | **RESOLVED** (`22b281a`) — `findAssignableMembers` (`members.ts:27`) unions owner + members + realm |
| — | Keep-warm cron pinning Neon 24/7 | **REMOVED** (`5c759e1`) — cold-start now absorbed by the durable mutation queue + retry ladder + Neon sub-second resume |
| Medium | Dominion REST API missing | OPEN — 16 MCP tools, no `/api/v1/dominions/` |
| Medium | `broadcastMemoryEvent` is a no-op stub | OPEN — memory mutations don't push via Pusher |
| Medium | Orphan running sessions on worker restart | OPEN — no heartbeat / reconcile cron |
| Medium | Engine router has no CRUD surface | OPEN — `enginePolicies` editable via no MCP/REST |
| Medium | Cost budget tripwires absent | OPEN — `costUsd` recorded; no cap / rollup / kill switch |
| Medium | Sessions parity test missing | OPEN — REST + MCP shapes match, no lock |
| Medium | Archetype + cortex cron concurrency (TOCTOU) | OPEN — advisory-lock fix queued; cron roster has grown (larger surface) |
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
| Low | Cron `isAuthorized` copied N times | OPEN — likely worse (cron roster grew); hoist to `lib/cron/auth.ts` |
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
| Medium | Brain-tick delivery not wired | Cloud routine live (3×/day) but `AEON_APP_URL`+`CRON_SECRET` env vars + network allowlist pending in the claude.ai cloud environment — ticks dry-run until set |
| Medium | Board digest unbuilt | Autonomy slice 3: curated Mission Control deltas → Telegram via /speak; zero code yet |
| Medium | Introspection cron `parse_failed` streak | Briefings report failures Jul 11–15 — brain consolidating without introspection proposals; needs log pull |
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
| Low | Cron concurrency surface grew without auth/idempotency refactor | `vercel.json` now schedules 9 crons; shared-auth-helper + idempotency-lock debt scales with each |
| Medium | Mobile chat engine not REST-reachable | Chat is a server action; the planned mobile chat needs a REST + streaming exposure (see [kairos/chat.md](kairos/chat.md) PLANNED) |
