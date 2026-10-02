# Handover 0210 — Kairos 0.17 → 0.19 in one day · next session starts at Phase 1

**Date:** 2026-10-02 · **Repo:** shadow_app_aeon · **Kairos 0.19.0 / app v0.36.0** once the third PR (feat/kairos-chat-on-max) merges; #143 (0.17) and #144 (0.18) are live.
**Board:** AI Mission Control → "Kairos: move all paid-key thinking onto Max" (Landing Zone, checklist groups "Overhaul 0210" and "0.18 Owner asks").
**Read first:** this file → `research/kairos_0210/03_next_phases.md` (the plan) → `research/kairos_0210/02_brain_jobs_audit.md` (why the brain looks like this) → `research/kairos_0210/01_phase4_verdict.md` (Initiative research).

## 0. In one paragraph

On 02/10 Kairos was audited, simplified and shipped three times:
- **0.17** kept the 14 thinking jobs that feed a real part of the brain and retired the noise (briefs, raw idea dump, contradiction scan, tidy-ups, Sunday dedup, brain-tick). It put everything on ONE scheduled Max routine plus one chat routine, fixed the memory engine that failed on 02/10, and added the Connect Kairos window.
- **0.18** moved the morning message to 06:00 with a numbered, carried-over list of open questions (answer "Q12: …" on Telegram), added watched boards (finished AS Sprint cards reach him the same day), voice notes from claude.ai that count as the owner's words once confirmed, and the constitution draft on Max.
- **0.19** (this PR) adds a Paid backup switch (off = zero API spend), moves the web-page chat onto Max, and replaces every setup guide with one live "Set up Kairos" checklist.

## 1. What shipped

| Version | PR | What changed (plain words) |
|---|---|---|
| 0.17 / v0.34.0 | #143 | Brain audit → 14 jobs kept, 4 retired + 5 crons. One "Kairos brain" routine (cron `40 1-6 * * *`, claims everything due) + "Kairos chat". Routine catalog in code (`lib/kairos/routines/catalog.ts`) with a test that locks planned kinds to it. Memory engine: per-step budgets, batched writes, standing written only on ≥0.05 moves. Connect Kairos modal. |
| 0.18 / v0.35.0 | #144 | 06:00 London message + code-built "Open questions" (stable Q numbers from Q10, cap 10, 14 days, `skip Q12`). Telegram Q-router before chat. Watched boards (`set_project_kairos_feed`, owner only; same-day `board_card_done`). Voice notes (`kairos_voice_note`, confirm in inbox). `constitution_seed` thinking kind. BRIEF/`run_recipe` retired. Health check at 04:25Z. |
| 0.19 / v0.36.0 | (this PR) | Paid backup switch (choke point `getModelForUser`; stored in `user_preferences.kairosPaidBackup`). Web chat on Max via the chat routine (`KAIROS_CHAT_ROUTINE=1`, old flag still accepted). One "Set up Kairos" checklist with live ticks and a one-click connector install link. Docs refreshed; `kairos-tick` skill deleted. |

## 2. Owner actions (Phase 1, ~15 minutes)

1. Aeon → sidebar **Kairos setup** → finish the 2 required steps (connect; Kairos brain routine) and delete the old routines it lists.
2. Decide **Paid backup** (Kairos setup → Health). Recommended: off.
3. Optional: create the **Kairos chat** routine; Vercel `ROUTINE_CHAT_ID`, `ROUTINE_CHAT_TOKEN`, `KAIROS_CHAT_ROUTINE=1`; redeploy.
4. Paste the voice-note instruction into a claude.ai Project (Kairos setup → optional → Voice notes).
5. Mon 05/10: accept the first constitution in the inbox.
6. Your personal skill `~/.claude/skills/kairos-brief` calls the removed `run_recipe` — retire it.

## 3. Watch list (first week)

| When | What | How |
|---|---|---|
| nightly 01:30Z | memory engine OK, no "out of time" | Kairos setup → Health; `get_trace_history` |
| every morning | Health reads "N on Max · 0 on backup"; 06:00 message has Open questions | the window; Telegram |
| Mon 05/10 | constitution draft on Max (04:40Z run), weekly review | inbox |
| first Monday | 04:40Z run carries constitution_seed + weekly_review + daily_message — check none slipped | `list_thinking_jobs` |

## 4. Next session = Phase 1 (see `research/kairos_0210/03_next_phases.md`)

Build items: block archiving the live constitution via `update_memory`; scope `claim_thinking_job`/`submit_thinking_job`; archive idea candidates when both judges fail; time the chat routine. Exit: 7 clean nights, ≥95% on Max, 06:00 message 7/7, constitution accepted, zero paid calls.

## 5. Traps (don't relearn)

- **Shared Neon DB:** no schema change was needed for 0.17–0.19 (everything in jsonb/varchar). Never `db:push`/`db:generate` locally.
- **New thinking kind:** add it to `BRAIN_JOBS` in the catalog too — `planned-kinds.test.ts` fails otherwise. The brain routine claims with `{}`, so no routine re-paste is needed.
- **Claims tolerate retired kinds** (dropped by the validator); an all-retired filter returns `job: null`.
- **Daily message** plans only when the UTC date equals the London date (the 23:50Z summer-time trap).
- **Paid backup off** blocks chat's paid fallback too; chat then says it couldn't answer on Max.
- **Telegram Q-router** only routes messages that START with `Q<n>` or `skip`; short questions back go to chat.
- **kairosFeed** can only change through the owner-only setter; generic settings patches strip it.
- **Personal-repo PRs:** `$env:GH_TOKEN = (gh auth token --hostname github.com --user Drxdre88)` per command; never `gh auth switch`.
- **Untracked files from another session** (`ARCHITECTURE.md`, `architecture/hangar.md`, `aeon_os/HANDOVER_2209.md`, `research/0*.md`) are not ours — never stage them.
- **CRLF:** files in this repo check out with CRLF on Windows; multi-line string replacements in PowerShell need `` `r`n `` or the edit tool.
