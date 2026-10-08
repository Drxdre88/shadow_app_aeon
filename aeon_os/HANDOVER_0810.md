# Handover 0810 — Archive switch, lessons read git, your coding year measured

**Date:** 2026-10-08 morning · **Repo:** shadow_app_aeon · **Board:** AI Mission Control → "Archive board switch" (Landing Zone) and "Richer session memory for Vorath" (Live).
**Read first:** this file → `aeon_os/HANDOVER_0710b.md` (Phase 3, still-open list) → skill `~/.claude/skills/git-stats/SKILL.md`.

## 1. What shipped (all live, auth smoke green after each deploy)

- **#172 Archive board switch.** The board creator can archive or restore a board from the Edit window or the right-click menu. Archived boards disappear for every member: dashboard, sidebar, favourites, realm lists, `list_projects` / `GET /v1/projects` (opt in with `includeArchived` / `?archived=true`). They also leave Vorath's live inputs: cockpit stale cards, gardener, ask_mine, inspect_dominion, card triage, repo handover cards and nightly snapshots. Memories stay searchable (Vorath decision `53c8a7ac`). Restore from the sidebar's **Archived boards** list. The generic settings merge can no longer set or clear the flag.
  - Verified live: STP Q2-26 has left the cockpit. The stale list now shows your other old boards (Test2, AEON Closed Beta PBIs, STP Leads, STP Strats).
- **#172 Repo lessons read session facts.** The nightly `repo_lessons` prompt now gets one facts line per session: commits, PRs, tests, tool errors, lines, top files, mission outcome. A failed test is treated as a signal, not proof (Vorath decision `2557d83c`).
- **#173 Repo lessons read the nightly git digest.** Repos with git activity but no agent session now get lessons. Digest ids can be cited.
- **#174 + #175 git-stats tooling.** `apps/web/scripts/git-stats/` is read-only Node with 53 tests (`node --test extract.test.mjs prs.test.mjs report.test.mjs digest.test.mjs`).
  - `extract`: one record per commit across branches and remotes. It removes only exact duplicates (merges, patch-id copies, squash merges whose branch still exists).
  - `prs`: read-only PR history. Azure DevOps uses the git credential; GitHub uses a process-scoped Drxdre88 token.
  - `digest`: per repo, per day. It stores locally in `~/.aeon/git-stats/` (`daily/<day>.json`, `history.jsonl`, `receipts.json`) and posts `repo_git_digest` observation memories. Receipts are the only dedupe guard, because the REST API doesn't dedupe.
  - `report`: a dark single-column HTML and MD page with inline SVG charts and findings derived from the data.
  - **#175 is the owner policy of 08/10, opened this morning; merge it if it isn't merged yet.** All code counts, including big features, imports, vendored code and repeated themes. AI attribution order: agent identity > Co-authored-by trailer > agent era. The agent era means owner commits and PRs on or after **2026-08-20**, the first Copilot CLI session on this PC, because Copilot commits and opens PRs as you.
- **Scheduled tasks (this PC):**
  - `Aeon Git Digest` runs daily at 00:20 **and** 09:00. Overnight standby made the first run take 2.4 h, so the 09:00 run catches up. Receipts prevent double posts.
  - `Aeon Git Year Report` runs Mondays at 09:30 and writes the rolling 365-day report to `~/.aeon/git-stats/year/report/`.
- **Skill `git-stats`** (`~/.claude/skills/git-stats/`) covers the daily check, backfill, counting rules, how to change what's counted, and report style.
- **Your coding year (7 Oct 2025 – 7 Oct 2026)** is in `research/git_stats_0710/report/report.html` (untracked):
  - 3,424 commits on 256 days across 27 repos. 637 PRs opened, 632 merged.
  - **+1.75M code lines**; +2.87M authored, including tests and docs.
  - AI made **73% of commits and 66% of the code**.
  - Since 20 Aug: **5.4× code per active day, 7.2× commits per day, 3.5× PRs per week.**
  - Work moved from labs to apps: 46% → 92% of commits.

## 2. Check first next session

1. **Did lessons use the new data?** Last night's digest for 07/10 posted at 01:59 UTC, after the 01:40 lessons window opened, so **tonight (09/10) is the first real test**. Check that `list_thinking_jobs` shows `repo_lessons` done. Then check that the playbooks (cockpit "Repos with new lessons", or `get_repo_handover`) cite a digest id or mention commits, PRs or tests, and cover a git-only repo.
2. **Digest health:** use the `git-stats` skill's daily check. `Get-ScheduledTaskInfo` should show result 0, `digest.log` should end with `exit 0`, and yesterday should be in `receipts.json`.
3. **Rolling report:** check that `~/.aeon/git-stats/year/report/report.html` was refreshed under the new policy. It was triggered on 08/10.
4. **Open owner items:**
  - Look over the Archive switch, then move its card to Done.
  - Review the old boards in the cockpit stale list.
  - Answer Q11 and Q13 on Telegram.

## 3. What to work on next (recommended order)

1. **"My performance" page in Triad.** The owner wants daily, weekly and monthly tracking of real output, not just tokens burned. Recon is done (two prowler maps, 08/10):
   - **Triad side (a Triad session, full Triad release gate):**
     - A `triad.git_daily_stats` table with key (owner_member_id, repo, day), modelled on `device_usage_hours` (`apps/triad-api/services/device_usage.py`, migration 0012) with overwrite-upsert and no pruning.
     - `PUT /agent/v1/git-stats/days`: up to 500 rows, new key scope `stats:write`, owner taken from the key.
     - A private `GET /api/me/perf?from&to&group=day|week|month`, which also folds in the existing `device_usage_hours` AIC and tokens for 400 days.
     - A new `view: 'performance'`: `ui.ts:30`, an `AppShell` branch, `destinations.ts`, a `Rail` item.
     - A hand-built SVG chart kit grown from `Sparkline`/`MiniSpark` (Triad has no chart library and uses `--tr-*` tokens).
     - Contract first in `docs/contract.md`.
   - **Aeon side (here):**
     - Add `apps/web/scripts/git-stats/triad-push.mjs`, which re-sends the last 14 `daily/<day>.json` files each run. Read the daily files, not `history.jsonl`, which keeps the first copy of each row.
     - Hook it into `run-digest.cmd`.
     - Backfill the year with `node digest.mjs --catch-up 365 --dry-run --store`. Check that the extraction time is acceptable first. Then push once with N=365.
   - **Owner decisions:**
     - hand-made SVG charts or a bundled chart library;
     - a dedicated "git-stats" Triad bot key;
     - whether the page is strictly private (sessions are currently visible to conversation members, so the endpoint must filter by owner).
2. **Session memory cleanup** (Richer session memory card, step 3):
   - Skip transcript-less headless Copilot sessions instead of dead-lettering them. About 200 dead-lettered on 26–27 Sep; the files are in `~/.aeon/session-capture/failed/`.
   - Normalise repo slugs (`aeon` vs `shadow_app_aeon`) in `repo-memory.ts` and `dominion-activity.ts`, and write a top-level `repo` in mission memory.
3. **Split oversized files** with Butcher. There are 29 files over 500 lines. Priority:
   - `lib/data/memories.ts` (2,400): a 9-module plan exists from the 07/10 prowler. Barrel kept, 75 test mocks.
   - `ask.ts`, `bridge.ts`, `schedule/solver.ts`, `weekly-review/inputs.ts`.
   - `projects.ts` (562) and `workspaces.ts` (694), which the archive switch touched.
4. **Architecture docs, targeted edits** (not a full cartographer run):
   - counts: 153 tools, 29 thinking kinds, 14 crons, Vorath 0.31 / app 0.49;
   - a history entry for #164–#175;
   - new modules: archive, git digest, cockpit, decisions, forecasts;
   - **`docs/kairos/CHANGELOG.md` stuck at 0.28**, which is why freshness shows 🔴.
5. Carried over from 0710b: Phase 4 reach (MCP Apps widgets, a single budget view), **Level 2 around 13/10** (your call), and the Triad bridge once Triad is in production.

## 4. Known gaps

- Digests posted on 06/10 and 07/10 used the older counting, which excluded big commits and had no AI fields. From 08/10 onwards they follow the new policy.
- The AI share relies on the agent-era assumption from 20 Aug. Before that it only counts trailers and agent identities, so Claude Code and Hangar work without a trailer is missed. After that, any hand-typed commit is counted as AI.
- The year report folder is untracked and names colleagues in its "other contributors" line. Don't share it as is.
- Hooks and both scheduled tasks run from the live `shadow_app_aeon` checkout. Keep the local checkout on `main`.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` is set in this PC's environment, so Node HTTPS doesn't verify certificates. It isn't ours, but it's worth raising.

## 5. Traps

- Archive filters live in `lib/data/board-visibility.ts`. Keep read-only modules importing it, **not** `project-archive.ts`; the repo-handover read-only guard fails on the name "archive".
- Copilot commits as you, so git identity alone can't separate you from Copilot. Use `agent_era_start` in `repos.json`.
- Never delete `~/.aeon/git-stats/receipts.json`: the server would duplicate the digests.
- Personal GitHub uses a per-process token (`$env:GH_TOKEN = (gh auth token --hostname github.com --user Drxdre88)`). Never run `gh auth switch`.

## 6. Start the next session with

> New Aeon/Vorath session. Read `aeon_os/HANDOVER_0810.md`. Check that last night's repo lessons used the git digests and session facts, and that the git digest task is healthy (git-stats skill). Then build the Aeon side of the Triad "My performance" page (triad-push.mjs plus a year backfill), and hand the Triad side (table, endpoint, page) to a Triad session with the plan in §3.1. After that: session-capture cleanup, then the memories.ts split. Run Vorath-facing changes past Vorath first. Track on AI Mission Control.
