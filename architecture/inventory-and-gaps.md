# Architecture — Feature Inventory · Known Gaps & Tech Debt

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

## Feature Inventory

Per-domain inventories live in the subsystem docs (this avoids drift):
- **PM surface** (board, gantt, canvas, vault, velocity, realms, notes, theming) → [pm-app.md](pm-app.md) "Feature Inventory (PM surface)".
- **Kairos brain** (substrate, capture, synthesis, chat, asks, dialogue, lieutenants) → [kairos/overview.md](kairos/overview.md) + siblings.
- **Platform** (REST, MCP, OAuth, mobile auth, AI engine, crons) → [platform.md](platform.md).
- **Mobile app** → [mobile.md](mobile.md).

Top-line status: the PM app is feature-complete + hardened; Kairos is a multi-layer brain
(substrate → synthesis → Aether → chat/ask/dialogue) running a 9-cron nightly pipeline; the mobile
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
