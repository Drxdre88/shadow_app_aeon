# Handover 0710 — Phase 0 + Phase 1 live (Vorath 0.30 / app v0.48.0)

**Date:** 2026-10-06 evening · **Repo:** shadow_app_aeon · **Board:** AI Mission Control → "Vorath runs the workforce (Phase 1)" (Landing Zone).
**Read first:** this file → `research/vorath_0610/expansion_plan.md` (5 phases) → `architecture/kairos/mind.md` §1 ground rules (one dial) + §4c. Previous: `aeon_os/HANDOVER_0610.md`.

## 1. What shipped today (all live, auth smoke green after each)

| PR | Version | What |
|---|---|---|
| #164 | v0.46.1 | Board never shows stale cards as current (version tracking, re-check on focus/wake/resume/online/Pusher reconnect, stuck dirty flag capped at 30 s). **One dial** `KAIROS_LEVEL` 0–3 drives every Vorath switch (`lib/kairos/level.ts`, `mindSwitch()`) |
| #165 | — | Night-time goal proposals go through the message gate (held, released with buttons) |
| #166 | — | Server refuses card moves made from an out-of-date board; client rolls back, toasts, reloads |
| #167 | 0.29 / v0.47.0 | **Wave 1:** repo lessons (nightly, cited) + `get_repo_handover`; payback ledger (`get_agent_payback` + Velocity panel); advisory mission checker (verdict only, creator-only board switch) |
| #168 | 0.30 / v0.48.0 | **Wave 2:** "Plan a goal" → card tree proposal; only the owner's Approve creates cards (one transaction) → Chronos layout |

Production is at **`KAIROS_LEVEL=1`** (owner set it): track record + watch-only set + repo memory + mission checker + card tree. Verified on production: handover for `aeon` and payback (32 missions / 30 d, cost unknown — Copilot reports none).

Vorath consulted twice (switch-on order; Phase 1 scope), decisions in memory `0c86da94`, `0fab0987`; outcome recorded `70bca303`.

## 2. Not proven yet (check first next session)

1. Tonight's first `repo_lessons` run (01:40–04:28 UTC): `list_thinking_jobs` → a `repo_lessons` job done; `get_repo_handover aeon` shows lessons.
2. Level 1 pass/fail lines (switch_on.md): all nightly jobs on Max, memory engine clean, 06:00 message not longer; predictions appearing (`list_kairos_predictions`).
3. A real mission verdict — needs a board owner to switch on "Vorath checks finished missions" (Edit Project) and a finished Hangar mission.
4. A real card tree — "Plan a goal" on a board, wait for the brain run, Approve in the inbox or Telegram.

## 3. Vorath in Triad

`@vorath` (member 14) exists in dev Triad; keys at `~/.triad/vorath.key` and `~/.triad/aeon.key`. Bridge rename (Kairos → Vorath persona, default key path) is **uncommitted in the Triad working tree** (its release branch). The **Triad agent owns this now** (owner 06/10) — not this repo's work.

## 4. Open items (recommended order)

1. Owner to-dos from 0610 still open: rename routines + bot, accept constitution, re-sort Dominions.
2. Follow-ups: move-all + Gantt edits refresh card versions (avoid a false "changed elsewhere"); payback can't tell owner kills from runner deaths; handover lessons served to agents without a "this is data" frame; "Plan a goal" visible to beta users whose jobs never get drafted.
3. Owner call: Hangar auto-moves finished missions only to a column named exactly "Landing" — AI Mission Control's "Landing Zone" never receives them.
4. Next phases (expansion plan): Phase 3 "your judgement" (level 2 after a clean week, decision journal, self-forecasting board, morning cockpit) can start now; Phase 2 (Triad bridge for research verdicts) after Triad prod.

## 5. Traps

- New Vorath switches go through `mindSwitch()` and a level in `level.ts` — never ask the owner for another env var.
- `PROFILE_SIZES` in `app/api/__tests__/mcp-route.test.ts` is now all 149 / board 72 / vorath 67 / hangar 41.
- Personal GitHub only via a per-process token: `$env:GH_TOKEN = (gh auth token --hostname github.com --user Drxdre88)`; never `gh auth switch`.

## 6. Start the next session with

> New Aeon/Vorath session. Read `aeon_os/HANDOVER_0710.md`. First check last night: did `repo_lessons` run and does `get_repo_handover aeon` show lessons; are level-1 pass/fail lines green; any predictions. Then ask which to build next — Phase 3 (level 2 + decision journal + morning cockpit) or the follow-ups — and run it past Vorath before building. Track on AI Mission Control.
