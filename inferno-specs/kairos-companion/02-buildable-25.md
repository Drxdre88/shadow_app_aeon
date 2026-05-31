# Kairos Companion — 25 Buildable Elements

**Created:** 24/05/2026
**Branch:** `feature/kairos-companion` (BYOK merged as commit `e7d9fa3`)
**Premise:** Concrete tickets, each 0.5–2 days AI-accelerated / 1–3 days human, with clear "done" definitions. Sequenced by dependency; items in the same group can run in parallel.

---

## Group A — Memory Layer Expansion (1–5)

The user-flagged gap: today only Claude Code session captures land as memories. Aeon's own activity, project state, decisions, external events all need to flow in too.

| # | Element | Done when |
|---|---|---|
| 1 | **Memory type taxonomy expansion** — extend `memories.type` enum with: `snapshot`, `decision`, `inbound`, `advisory`, `achievement`, `session_event`, `fact`, `contact`, `external_event`. Migration `0017_memory_types.sql` | Drizzle enum updated; existing memories preserved (default stays `note`) |
| 2 | **Generic capture endpoint** — `POST /api/v1/memories/capture` accepting any structured source with Bearer auth, validates type, normalises sourceMetadata, returns memory id | curl from any external system creates a memory with correct type + sourceMetadata |
| 3 | **Auto-capture hook — Aeon board events** — wrap `createBoardTask`, `updateBoardTask`, `moveBoardTask`, `completeBoardTask` to emit `snapshot` or `achievement` memory | Every board mutation produces a memory; visible in Kairos graph |
| 4 | **Auto-capture hook — project lifecycle** — `createProject`, `updateProject` emit `snapshot` memory with project + dominion context | New projects appear as memory nodes within ~1 second |
| 5 | **Daily project snapshot cron** — Vercel Cron 23:00 nightly: per active project, generate `snapshot` memory summarising the day's activity (open tasks, completed tasks, blocked tasks, last 5 events) | One memory per active project per day; visible the next morning |

## Group B — Engine Router + Providers (6–10)

The seam between Kairos's persistent layer and the engine market. Built on the just-merged BYOK foundation (`lib/ai/router.ts` already exists — extend it).

| # | Element | Done when |
|---|---|---|
| 6 | **AIProvider TypeScript ABC** — port the `AIProvider` ABC from `sl-shadow-ai/provider.py`. `lib/ai/provider.ts` with `ask()` + `stream()` returning vendor-neutral `AIResponse` + `StreamChunk` envelopes | All future providers implement this interface; unit test passes |
| 7 | **OpenRouter provider** — `lib/ai/providers/openrouter.ts` calling OpenRouter API (OpenAI-compatible). Model selection via config | Test call hits `openai/gpt-4.1-nano` and returns usage stats |
| 8 | **Gemini provider** — `lib/ai/providers/gemini.ts` with free-tier-aware rate-limit handling (degrade to next-tier on 429) | Test call hits Gemini Flash-Lite; 429 falls through gracefully |
| 9 | **STAF provider** — `lib/ai/providers/staf.ts` calling `AGENT_OS_BASE_URL` with `AGENT_OS_BEARER_TOKEN`. Mirrors `sl-shadow-ai/StafProvider` shape but in TS | Test call to STAF1 endpoint returns text + thread_id |
| 10 | **Engine Router** — `lib/ai/route-task.ts` taking `{taskType, sensitivity, urgency, dominionId, contextSize}` → returns chosen provider. Migration `0018_engine_policies.sql` + seed policies (the table from `00-master-plan.md`) | `routeTask({taskType: 'classify'})` returns Gemini Flash-Lite; `{sensitive: true}` returns STAF or Ollama |

## Group C — Dominion Body (11–13)

Standing context so every advisory has something to compare against.

| # | Element | Done when |
|---|---|---|
| 11 | **Migration: dominion vision + objectives** — `0019_dominion_body.sql` adds `dominions.vision`, `dominions.mission_long`, `dominions.archived_at`, and creates `dominion_objectives` table | `npm run db:push` clean; new fields appear in Drizzle Studio |
| 12 | **MCP tools** — `inspect_dominion(id)` returns full briefing context (vision + objectives + projects + recent memories + active sessions). `set_dominion_vision`, `create_objective`, `update_objective`, `archive_objective`. REST mirror for parity | Calling `inspect_dominion` from Claude Code returns structured briefing |
| 13 | **UI: Dominion edit drawer** — slide-in drawer from Aeon sidebar's Dominion list: vision textarea + objectives list with inline CRUD | Right-clicking a Dominion → "Edit" opens drawer; saving persists |

## Group D — Spawn Primitive + Session Registry (14–18)

Kairos grows hands.

| # | Element | Done when |
|---|---|---|
| 14 | **Worker host service** — small Node service (`apps/kairos-worker/`) runs on dev box. Accepts authenticated POST `{engine, repo, prompt, goal, sessionId}`, shells `claude --bg --cwd <repo> "<prompt>"`, captures pid, streams events via SSE or polling | `curl` to worker spawns a claude session, returns pid, completes async |
| 15 | **Schema: agent_sessions + session_events** — migration `0020_agent_sessions.sql`. Indexed on `user_id`, `status`, `plan_step_id`. session_events has TTL via `event_archive_cron` | Spawned session creates row; status updates flow |
| 16 | **Server action: `spawnSession()`** — `lib/actions/sessions.ts`. Auth check → create row → POST to worker host → return session id. MCP tool `spawn_session` mirrors | Calling `spawnSession({engine:'claude', repo:'X', prompt:'Y'})` returns id; row exists; worker received request |
| 17 | **Claude Code hook config** — generate `~/.claude/settings.json` snippet for the user: PostToolUse + Stop → `curl POST /api/v1/sessions/{SESSION_ID}/events`. Document the install step | Hook fires on every tool use during a Kairos-spawned session; events arrive in DB |
| 18 | **UI: live session orbs** — Kairos graph renders sessions as pulsing comet-trail nodes (new `role: 'session'`). Side panel shows transcript + status + kill button | Spawning a session shows orb within 1 second; clicking opens panel; clicking kill terminates |

## Group E — Persistent Event-Driven Layer (19–22)

The companion's heartbeat — not 24/7 loop, but always-reachable triggers.

| # | Element | Done when |
|---|---|---|
| 19 | **Cron infrastructure** — `vercel.json` cron entries for: briefer (7am daily), monitor (every 30min), event-archive (nightly), project-snapshot (23:00 nightly). Auth via internal token | Cron jobs visible in Vercel dashboard; each writes a heartbeat memory |
| 20 | **Briefer** — `apps/web/src/lib/kairos/briefer.ts` invoked by cron. Per active Dominion: `inspect_dominion()` → `routeTask({taskType: 'brief'})` → Claude Opus via BYOK → creates `advisory` memory + writes to `advisories` table (later migration; for now just `memory.type='advisory'`) | 7am next day: one advisory per active Dominion appears in Kairos |
| 21 | **Cost budget enforcement** — `lib/ai/budget.ts` tracks per-day spend per provider. Soft cap (80%) → router downgrades non-voice traffic to cheaper providers. Hard cap (100%) → router refuses non-voice traffic; voice + interactive still route to Max sub | Daily spend visible in `/settings/ai`; hard cap triggers gracefully |
| 22 | **Advisory feed UI** — component in sidebar / Kairos page: urgency-sorted advisory list, dismissable, action chips ("Dispatch", "Defer", "Acknowledge") | Advisories from Briefer appear in feed; clicking action calls server action |

## Group F — Codex Integration (23–25)

Maximally leveraging Codex alongside Claude.

| # | Element | Done when |
|---|---|---|
| 23 | **Codex prep** — install `codex-plugin-cc` globally in `~/.claude/` + install `codex` CLI on dev box + register Aeon MCP via `codex mcp add aeon <url> <bearer>` + symlink `AGENTS.md → CLAUDE.md` in this repo and 3 other active repos | `/codex-review` works inside a Claude session; `codex exec --cd <repo>` works standalone |
| 24 | **Codex provider in Engine Router** — `lib/ai/providers/codex.ts` invokes Codex CLI as subprocess (for spawned tasks) or hits Codex API (for direct calls). Routes to STAF backend when `OPENAI_BASE_URL` env is STAF endpoint | `routeTask({taskType:'shell_heavy'})` returns Codex provider; test invocation succeeds |
| 25 | **Spawn worker — `engine: 'codex'` path** — extend worker host to handle Codex CLI invocation parallel to Claude. Same event streaming back via hook-equivalent (Codex `--json` output piped) | Spawning `{engine: 'codex'}` works end-to-end; session events flow |

---

## Dependencies

- A1–A5 are independent except A5 (project snapshot cron) needs cron infra from E19
- B6–B9 (providers) are independent of each other; all depend on B6 (ABC)
- B10 (router) depends on B6
- C11 → C12 → C13 sequenced
- D14–D18 sequenced (worker → schema → action → hook → UI)
- E19–E22 depend on B10 (router); E20 depends on C12 (inspect_dominion)
- F23–F25 depend on D14 (worker) for F25

## What's NOT in this 25 (deferred for now)

- **Plans + plan_runner + advisories table** — wait until briefer + spawn prove their value
- **Voice loop** — defer until persistent layer proves it (rich enough memory + advisories to talk about)
- **Channel adapters** (Teams/Slack inbound) — defer until inbound classifier proven via memory capture endpoint
- **In-graph edit surface** — defer until enough memory state exists to make editing valuable
- **Model-of-you** — defer; needs 8+ weeks of usage data to bootstrap
- **Trophy rollup** — defer; nice-to-have, doesn't gate companion behaviour
- **Local Ollama provider** — defer; cloud providers cover all use cases initially

## Critical-path 5 (if you only do this many)

If forced to pick the smallest set that gives you a working event-driven Kairos companion:

1. **A1** — memory type expansion (everything else writes to memory)
2. **A2** — capture endpoint (any source can write)
3. **B6 + B10** — AIProvider ABC + Engine Router with at least one provider (Gemini Flash-Lite via BYOK is enough)
4. **C11 + C12** — dominion body + inspect_dominion (gives router something to brief)
5. **E20** — briefer cron (the first persistent, event-driven inference)

That's ~7 items but it's the minimum viable persistent companion: it captures, it has standing context, it briefs you in the morning. Everything else compounds on those.
