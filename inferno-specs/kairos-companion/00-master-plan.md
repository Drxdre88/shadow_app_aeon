# Kairos Companion — Master Plan

**Created:** 24/05/2026
**Branch (target):** `feature/kairos-companion` (off `feature/cortex-swarm-port`)
**Related branches:** `feature/brain-ai-integration` (BYOK — merge soon, falling behind)
**Author:** Andrey Selikhov + Claude (Opus 4.7 1M)

---

## 0. Frame

Kairos is not another tool in the stack. Kairos is the **higher layer** that holds the union of every other tool in attention on the operator's behalf.

- **Aeon** is the app (board, gantt, canvas, realms, projects).
- **Kairos** is the companion that lives inside Aeon's Kairos page and pill, with awareness across Aeon + every spawned engine.
- **The Engine Router** is the seam: per-task it picks the most cost-effective AI substrate currently available (Claude Max / Codex / company AI / API fallback).
- **The substrate engines are a market.** They will change. Kairos persists.

The operator framing: a superhuman user commanding a vast field of work, needing a present, opinionated, time-defending, model-of-you-accumulating companion — not an assistant.

Five non-negotiables for the companion:
1. **Feels like one entity** even though it dispatches many subsystems.
2. **Ambient, not invoked** — pill always pulsing, voice always standby, live on phone.
3. **Defends your time** — discretion is first-class; most knowledge held, some surfaced, tiny slice interrupts.
4. **Accumulates a model of you** — preferences, patterns, fatigue, loyalties.
5. **Takes initiative** — opinionated, can interject.

---

## 0.5. The Four-Layer Orchestration Tower

Kairos has **four distinct cognitive layers**, each with different reliability needs, cost shape, and engine fit. Conflating them — treating "the engines" as one tier — is the single biggest architectural mistake to avoid.

```
LAYER 4 — MASTER BRAIN
  The companion's "you" — voice, briefings, advisory synthesis, model-of-you
  Engine: Claude Opus 4.7 (1M) via BYOK API
  Mode:   Persistent server-side reasoning loop (Vercel AI SDK)
                  │
                  ▼
LAYER 3 — ORCHESTRATORS
  Plan runner, Briefer, Monitor, Channel-relay, Spawner
  Engine: Codex (GPT-5.5) via Company AI backend (free)
  Mode:   Cron + event-driven loops, server-side, MCP-native
                  │
                  ▼
LAYER 2 — TASK EXECUTORS
  Actual work in repos — code, tests, deploys, refactors
  Engines: Claude Code (Max sub) / Codex CLI (sub) / Codex+CompanyAI / BYOK
  Mode:   Spawned sessions via worker host, routed by task type
                  │
                  ▼
LAYER 1 — REVIEWERS
  Adversarial review inside Claude Code sessions
  Engine: Codex via codex-plugin-cc (slash command)
  Mode:   Pre-commit / pre-PR / post-spawn verification
```

### Why each layer's engine choice

**Layer 4 — Claude Opus via BYOK (not Max subscription).** Persistent reasoning loop runs continuously; if it ate Max quota it would starve your interactive coding work. BYOK gives dedicated cost-controlled access. Opus chosen for conversation quality, 1M context (holds full graph + Dominions + Plans + memories + model-of-you in attention), and nuanced judgement on when to interrupt. Most calls are small classifiers; only briefings + voice + advisory synthesis go full Opus. ~$30–80/mo expected.

**Layer 3 — Codex via Company AI (free).** Orchestrators run high-frequency (briefer 1×/day, monitor every 30min, plus per-event triggers). Codex chosen for 72% token efficiency, 7+ hour autonomous stability, native `spawn_agents_on_csv` parallel evaluation, MCP-native (talks to Aeon directly). Company AI backend via `OPENAI_BASE_URL` makes it free at zero marginal cost. Decision quality is adequate ("is step done? alert? dispatch next?") — doesn't need Opus nuance.

**Layer 2 — Routed by task type.** Frontend/architecture → Claude Code (Max). Shell-heavy/long autonomous → Codex CLI (sub). Batch/rollups → Codex via Company AI. Sensitive code → Company AI only. Burst overflow → BYOK API. Already covered in `01-codex-integration-strategy.md`.

**Layer 1 — Codex plugin inside Claude.** Adversarial review with different model architecture = independent verification. Zero new infra (one plugin install).

### What's running where, right now vs target

| Layer | Today | Target (post-Phase 7) |
|---|---|---|
| Master Brain | **YOU** | Claude Opus via BYOK ambient loop |
| Orchestrators | **YOU** (manually walking plans, reading boards, classifying messages) | Codex on Company AI as cron + event loops |
| Task Executors | Claude Code manual spawn | Mixed fleet auto-dispatched by Engine Router |
| Reviewers | YOU + occasional horsemen | Codex plugin auto-review + adversarial on high-stakes |

You currently occupy every layer. That's the root cause of working weekends to make up for misprioritised Thursdays. Kairos frees you from Layers 1, 3, and most of 4 — so you operate where you're irreplaceable (strategic direction, creative judgement, human relationships).

### When each layer comes online (mapped to phases)

| Phase | Layers brought online | Engines wired |
|---|---|---|
| 0 — Prep | none (validation) | Install codex-plugin-cc + Codex CLI + Company AI backend |
| BYOK merge | none (infra) | BYOK router live → Layer 4 engine available |
| 1 — Dominion Body | none (data) | — |
| 2 — Engine Router | Routing seam for all layers | Router dispatches all engines |
| 3 — Spawn primitive | **Layer 2 fully live** | Claude Code + Codex CLI spawnable |
| 4 — Plans + Advisories | **Layer 3 live + Layer 4 stub** | Orchestrators on Codex+CompanyAI; advisory synth on Claude Opus via BYOK |
| 5 — Channels | Layer 3 extension + Layer 4 widening | Inbound classifier on Codex+CompanyAI |
| 6 — Graph edit | none (UI) | — |
| 7 — Voice | **Layer 4 fully alive** | Voice loop on Claude Opus via BYOK |
| 8 — Model-of-you | Layer 4 personalisation | Richer prompt context |
| 9 — Trophy rollup | Layer 3 extension | Codex `spawn_agents_on_csv` on Company AI |
| 10 — Codex parity + tuning | All layers rebalanced | Router policies rewritten with burn data |

**MVP Kairos = Phase 4.** All four layers exist (even if Layer 4 is stub-quality and Layer 1 is plugin-only). Phases 5–10 mature each layer; architecture is complete at Phase 4.

### Monthly economic shape

| Layer | Engine | Cost/month |
|---|---|---|
| Layer 4 | Claude Opus via BYOK API | **$30–80** (new) |
| Layer 3 | Codex via Company AI | **$0** (free via `OPENAI_BASE_URL`) |
| Layer 2a | Claude Code Max sub | **$200** (already paying) |
| Layer 2b | Codex CLI sub | **$100** (already paying) |
| Layer 2c | Codex via Company AI | **$0** (free) |
| Layer 1 | Codex plugin | **$0** marginal |
| **Total incremental** | | **$30–80/mo** for full architecture |

You already spend $300/mo on subscriptions. Adding the full four-layer Kairos architecture costs $30–80/mo extra — for Opus API tokens the master brain consumes. Everything else is engine you've already paid for or company AI that's free.

### Routing decision matrix (seeds the `engine_policies` table in Phase 2)

| Question about the work | Engine |
|---|---|
| Voice conversation with you? | Claude Opus via BYOK |
| Writing a briefing or advisory? | Claude Opus via BYOK |
| Deciding if a Plan step is done? | Codex / Company AI |
| Classifying inbound message? | Codex / Company AI |
| Watching for stalls / polling boards? | Codex / Company AI |
| Nightly batch over many items? | Codex / Company AI (`spawn_agents_on_csv`) |
| Frontend code? | Claude Code (Max) |
| 1M-context architectural reasoning? | Claude Code (Max) |
| Autonomous for 1+ hours? | Codex CLI (sub) |
| Shell-heavy ops? | Codex CLI (sub) |
| Code review for correctness/security? | Codex plugin (in Claude session) |
| Touches sensitive IP? | Company AI only |
| Subscriptions throttled and must run now? | BYOK API fallback |

---

## 1. Schema additions

All migrations additive. No breaking changes to existing tables. User-scoped, indexed on `user_id`.

### 0017 — Dominion body

Extend `dominions`:

```
+ vision         text
+ mission_long   text
+ archived_at    timestamp
```

New `dominion_objectives`:

```
id              uuid pk
dominion_id     uuid fk → dominions
title           varchar(255) not null
description     text
status          enum: active | done | abandoned | parked   default 'active'
priority        int
target_date     date nullable
completed_at    timestamp nullable
created_at, updated_at
```

### 0018 — Plans (multi-dominion initiatives)

```
plans
  id, user_id, title, vision text, description text
  status enum: draft | active | blocked | done | abandoned
  priority int, start_date, target_date
  created_at, updated_at, completed_at

plan_dominions                   -- m2m: a plan can span dominions
  plan_id, dominion_id           pk(plan_id, dominion_id)

plan_steps                       -- ordered execution units
  id, plan_id fk, order int
  title, description
  goal_condition text             -- for `/goal` autonomous dispatch
  engine_preference varchar      -- claude | codex | companyAI | auto
  status enum: pending | in_progress | done | blocked | skipped
  assigned_session_id  uuid nullable fk → agent_sessions
  linked_task_id       uuid nullable fk → board_tasks
  linked_memory_ids    jsonb (array of uuid)
  notes text
  created_at, updated_at, completed_at
```

### 0019 — Agent sessions registry

```
agent_sessions
  id, user_id
  engine varchar                  -- claude | codex | companyAI | api
  engine_version varchar
  repo_path text, cwd text
  prompt text
  goal_condition text nullable
  status enum: queued | running | waiting_input | blocked | done | failed | cancelled
  pid int nullable
  worker_host varchar nullable
  started_at, ended_at
  estimated_cost_units int        -- quota burn estimate
  result_summary text
  plan_step_id      uuid nullable fk → plan_steps
  dominion_id       uuid nullable fk → dominions
  memory_thread_id  uuid nullable
  created_at, updated_at

session_events                    -- streamed from Claude/Codex hooks
  id, session_id fk
  timestamp
  event_type varchar              -- pretooluse | posttooluse | subagent_* | idle | stop | error
  tool_name varchar nullable
  payload jsonb
  -- TTL/archive policy: prune > 30 days unless session pinned
```

### 0020 — Engine Router

```
engine_quotas
  id, user_id
  engine varchar
  period_start, period_end
  used_units int, total_units int
  last_synced_at
  notes text

engine_policies                   -- routing rules, evaluated by priority
  id, user_id, name varchar, priority int
  condition jsonb                 -- { taskType, sensitivity, dominionId, repoPattern, urgencyMin, contextSizeMax }
  preferred_engines jsonb         -- ordered [{ engine, weight }]
  forbidden_engines jsonb         -- array
  enabled boolean
  created_at, updated_at
```

### 0021 — Channels

```
channel_adapters
  id, user_id
  channel_type varchar            -- teams | slack | discord | voice | email | sms | word | webhook | mobile_push
  name varchar
  direction enum: inbound | outbound | both
  config jsonb                    -- encrypted credentials, channel ids
  enabled boolean
  last_health_check
  created_at, updated_at

inbound_messages
  id, user_id, channel_id fk
  received_at, sender varchar
  raw_payload jsonb
  classified_intent varchar       -- bug_report | question | status_request | task_request | fyi | other
  assigned_memory_id uuid nullable fk → memories
  assigned_session_id uuid nullable fk → agent_sessions
  triage_status enum: new | classified | acted | dismissed
  created_at
```

### 0022 — Advisories (companion's voice)

```
advisories
  id, user_id
  generated_at, generated_by varchar  -- briefer | monitor | router | spawner | rollup
  urgency enum: silent | log | notify | interrupt
  title varchar, body text
  related_dominion_id, related_plan_id, related_session_id, related_memory_id  (all nullable fks)
  action_options jsonb            -- [{ label, action_type, payload }]
  delivered_at, acknowledged_at, dismissed_at, expires_at
```

### 0023 — Model-of-you

```
user_model
  id, user_id fk unique
  preferences jsonb               -- { commitStyle, verbosity, workHours, ... }
  patterns jsonb                  -- { misprioritisesOn, focusHoursPeak, ... }
  fatigue_signals jsonb           -- { longestSessionHrs, lastBreakAt, ... }
  loyalties jsonb                 -- { sacred: [dominionId], deprioritised: [dominionId] }
  updated_at
```

### 0024 — Memory links

```
memory_links                      -- m2m memory ↔ everything
  id, from_memory_id fk → memories
  to_memory_id   uuid nullable fk → memories
  to_task_id     uuid nullable fk → board_tasks
  to_project_id  uuid nullable fk → projects
  to_plan_id     uuid nullable fk → plans
  link_type varchar                -- references | derives_from | contradicts | summarises | continuation_of | correction_of
  weight float default 1.0
  created_by varchar               -- user | mem0 | claude | rollup
  created_at
  -- keep memories.taskId as denorm for FTS / quick lookup
```

---

## 2. Build order — 10 phases

Sized S (≤3 days), M (4–7 days), L (>1 week) at human pace. **AI-accelerated pace expected to compress total from ~16 weeks to ~1–2 weeks** by spawning parallel Claude/Codex sessions per phase under Kairos's own (manual at first, automated later) Engine Router.

### Phase 1 — Dominion Body (M)

**Goal:** Standing context per Dominion. Every downstream capability has a "what good looks like" to judge against.

- Migration 0017 + 0024
- MCP tools: `set_dominion_vision`, `list_objectives`, `create_objective`, `update_objective`, `archive_objective`, `inspect_dominion`
- REST mirror for parity
- UI: Dominion edit drawer in Aeon sidebar (vision textarea + objectives editable list)
- UI: Dominion detail page accessible from sidebar pill — vision + objectives + linked projects + recent memories
- Hand-fill all current Dominions with vision + 3–5 objectives each
- **Run in parallel:** use `claude agents --cwd .` and `/goal` daily; note what you wish was different

### Phase 2 — Engine Router (M)

**Goal:** The seam between "what the companion wants done" and "what's cheapest right now."

- Migration 0020
- `lib/kairos/router.ts` — `routeTask({ type, sensitivity, urgency, contextSize, dominionId })` → `{ engine, config, attribution }`
- Seed 5 default policies: `voice→claude`, `code_high_stakes→claude`, `code_volume→codex`, `monitor→companyAI`, `bulk_rollup→companyAI`
- Quota sync cron (5-min interval) — heuristic estimates from session counts initially
- UI: `/settings/kairos/engines` — quota bars per engine + policy editor table
- MCP tool: `route_task`

### Phase 3 — Spawn primitive + Session registry (L)

**Goal:** Kairos can use *its hands*. Live Claude/Codex sessions appear as orbs in the graph.

- Migration 0019
- `lib/kairos/spawn.ts` — `spawnSession({ engine, repo, prompt, goal, dominionId, planStepId })` enqueues to worker
- Worker host: lightweight Node service on dev box (later VPS). Shells `claude --bg --cwd <repo> "<prompt>"` or `codex exec` for codex
- Hook config in `~/.claude/settings.json` posts PostToolUse + Stop events to `/api/v1/sessions/<id>/events`
- UI: Kairos graph renders sessions as pulsing comet-trail nodes (new `role: "session"`)
- UI: Session side panel — live transcript, status, /goal condition, kill button
- Mobile: action card per session — Attach / Cancel / Promote-to-memory
- MCP tools: `spawn_session`, `list_active_sessions`, `cancel_session`, `attach_session`

### Phase 4 — Plans + Advisory layer (L)

**Goal:** Multi-step plans run autonomously; companion has a voice that proactively speaks up.

- Migration 0018 + 0022
- `lib/kairos/planRunner.ts` — walks plan_steps, dispatches via `spawnSession`, advances on completion, halts on block
- `lib/kairos/briefer.ts` — cron 7am: per active Dominion, calls `inspect_dominion` → router → engine → produces advisory of type `daily_brief`
- `lib/kairos/monitor.ts` — cron 30m: scans plans for stalls, team boards for stuck cards, creates advisories
- UI: Plans list per Dominion + cross-Dominion "All active plans" view
- UI: Plan detail — steps + Gantt-lite + linked sessions/tasks/memories
- UI: Advisory feed component — sorted by urgency, dismissable, action chips
- UI: in-graph anchor nodes for Plans (larger orbs with halo ring)
- MCP tools: `create_plan`, `add_plan_step`, `dispatch_plan_step`, `list_advisories`, `acknowledge_advisory`

### Phase 5 — Channel adapters (L)

**Goal:** Kairos exists *outside* the Aeon tab. Inbound triggers + outbound replies.

- Migration 0021
- **Inbound first:** Teams webhook + Slack incoming webhook
- Classifier — small router-dispatched LLM call tags intent → creates inbound_message + optional advisory
- **Outbound:** Teams reply via Graph API, Slack post, Discord webhook, Word doc generation via `docx` lib
- UI: Channel settings page (encrypted credential entry)
- UI: Inbound triage feed
- Mobile: push notifications via Capacitor

### Phase 6 — In-graph edit surface (M)

**Goal:** Direct manipulation of memory/plans/links in the orb graph. The cognition feedback loop.

- Drag Dominion pill onto a memory orb → updates `memory.dominion_id`
- Shift-click two nodes → draws an edge, creates `memory_links` row, prompts for link_type
- Right-click node → promote to anchor / link to plan / archive / edit aiTitle
- Every edit creates a memory of `type: "correction"` or `type: "link"`
- Lasso multi-select for bulk operations

### Phase 7 — Voice loop + ambient presence (L)

**Goal:** Kairos is *with* you, not visited.

- Browser Whisper API for STT (free) — push-to-talk on Kairos pill (desktop) and mobile mic button
- TTS: browser SpeechSynthesis v1; ElevenLabs/Cartesia for v2 brand voice
- Voice turn loop: STT → intent classifier (router) → engine call → TTS response → relevant graph nodes pulse during reasoning
- Mobile: Capacitor live activity / always-on indicator
- Kairos pill ambient state animation — idle / listening / thinking / speaking / acting

### Phase 8 — Model-of-you (M)

**Goal:** The companion becomes *yours*.

- Migration 0023
- Passive learner observes correction memories, completion times, fatigue patterns, repeated preferences
- Active prompts at end-of-day — "I noticed X — is that a pattern or a fluke?"
- Injects relevant slices of `user_model` into every router-dispatched prompt as system context
- UI: settings page showing what Kairos has learned (editable, forgettable, with provenance)

### Phase 9 — Trophy → Kairos rollup (M)

**Goal:** Completed task volume becomes narrative without graph explosion.

- Nightly rollup job — read `task_vault` items per project since last rollup → route to companyAI/codex → cluster into 1–5 thematic accomplishments → create memories with `type: "achievement"` and `memory_links` to underlying tasks
- Fallback: temporal rollup if theme clustering produces nothing
- UI: per-project setting "Show completed tasks in Kairos? (off / temporal / themed)"
- Evaluate Mem0 if their hierarchical extraction beats bespoke prompt

### Phase 10 — Codex parity + multi-engine deep integration (M)

**Goal:** Spawn primitive equally good with Codex; router policies tuned with real data.

- `codex` CLI integration in spawn worker
- AGENTS.md per repo (parallel to CLAUDE.md)
- Router policies rewritten with quota burn data + task-success-rate per engine
- Company AI as routable engine (Codex with `OPENAI_BASE_URL` override or direct MCP wrapper)
- Optional: A2A protocol when 3+ specialised operators run concurrently

---

## 3. Parallel tracks

| Track | When | Notes |
|---|---|---|
| **BYOK merge** — `feature/brain-ai-integration` (commit 8465858) | **Before Phase 2** — falling behind, merge soon | Provides API fallback for router's last-resort path |
| **VISION.md update** | After Phase 2 | Codify engine-router-as-seam framing |
| **ARCHITECTURE.md update** | After Phases 3, 5, 7 | Document new tables + companion architecture |
| **`agent_sessions` event archival** | Phase 3 onwards | Cron to prune > 30 days unless pinned |

---

## 4. Risks per phase

| Phase | Risk | Mitigation |
|---|---|---|
| 2 | Router policies hard to get right cold | Start with 5 hand-crafted defaults; iterate from quota burn data |
| 3 | Windows subprocess + worker host fiddly | Worker on WSL2 or Linux dev box; Windows is consumer only |
| 4 | Plan UX too heavy → unused | Keep step creation 3-click; allow "skip planning" one-shot dispatches |
| 5 | Teams Graph API auth painful | Slack + Discord first (webhooks); Teams as Phase 5.5 |
| 7 | Voice latency >1.5s feels broken | Browser STT/TTS fast enough; route voice to fastest engine regardless of policy |
| 8 | Model-of-you privacy concerns in team context | Single-user-only initially; team mode post-beta |

---

## 5. MVP companion

After Phases 1–3 (~5 weeks human / ~2–3 days AI-accelerated):

- Every Dominion has vision + objectives
- Engine Router decides where every task runs
- Kairos can spawn Claude/Codex sessions and surface them as live orbs
- `inspect_dominion()` MCP tool gives any AI full Dominion briefing context
- "Brief me on Dominion X" returns a grown-up answer

Phases 4–10 are the upgrade path to ambient + opinionated + presence.

---

## 6. Engine substrate map

| Engine | Subscription / Cost | Role | Phase wired |
|---|---|---|---|
| **Claude Max 20x** | $200/mo | Cognition, voice, high-stakes reasoning, code review, daily briefings | Phase 2 (router) + Phase 3 (spawn) |
| **Codex Pro** | $100/mo | Code volume, OpenAI-strength tasks, codebase exploration, parallel subagent work | Phase 10 (deep) + Phase 3 (light) |
| **Company AI** | Free (work-provided) | Vigilance loops, monitors, theme rollups, drafts, non-sensitive volume | Phase 2 (router) + Phase 9 (rollup) |
| **API fallback** (BYOK) | Per-token via `feature/brain-ai-integration` | Last resort when subscriptions throttled | After BYOK merge |

**Routing principle:** subscriptions first (flat-rate effort caps), APIs only when nothing fits. Marginal cost of additional Kairos intelligence approaches zero.

---

## 7. AI-accelerated execution model

This plan is itself a candidate for Kairos's own dogfooding:

- Phase 1 spec → spawn 3 parallel Claude sessions (schema migration, MCP tools, UI drawer)
- Phase 2 spec → spawn 2 parallel Claude sessions (router lib + settings UI)
- Phase 3 spec → spawn 3 parallel sessions (worker host, hooks, graph rendering)

Each spawned session reads its scoped spec file, executes against the branch, posts memories back. Manual orchestration for Phases 1–3, automated via Plan threads (which Phase 4 builds) from Phase 4 onward — at which point Kairos starts building itself.

Estimated AI-accelerated timeline: **MVP in 1 week, full vision in 2–3 weeks** assuming Claude Max 20x + Codex Pro parallel capacity.

---

## 8. Sub-spec files (to be created per phase)

- `01-phase-dominion-body.md`
- `02-phase-engine-router.md`
- `03-phase-spawn-sessions.md`
- `04-phase-plans-advisories.md`
- `05-phase-channels.md`
- `06-phase-graph-edit.md`
- `07-phase-voice-presence.md`
- `08-phase-model-of-you.md`
- `09-phase-trophy-rollup.md`
- `10-phase-codex-parity.md`
