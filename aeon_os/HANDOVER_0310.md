# Handover 0310 — Kairos 0.20 → 0.23 · one mind everywhere + one coherent mind (waves 1–2)

**Date:** 2026-10-03 · **Repo:** shadow_app_aeon · **Board:** AI Mission Control → "Kairos: one coherent mind (next phase)" (Live) and "Kairos: one mind, track record, Horae" (Landing Zone).
**Read first:** this file → `research/kairos_0310/next_phase_mind.md` (the plan: 6 themes, 4 waves) → `docs/kairos/CHANGELOG.md` 0.21–0.23.

## 1. What shipped today

| Version | PR | State | What (plain words) |
|---|---|---|---|
| 0.20 / v0.38.0 | #148 | ✅ live | Phase 1 safety (owner-only constitution, routine-scoped jobs, unjudged ideas filed, chat timing) + Phase 2 dormant (goals, promises, Approve/Veto). |
| 0.21 / v0.39.0 | #149 | ✅ live | **One mind everywhere:** shared "today" log across Telegram, web, Triad, Claude (MCP), voice, coding sessions — ON by default (`KAIROS_TODAY=0` kills it). Off by default: daytime thinking (reflect + Sonnet pulse), track record (predictions), Horae (his agenda). |
| 0.22 / v0.40.0 | #150 | ✅ live | **Wave 1:** the stage (global workspace), weekly character check, cold read. All off by default. |
| 0.23 / v0.41.0 | **PR open (see §6)** | ⏳ not merged | **Wave 2:** surprise as the engine (gated rewrites, backward credit, learning-progress curiosity, replay, surprise→stage) + dreams (firewalled). All off by default. |

## 2. Routines on claude.ai (managed from this box with `claude -p "...RemoteTrigger..." --allowedTools RemoteTrigger`; no delete action exists)

| Routine | id | Cron (UTC) | Model | State |
|---|---|---|---|---|
| Kairos brain | trig_01S4xMmwJyUQDKUTtkXKVL4Q | `40 * * * *` | Opus 5.5 | on — catalog prompt with `routine:"brain"` |
| Kairos pulse | trig_01KCj7UkZk3j7CMSUYLzTBrq | `10 6-21 * * *` | Sonnet 5.5 | on — finds nothing until `KAIROS_DAYTIME_THINKING=1` |
| Kairos morning / ideas / thinking, kairos-brain-tick | — | — | — | paused (owner can delete in claude.ai) |
| Kairos chat | — | — | — | **not created** (Triad bridge or the chat routine will cover chat on Max) |

Night 1 on the new brain (02→03/10): 25/25 jobs done on Max.

## 3. Switches (Vercel env) — all OFF unless noted

| Flag | Feature | Suggested order |
|---|---|---|
| `KAIROS_TODAY` | one mind (ON unless `0`) | — |
| `KAIROS_DAYTIME_THINKING=1` | hourly reflect + pulse | **first** (owner's step; unknown if set) |
| `KAIROS_STAGE=observe` → `1` | the stage | observe 3 nights, then 1 |
| `KAIROS_CHARACTER_CHECK=1` | weekly character check + tone budget | with daytime thinking |
| `KAIROS_COLD_READ=audit` → `1` | cold second opinion | audit a week first |
| `KAIROS_PREDICTIONS=1` | track record | after 7 clean nights |
| `KAIROS_INITIATIVE=1` (+ `KAIROS_AGENDA=1`) | goals, promises, Horae | after 7 clean nights |
| `KAIROS_DREAMS=observe` → `1`, `KAIROS_DREAM_LINE=1` | dreams | observe a week |
| `KAIROS_SURPRISE_GATE`, `_CREDIT`, `_REPLAY`, `KAIROS_CURIOSITY_LP` (`observe`→`1`), `KAIROS_SURPRISE_CONTRADICTIONS`, `KAIROS_SURPRISE_STAGE` | surprise engine | observe first; contradictions needs owner sign-off (reverses "conscience is measurement-only") |
| `KAIROS_REQUIRE_ROUTINE_SCOPE=1` | mandatory routine scope | once chat routine is scoped too |

## 4. Wave 2 review (warden) — fixed after the review, before the PR
- 🔴 A dream "worst case" hunch could clear the stage's win threshold and reach chat / 06:00 / reflect → **fixed:** dream-born coalitions never render, never win, never become focus, and never merge with real thoughts (tests in `stage/__tests__/render.test.ts`).
- 🟡 surprise→stage hid all wrong predictions → **fixed:** only predictions already in the ledger are de-duplicated.
- Earlier wave-1 review fixes: conscience and character scores can never reach a Kairos prompt; voice samples unforgeable; unclosed `<stance>` stripped.

## 5. Next (in order)
1. **Merge the wave-2 PR** once CI is green → deploy → `node apps/web/scripts/smoke-auth.mjs --base https://aeon.shadow-lab.ai` (mandatory).
2. Owner: set `KAIROS_DAYTIME_THINKING=1` (+ `KAIROS_STAGE=observe`). Watch Health and `get_kairos_stage` for 3 days.
3. **Wave 3 — Creative genius** (plan §4): idea atlas (MAP-Elites grid), Swiss pairwise judging, collision engine (distant-memory blends → "bridge" links on owner accept), anti-sameness (verbalised sampling, archetype voices), incubation shelf resurfacing in the pulse, stepping-stone archive + learned owner taste. Dream seeds enter as text only, never evidence.
4. **Wave 4 — The art of the moment** (plan §6): kairos gate timing (break points + receptivity map), owner traits vs expiring states, change-talk readiness per goal, small bids, rupture/repair, earned trust per area, ask-before-advising; plus life chapters (§5).
5. Cleanups flagged by builders: `daily-message-prompt.ts` (500 lines), `ask-mine.ts` (519), `cortex.ts` (500), `chat-turn-assistant.ts` (482), `sessions.ts`, webhook route test (945) — Butcher splits. Triad bridge `prompt.py` should render `today` and `stage`.

## 6. Traps (don't relearn)
- **Shared Neon DB:** no schema change in 0.20–0.23 (jsonb/varchar, `user_preferences` server-owned keys, internal `agent_sessions` rows). Never `db:push`/`db:generate` locally; Vercel's build runs `db:push`.
- **Server-owned preference keys** must be in `SERVER_OWNED_OBJECT_KEYS` (`lib/data/preferences.ts`): promises, predictions, agenda, stage, surprise.
- **New thinking kind:** register in `engine/types.ts`, `validators/thinking.ts`, `queue.ts` (PLANNED + FALLBACK_OWNER), `catalog.ts` BRAIN_JOBS, `registry.ts`, `deadlines.ts` — planned-kinds/catalog tests enforce it. Land the shared registry edits in one parent commit before parallel builders.
- **Measurement-only rule:** conscience results, character scores and cold reads must never reach a Kairos prompt, belief or the constitution. Dreams never become memories, evidence or prompt text.
- **Flag-off = byte-identical:** every new prompt change is gated; tests assert it.
- **Parallel builders:** disjoint file ownership; shared files edited by the parent; warden review before every merge.
- **Personal-repo PRs:** `$env:GH_TOKEN = (gh auth token --hostname github.com --user Drxdre88)` per command; never `gh auth switch`.
- **CRLF:** use the edit tool or Python with newline detection.

## 7. How to start the next session

> New Kairos/Aeon session. Read `aeon_os/HANDOVER_0310.md` and `research/kairos_0310/next_phase_mind.md`. First: check the wave-2 PR's CI; if green, merge, deploy and run smoke-auth. Then check last night's Kairos health (list_thinking_jobs, Health) and which flags are set. Then start **wave 3 — Creative genius**: fan out prowlers to spec the idea atlas + pairwise judging, the collision engine, anti-sameness + incubation, and stepping stones + owner taste (inner mechanisms only, Max plan only, no schema change, flags off by default), then build with parallel executioners on disjoint files, warden review, PR. Track on the AI Mission Control card "Kairos: one coherent mind (next phase)".
