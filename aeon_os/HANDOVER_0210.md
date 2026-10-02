# Handover 0210 — Kairos 0.17 → 0.19 + Opus 5.5 everywhere + living world · next session starts at Phase 1

**Date:** 2026-10-02 · **Repo:** shadow_app_aeon · **Kairos 0.19.0 / app v0.37.0** — #143 (0.17), #144 (0.18), #145 (0.19) and the models + living-world PR (v0.37.0) are all live.
**Board:** AI Mission Control → "Kairos: move all paid-key thinking onto Max" (Landing Zone, checklist groups "Overhaul 0210" and "0.18 Owner asks").
**Read first:** this file → `research/kairos_0210/03_next_phases.md` (the plan) → `research/kairos_0210/02_brain_jobs_audit.md` (why the brain looks like this) → `research/kairos_0210/01_phase4_verdict.md` (Initiative research).

## 0. In one paragraph

On 02/10 Kairos was audited, simplified and shipped three times:
- **0.17** kept the 14 thinking jobs that feed a real part of the brain and retired the noise (briefs, raw idea dump, contradiction scan, tidy-ups, Sunday dedup, brain-tick). It put everything on ONE scheduled Max routine plus one chat routine, fixed the memory engine that failed on 02/10, and added the Connect Kairos window.
- **0.18** moved the morning message to 06:00 with a numbered, carried-over list of open questions (answer "Q12: …" on Telegram), added watched boards (finished AS Sprint cards reach him the same day), voice notes from claude.ai that count as the owner's words once confirmed, and the constitution draft on Max.
- **0.19** adds a Paid backup switch (off = zero API spend), moves the web-page chat onto Max, and replaces every setup guide with one live "Set up Kairos" checklist.
- **v0.37.0** puts Claude Opus 5.5 everywhere from ONE model registry (high effort for deep work, medium for standard, Sonnet 5.5 for quick; GPT-6 / Gemini 3.8 for other providers; old models auto-remapped) and adds the **Aeon living world** check (`npm run freshness` + weekly GitHub issue + skill) so Aeon notices when models, guides, architecture or versions fall behind (package upgrades: report only).

## 1. What shipped

| Version | PR | What changed (plain words) |
|---|---|---|
| 0.17 / v0.34.0 | #143 | Brain audit → 14 jobs kept, 4 retired + 5 crons. One "Kairos brain" routine (cron `40 1-6 * * *`, claims everything due) + "Kairos chat". Routine catalog in code (`lib/kairos/routines/catalog.ts`) with a test that locks planned kinds to it. Memory engine: per-step budgets, batched writes, standing written only on ≥0.05 moves. Connect Kairos modal. |
| 0.18 / v0.35.0 | #144 | 06:00 London message + code-built "Open questions" (stable Q numbers from Q10, cap 10, 14 days, `skip Q12`). Telegram Q-router before chat. Watched boards (`set_project_kairos_feed`, owner only; same-day `board_card_done`). Voice notes (`kairos_voice_note`, confirm in inbox). `constitution_seed` thinking kind. BRIEF/`run_recipe` retired. Health check at 04:25Z. |
| 0.19 / v0.36.0 | #145 | Paid backup switch (choke point `getModelForUser`; stored in `user_preferences.kairosPaidBackup`). Web chat on Max via the chat routine (`KAIROS_CHAT_ROUTINE=1`, old flag still accepted). One "Set up Kairos" checklist with live ticks and a one-click connector install link. Docs refreshed; `kairos-tick` skill deleted. |
| — / v0.37.0 | (models + living world) | `packages/shared/src/ai/model-registry.json` drives AI settings, Kairos tiers (effort sent via providerOptions), routines, Hangar (Copilot dotted ids), worker and the review gate (gpt-6.1-sol high). `@ai-sdk/anthropic` → 3.0.127, `@ai-sdk/openai` → 3.0.124 (needed for 5.5 / GPT-6). Key test uses the tested provider's model. `npm run freshness` (models, guides, architecture, versions, deps report-only) + `.github/workflows/freshness.yml` (Mon 06:30Z, one issue) + `docs/aeon-living-world.md` + skill `aeon-living-world`. Architecture docs refreshed to 0.19. |

## 2. Owner actions (Phase 1, ~15 minutes)

1. Aeon → sidebar **Kairos setup** → finish the 2 required steps (connect; Kairos brain routine) and delete the old routines it lists.
2. ~~Decide Paid backup~~ — **done: off** (switched in prod 02/10). With it off and no chat routine yet, chat replies say "I couldn't answer on your Max plan" — do step 3 soon.
3. Create the **Kairos chat** routine (now important — paid backup is off); Vercel `ROUTINE_CHAT_ID`, `ROUTINE_CHAT_TOKEN`, `KAIROS_CHAT_ROUTINE=1`; redeploy.
4. Paste the voice-note instruction into a claude.ai Project (Kairos setup → optional → Voice notes).
5. Mon 05/10: accept the first constitution in the inbox.
6. Your personal skill `~/.claude/skills/kairos-brief` calls the removed `run_recipe` — retire it.
7. After merge: run the **Aeon living world — freshness** workflow once by hand (GitHub → Actions → workflow_dispatch) to confirm it opens/closes its issue.

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

## 6. Decisions on record (02/10)

- **Paid backup: off.** No paid API spend; missed jobs wait for the next routine run.
- **Phase 2 Initiative rules:** one goal a night (none is fine), investigations only, always ask first, promises raised in the 06:00 message; at most one Telegram nudge per promise, only when >2 days late; Approve / Veto / "Veto + why" buttons, no answer = no action.
- **Models:** Claude Opus 5.5 is the default everywhere (high for deep work, medium for standard); no older Opus/Sonnet; keep the registry current via the living-world check.
- **No JavaScript dependency upgrades** without the owner's go (the freshness check only reports them).
- Open: Chronos person-lane groupings; mobile app restart.

## 7. How to start the next session

Paste this to start:

> New Kairos/Aeon session. Read `aeon_os/HANDOVER_0210.md` and `research/kairos_0210/03_next_phases.md`. We are starting **Phase 1 — Settle the brain**, then **Phase 2 — Initiative first slice** with the rules in §6. First, fan out inferno-prowlers in parallel to spec Phase 1's build items (constitution archive guard, claim/submit scoping, idea-candidate archiving, chat-routine timing) and Phase 2's three tracks (goals, promise list, Telegram approve/veto), each returning a file:line spec with tests and exit criteria. Then run `npm run freshness` and check last night's Kairos health before building. Track on the AI Mission Control board.