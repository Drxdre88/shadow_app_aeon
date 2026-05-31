
# Kairos Companion — Session Handover

**Last updated:** 25/05/2026 (session 3 close — spawn primitive)
**Active branch:** `feature/kairos-companion`
**Working state:** clean, typecheck + full test suite (1576/1576) green
**Purpose:** Pick up scoping or implementation without re-reading the originating conversations.

---

## What this is in one paragraph

Kairos is a **persistent, opinionated companion** to an operator who commands a vast field of work across multiple realms / projects / repos. It sits *above* the agent market (Claude Code, Codex, company AI, future engines) and holds the union of work in attention so the operator can stay where they're irreplaceable. The companion is **event-driven, not a 24/7 loop** — inference fires on triggers (voice, cron, webhook, session events). It dispatches across whichever AI subscription/API is currently cheapest via an **Engine Router seam**. The visual orb-graph + voice loop is its **cognition surface and competitive moat**, not chrome. Aeon (the host app) is the substrate; Kairos lives inside it.

---

## Five non-negotiables for the companion

1. **One entity** — many engines, one voice
2. **Ambient, not invoked** — pulsing pill, always-on phone, never closed
3. **Defends your time** — discretion is first-class; interrupts only when it must
4. **Models you** — preferences, patterns, fatigue, loyalties accumulate
5. **Takes initiative** — opinionated, can interject

Lose any of these and it becomes a different product.

---

## What's shipped on this branch (cumulative)

### Foundations (merged in)
- **BYOK** (`e7d9fa3`) — Vercel AI SDK v6 provider-agnostic router, AES-256-GCM encrypted per-user keys, admin-gated `/settings/ai` UI, REST endpoints for credential CRUD + test, `requireAiAccess()` helper.
- **Notes/Briefing UI** (`7b2f11d`) — `/notes` bento grid, `DailyBriefingCard`, `EodReflectionCard`, `CaptureFab`, `QuickCaptureOverlay` polish.

### Phase 1 (`8298e18`)
- **A1** — memory.type taxonomy expanded (snapshot, inbound, advisory, achievement, session_event, fact, contact, external_event). Sources extended (cron, system, webhook). Pure validator change.
- **A2** — `POST /api/v1/memories/capture` generic ingestion endpoint with channel normalisation and externalId-based idempotency. `captureMemory()` data fn.
- **C11** — Dominion body schema (migration `0017_dominion_body.sql`): `dominions.vision`, `dominions.mission_long`, `dominions.archived_at`, plus `dominion_objectives` table.
- **C12** — `inspectDominion()` data fn + MCP tools (`inspect_dominion`, `set_dominion_vision`, `list_objectives`, `create_objective`, `update_objective`, `archive_objective`). `create_dominion` + `update_dominion` extended with body fields.
- **B6** — `lib/ai/provider.ts`: `AIProvider` ABC + `VercelAIProvider` wrapping the BYOK lane. Factories `getProviderForUser(tier)`, `getProviderWithKey(provider,model,key)`.
- **B10** — `lib/ai/route-task.ts`: `routeTask({taskType,sensitivity,urgency,...})` resolves user policy → global policy → `DEFAULT_POLICIES` constants. Migration `0018_engine_policies.sql`.
- **E20** — `lib/kairos/briefer.ts` + `/api/cron/briefer` route + `vercel.json` cron (`0 7 * * *`). Per active Dominion → inspect → routeTask(brief) → heavy BYOK → `memory.type='advisory'` (idempotent on date × dominionId).

### Phase 1.5 (`94a2ea1`)
- **Migrations applied to dev DB** via `db:push` (0017 + 0018 are live).
- **DailyBriefingCard rewire** — reads today's advisories (one section per Dominion). Falls back to legacy `prepare_context` bundle if no advisories exist yet. `listTodaysAdvisories` + `getTodaysBriefings` action.
- **C13 — Dominion edit drawer** — `components/kairos/DominionEditDrawer.tsx`. Slide-in panel with vision + mission textareas (save on blur) + objectives list (inline rename, status cycle, archive). Server actions: `inspectDominionAction`, `listObjectivesAction`, `createObjectiveAction`, `updateObjectiveAction`, `archiveObjectiveAction`, `deleteObjectiveAction`. Wired into `KairosLegend` — clicking a Dominion pill in legend mode opens the drawer.

### Phase 2 (`e13d766`)
- **A3 — Board auto-capture** — `lib/kairos/auto-capture.ts:captureBoardEvent`. Wired into `createBoardTask`, `updateBoardTask` (status/move/update branches), `deleteBoardTask`, `reorderBoardTasks` (move + done). `achievement` memory on completion, `snapshot` otherwise.
- **A4 — Project lifecycle auto-capture** — `captureProjectEvent` wired into `createProject` + `updateProject`.
- **A5 — Nightly project snapshot** — `lib/kairos/project-snapshot.ts` + `/api/cron/project-snapshot` route + `vercel.json` cron (`0 23 * * *`). Idempotent on (date × projectId). Skips dormant projects (no activity + no open + no done-today).
- Test mocks updated for the new `@/lib/kairos/auto-capture` import (board.test.ts + projects.test.ts).

### Phase 2.5 (`e6ac0ec`)
- **E22 — Advisory feed in sidebar** — `components/kairos/AdvisoryFeed.tsx`. Sparkle icon in `AppSidebar` BottomSection with unread badge. Popover lists last 3 days of advisories with Dominion pill + relative time + State-section preview. Acknowledge soft-archives. Open deep-links to `/kairos?focus=`. Unread tracked client-side via `localStorage`. `listRecentAdvisories` + `archiveMemory` data fns; `getRecentAdvisories` + `archiveMemoryById` actions.

### Phase 3 — spawn primitive (this session, D14–D18)
- **D15 — schema** — migration `0019_agent_sessions.sql`. Two tables: `agent_sessions` (user/realm/project/dominion-anchored, engine='claude'|'codex', goal, prompt, worker_host, worker_pid, status, exit_code, spawned_at/started_at/ended_at, cost_usd, memory_id, metadata) and `session_events` (session_id, monotonic seq UNIQUE, kind='status'|'tool_use'|'tool_result'|'message'|'stop'|'error', tool_name, payload). Indexes: user_status, dominion, live (partial), session_seq UNIQUE, created (for archival cron).
- **D15 — data layer** — `lib/data/sessions.ts`. `createAgentSession`, `findAgentSessionById`, `listAgentSessions` (with status/dominion/project/liveOnly filters), `updateAgentSessionStatus`, `attachSessionMemory`, `recordSessionEvent` (onConflictDoNothing on seq), `listSessionEvents` (afterSeq tail), `getNextEventSeq`. Validators: `spawnSessionSchema`, `updateSessionStatusSchema`, `recordSessionEventSchema`, `listSessionsSchema`.
- **D16 — server actions** — `lib/actions/sessions.ts`. `spawnSessionAction` creates row → calls `dispatchSpawn` → flips to running on success or records dispatch-failed event. `getSession`, `listSessions`, `updateSessionStatus`, `recordSessionEvent`, `getNextEventSeq`, `listSessionEvents`, `killSession`.
- **D16 — REST surface** — `/api/v1/sessions/` route (GET list, POST spawn), `/api/v1/sessions/[id]` (GET, PATCH), `/api/v1/sessions/[id]/events` (GET, POST — seq auto-assigned if omitted), `/api/v1/sessions/[id]/kill` (POST). Bearer auth via existing `authenticateRequest`. Worker host PATCHes status; hooks POST events.
- **D16 — MCP tools** — `tools/sessions.ts` with `spawn_session`, `list_sessions`, `get_session`, `kill_session`, `list_session_events`. Registered in `[transport]/route.ts`.
- **D14 — worker host** — `apps/kairos-worker/` lean Node service (no framework). `POST /spawn` shells `claude -p <prompt>` (or `codex exec`) with `KAIROS_SESSION_ID`/`KAIROS_CALLBACK_URL`/`KAIROS_CALLBACK_TOKEN` injected, captures pid, pipes stdout/stderr into POST `/events`, PATCHes status to running/succeeded/failed/killed on exit. `POST /kill/:id` SIGTERMs. `GET /health` returns live registry. Bearer auth via `KAIROS_WORKER_SECRET`. `lib/kairos/spawn.ts` is the Aeon-side dispatcher; when `KAIROS_WORKER_URL` is unset the row is created but undispatched (UI/dev unblocked).
- **D17 — Claude Code hook** — `apps/web/scripts/kairos-session-hook.mjs`. PostToolUse + Stop + (optional) PreToolUse/UserPromptSubmit/SubagentStop. Reads `KAIROS_SESSION_ID` etc from env (no-op if absent — safe to install globally). Reads JSON payload from stdin, maps hook name → event kind, POSTs to `/api/v1/sessions/{id}/events`. 5s timeout, always exits 0. Install doc: `apps/web/scripts/kairos-hook-install.md`.
- **D18 — UI** — `components/kairos/LiveSessionsButton.tsx`. Bot icon in sidebar BottomSection (next to AdvisoryFeed). Pulsing badge with live count, polls every 4s. Popover lists live sessions with engine pill, status dot, goal preview, kill button. Click a row → slide-in `SessionTranscriptDrawer` (right-side, 480px) with header (engine·status·goal + kill·close) + scrollable mono transcript polling events every 2s with colour-coded kinds (error rose, stop emerald, tool_use sky, message white).
- **Note:** 3D comet-trail rendering inside `Kairos3D` was scoped out for v1 — popover + drawer deliver the operator surface (see + tail + kill). Promoting sessions to first-class graph nodes can come in a follow-up if the orb metaphor matters.

---

## How to make the cron actually fire in production

Two things still needed in Vercel before the schedule runs:
1. Set env var `CRON_SECRET` to a random string in the Vercel dashboard (production + preview).
2. Deploy. Vercel Cron picks up the entries in `vercel.json` automatically.

The cron endpoints (`/api/cron/briefer` and `/api/cron/project-snapshot`) accept the request without auth when `NODE_ENV !== 'production'` so they're callable via curl in dev.

## How to run the spawn primitive locally

Two side-by-side processes — Aeon web on :3000, kairos-worker on :8787.

1. `npm run db:push --workspace=apps/web` — apply `0019_agent_sessions.sql` to dev DB (interactive, confirm create tables).
2. Aeon `.env.local` additions:
   ```
   KAIROS_WORKER_URL=http://localhost:8787
   KAIROS_WORKER_SECRET=<random>
   AEON_API_KEY=<existing master key>
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```
3. Worker terminal:
   ```bash
   KAIROS_WORKER_SECRET=<same> npm run start --workspace=apps/kairos-worker
   ```
4. Install `apps/web/scripts/kairos-session-hook.mjs` in `~/.claude/settings.json` (see hook-install.md).
5. Spawn a session via the MCP tool `spawn_session` or POST `/api/v1/sessions`. The Bot icon in the sidebar pulses; clicking opens the transcript drawer.

---

## Locked architectural decisions (unchanged from session 1)

| Decision | Detail |
|---|---|
| **Companion = persistent but event-driven** | Not a 24/7 loop. Triggers (voice, cron, webhook, session event) call Engine Router → one inference → action. Idle = zero spend. |
| **Engine Router is the seam** | Per-task choice of engine based on task type, sensitivity, urgency, current quota/cost. Engines are a market. Kairos persists; engines swap. |
| **No engine is structurally load-bearing** | Removing any engine (incl. company AI) only changes the bill, not the companion's behaviour. |
| **Dominion ⊥ Realm** | Dominion = ontological axis (what part of life). Realm = social axis (who can see). |
| **Memory layer is the substrate, not a feature** | Everything Kairos hears/says lives in `memories`. |
| **UI is the cognition surface, not chrome** | Orb-graph + voice loop + direct manipulation editing are co-equal with backend. |

---

## What Kairos can see today

| Source | Status |
|---|---|
| Manual notes (/notes, QuickCapture) | ✅ |
| Claude Code sessions | ✅ |
| EOD reflections | ✅ |
| Board task create/update/move/delete/complete | ✅ (A3) |
| Project create/update | ✅ (A4) |
| Nightly per-project snapshot | ✅ (A5 — 23:00 cron) |
| Morning Briefer advisories | ✅ (E20 — 7am cron) |
| **Spawned session events (Kairos-dispatched)** | **✅ (D14–D18 — worker + hook + UI)** |
| Inbound channels (Slack, Teams, GitHub webhook) | ✖ (deferred; A2 endpoint exists, adapters not built) |
| Voice | ✖ (deferred) |

---

## What's left from the original 25, ranked by leverage

| Group | Items | Estimate | Notes |
|---|---|---|---|
| **Spawn primitive** | D14–D18 | done | Worker, schema, action, hook, UI shipped this session. 3D orb rendering inside Kairos3D deferred. |
| **Extra providers** | B7 (OpenRouter), B8 (Gemini), B9 (STAF) | ~½ day each | Makes the router actually route. Worth doing once you have real spend signal. |
| **Codex integration** | F23–F25 | ~1.5 days | F23 + F24 independent of D14; F25 (worker engine path) is most of the way there — spawner already branches on `engine='codex'` with `codex exec <prompt>`; just needs the Codex CLI installed + Engine Router policy. |
| **Cost budget enforcement** | E21 | ~½ day | Real value only when cron is live and BYOK is being billed. |
| **Cron infra polish** | E19 | done | Both crons already in `vercel.json`. CRON_SECRET pattern in place. |

### Critical-path-5 progress
All seven critical-path items shipped. The minimum-viable persistent companion is live on branch — captures broadly, has standing Dominion context, briefs each morning, ambient feed surfaces output.

---

## Recommended next move

**Close the loop: Dispatch button on advisory rows.** The spawn primitive is in place but it isn't wired into the briefer→action loop yet. The user-facing payoff is one button: on each advisory, "Dispatch" calls `spawnSessionAction` with the advisory's body as the goal and a default prompt pulled from the Dominion's mission_long. The advisory row becomes the briefing → click → session → memory loop in one gesture.

If a smaller next step is wanted, **B8 (Gemini direct provider)** is the cheapest concrete unlock: drops `routeTask({taskType:'classify'})` onto Gemini Flash-Lite free tier instead of paying for Sonnet, immediately useful for any classification work the briefer eventually does internally.

If the visual leap matters more than functional, **promote sessions to first-class graph nodes** in `Kairos3D` — `role:'session'` with pulse + comet trail anchored on the session's Dominion. The data is there (`listSessionsAction({ liveOnly: true })`); only rendering remains.

---

## Open scoping questions (carried over from session 1)

- [ ] **Plans as a separate concept vs Dominion objectives + sessions** — wait until spawn is live to re-judge.
- [ ] **Voice loop UX shape** — push-to-talk vs always-listening; brand voice (ElevenLabs/Cartesia) vs browser-native TTS.
- [ ] **Channel adapter priority order** — Teams in first? GitHub webhook first? Slack first? A2 endpoint is ready to receive them.
- [ ] **Model-of-you privacy posture** — single-user locked; team mode shape open.
- [ ] **Trophy rollup granularity** — theme vs temporal vs milestone.
- [ ] **In-graph edit UX** — drag-Dominion-onto-memory locked; other gestures open.
- [ ] **Mobile presence design** — live activity vs persistent notification vs full-screen pill.
- [ ] **A2A protocol adoption** — only when 3+ specialised operators run concurrently.
- [ ] **Worker host topology** — for D14: dev box vs cheap VPS vs Vercel Cron + ephemeral function. **Cron + ephemeral is probably right for v1; decide before starting D14.**

---

## Anti-patterns / things NOT to do

- **Don't build a "24/7 master brain" loop.** Event-driven. Idle = zero cost.
- **Don't hardwire company AI (STAF) as a structural layer.** Router policy preference, not architecture.
- **Don't defer UI as "last."** Voice loop + orb-graph + direct manipulation editing are the moat.
- **Don't manufacture framework scale.** Tight prose with strong opinions over flow-charted decks.
- **Don't produce trailing summary recaps before the Executive Summary** — CLAUDE.md is explicit, 15-line ceiling.
- **Don't write CHANGELOG / VISION / ARCHITECTURE updates unless asked** — separate agents maintain those.
- **Don't add Co-Authored-By to commits.**

---

## Cold-start checklist for the next session

1. Read this file.
2. `git checkout feature/kairos-companion` and `git pull` if needed.
3. `git log --oneline -10` to confirm last commit matches `e6ac0ec`.
4. `npm run typecheck --workspace=apps/web` to sanity-check.
5. Read `02-buildable-25.md` for the work surface — items shipped have been listed above; remaining items are mostly Group D + leftover B/E/F.
6. Honour the anti-patterns list — short prose, no theatre, recommendation-first.

---

## Quick reference — file map of what landed (Phase 3 additions in bold)

Backend / data layer
- `apps/web/drizzle/0017_dominion_body.sql` — Dominion body + objectives
- `apps/web/drizzle/0018_engine_policies.sql` — Engine policy table
- `apps/web/src/lib/db/schema.ts` — `dominionObjectives`, `enginePolicies` added; `dominions` extended
- `apps/web/src/lib/data/validators.ts` — memory type/source taxonomy expanded, capture/objective validators
- `apps/web/src/lib/data/memories.ts` — `captureMemory`, `listTodaysAdvisories`, `listRecentAdvisories`, `archiveMemory`
- `apps/web/src/lib/data/dominions.ts` — body fields, `inspectDominion`, objectives CRUD

AI / engine
- `apps/web/src/lib/ai/provider.ts` — `AIProvider` ABC + `VercelAIProvider`
- `apps/web/src/lib/ai/route-task.ts` — `routeTask`, `getProviderForTask`, `DEFAULT_POLICIES`

Kairos cron + auto-capture
- `apps/web/src/lib/kairos/briefer.ts` — Briefer
- `apps/web/src/lib/kairos/auto-capture.ts` — board + project event captures
- `apps/web/src/lib/kairos/project-snapshot.ts` — nightly snapshot

REST + MCP
- `apps/web/src/app/api/v1/memories/capture/route.ts` — A2 capture endpoint
- `apps/web/src/app/api/cron/briefer/route.ts` — E20 briefer cron
- `apps/web/src/app/api/cron/project-snapshot/route.ts` — A5 snapshot cron
- `apps/web/src/app/api/[transport]/tools/dominions.ts` — inspect + objectives MCP tools
- `apps/web/src/app/api/[transport]/tools/memories.ts` — taxonomy enums expanded

Actions
- `apps/web/src/lib/actions/dominions.ts` — inspect + objectives CRUD actions
- `apps/web/src/lib/actions/memories.ts` — `getTodaysBriefings`, `getRecentAdvisories`, `archiveMemoryById`
- `apps/web/src/lib/actions/board.ts` + `projects.ts` — wired auto-capture

UI
- `apps/web/src/components/kairos/DominionEditDrawer.tsx`
- `apps/web/src/components/kairos/AdvisoryFeed.tsx`
- `apps/web/src/components/kairos/KairosLegend.tsx` — clickable Dominion pills
- `apps/web/src/components/hyperspace/DailyBriefingCard.tsx` — reads advisories
- `apps/web/src/components/sidebar/AppSidebar.tsx` — AdvisoryFeed mounted

Infrastructure
- `apps/web/vercel.json` — two cron entries (briefer 7am, snapshot 23:00)

**Phase 3 — spawn primitive**
- `apps/web/drizzle/0019_agent_sessions.sql` — agent_sessions + session_events
- `apps/web/src/lib/db/schema.ts` — `agentSessions`, `sessionEvents` tables + types
- `apps/web/src/lib/data/sessions.ts` — CRUD + event tail + getNextEventSeq
- `apps/web/src/lib/data/validators.ts` — spawn/update/event/list schemas
- `apps/web/src/lib/actions/sessions.ts` — `spawnSessionAction`, `killSessionAction`, et al
- `apps/web/src/lib/kairos/spawn.ts` — Aeon-side worker dispatcher (no-op fallback)
- `apps/web/src/app/api/v1/sessions/route.ts` — POST spawn, GET list
- `apps/web/src/app/api/v1/sessions/[id]/route.ts` — GET, PATCH (worker)
- `apps/web/src/app/api/v1/sessions/[id]/events/route.ts` — POST event, GET tail
- `apps/web/src/app/api/v1/sessions/[id]/kill/route.ts` — POST kill
- `apps/web/src/app/api/[transport]/tools/sessions.ts` — MCP tools
- `apps/web/src/components/kairos/LiveSessionsButton.tsx` — sidebar + popover + drawer
- `apps/web/src/components/sidebar/AppSidebar.tsx` — mounts LiveSessionsButton
- `apps/web/scripts/kairos-session-hook.mjs` — Claude Code hook
- `apps/web/scripts/kairos-hook-install.md` — install doc
- `apps/kairos-worker/` — long-running Node service (package.json, tsconfig, src/index.ts, src/spawner.ts, src/callback.ts, README.md)
