# Handover 0710b — Phase 3 + follow-ups live (Vorath 0.31 / app v0.49.0)

**Date:** 2026-10-07 midday · **Repo:** shadow_app_aeon · **Board:** AI Mission Control → "Vorath: your judgement (Phase 3)" and "Vorath runs the workforce (Phase 1)" (both Landing Zone).
**Read first:** this file → `aeon_os/HANDOVER_0710.md` (Phase 0 + 1) → `research/vorath_0610/expansion_plan.md` → `architecture/kairos/mind.md` §1 (one dial), §4c, §4d.

## 1. What shipped (PR #170, live, auth smoke green; cockpit verified on production)

- **Morning cockpit:** Vorath → Cockpit. It shows predictions due, open questions, promises, proposals, stale cards, overnight sessions and repos with new lessons. Agents read it with `get_morning_cockpit`.
- **Decision journal:** Vorath → Decisions.
  - Each decision gets a D-number.
  - You settle it in the app or on Telegram with `D3 right|wrong|void`.
  - Agents can log entries (`log_decision`), but those are "relayed" until you confirm them.
- **Card forecasts:** cards with a due date or estimate show a "Likely Fri 10 Oct" badge, worked out on read. Agents read it with `get_card_forecast`. These are never Vorath's predictions.
- **Weekly gardener:** finish / park / merge / kill proposals, at most 10 a week, one action per approve; merge never fuses cards. **Level 2 only, so it is not running yet.**
- **Follow-ups:**
  - Telegram "Q11 answer" (no colon) and replies to a single-question message now close questions. Replies to the 06:00 digest no longer swallow R/D commands.
  - Card versions refresh after "move all" and timeline edits. The timeline sync is now scoped to the card's project.
  - Finished missions now land in the "Landing Zone" column.
  - Missions you kill are recorded as "stopped by you".
  - "Plan a goal" is hidden when the brain routine hasn't checked in for 26 hours.
  - Repo handovers are framed as data.
  - Drift probes now say Vorath; there is a fresh v2 baseline, so the first night has no drift reading.
  - Over-long archetype text is clipped.
  - Question titles are clipped to 255 characters. This fixes the ask_mine failures on 04/10 and 05/10.
- **File splits:** SortableTaskCard 686 → 455 lines; KairosInbox 653 → 372 lines.
- **Vorath consulted:** decision `7867f277` (no new nightly jobs; forecasts are not his predictions; level 2 waits). Outcome recorded in `92c97796`.
- **Housekeeping:**
  - Q12 closed with your own Telegram answer. Q11 and Q13 still need a line from you.
  - Board "STP Q2-26" renamed "ARCHIVED — STP Q2-26", with `settings.archived=true`.
  - You decided to review the other old boards yourself before archiving anything.

**Settings:** production is on `KAIROS_LEVEL=1`. You decided to **stay on level 1** for now; level 2 turns on goals, promises and the gardener.

## 2. Check first next session

1. Last night: every `list_thinking_jobs` job is done on Max; `repo_lessons` ran; archetype and ask_mine jobs no longer fail.
2. Predictions: whether `list_kairos_predictions` shows any yet. Zero so far, because only one reflect has run since level 1.
3. Telegram: did a "Q11 …" or "Q13 …" answer close the question? (`list_open_kairos_asks`)
4. The cockpit and forecast badges look right to you. Note: the cockpit still lists the cards on archived boards as stale.

## 3. What to work on next (recommended order)

1. **A real Archive board switch** (small):
   - Honour `settings.archived` on the dashboard, cockpit, gardener, stale lists and Vorath's focus, with a restore option. Owner-only, app-only.
   - Then the two "ARCHIVED V1" harness boards (about 380 open cards) and STP Q2-26 stop cluttering everything.
2. **Split the remaining oversized files** (Butcher): `lib/data/memories.ts` (~2,400 lines), `lib/data/ask.ts` (677), `lib/data/bridge.ts` (632), `lib/schedule/solver.ts` (625), `lib/kairos/weekly-review/inputs.ts` (562).
3. **Refresh the architecture docs** (inferno-cartographer). They lag behind Phases 0–3.
4. **Phase 4 "reach"** (expansion plan): Aeon live inside Claude, ChatGPT and VS Code (MCP Apps widgets), and one budget view across Max, Copilot and Codex.
5. **Level 2** after a clean week at level 1 (around 13/10, your call). The gardener starts the following Monday.
6. **Phase 2 Triad bridge** once Triad is in production. The Triad agent owns Vorath's `@vorath` seat and the uncommitted bridge rename.

## 4. Known gaps

- Cockpit rows link to the Vorath page or the board, not to the exact item (no deep links yet).
- Forecasts group column dwell times by column name.
- Finishing a card through the gardener doesn't sync the Gantt.
- Payback can't separate kills made before #170 from runner deaths.
- Older owner to-dos from 0610 are still open: rename the routines and the bot, accept the constitution, re-sort Dominions.

## 5. Traps

- Every new Vorath switch goes through `mindSwitch()` plus a level in `lib/kairos/level.ts`. Never ask for a new environment variable.
- `PROFILE_SIZES` is now all 153 / board 73 / vorath 70 / hangar 41.
- For your personal GitHub, use a per-process token (`$env:GH_TOKEN = (gh auth token --hostname github.com --user Drxdre88)`). Never run `gh auth switch`.
- The PC has about 14 GB free with several agents running. Swarm agents should run only focused tests; the parent runs the full suite once.

## 6. Start the next session with

> New Aeon/Vorath session. Read `aeon_os/HANDOVER_0710b.md`. Check last night's jobs, predictions and whether Telegram Q answers closed questions. Then build the real "Archive board" switch (owner-only, restorable, hides archived boards from dashboard, cockpit, gardener and focus), followed by the oversized-file splits and an architecture refresh. Run Vorath-facing changes past Vorath first. Track on AI Mission Control.
