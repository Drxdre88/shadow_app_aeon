# Kairos 2909 — Capture pipeline + recency audit + proposed session record

W = `apps/web/src`, S = `apps/web/scripts`, K = `apps/kairos-worker/src`. All confirmed by read unless marked inferred.

## A. Capture pipeline map

| Client | Trigger | Extracted | Missing (available in source) | Class/conf | Defects |
|---|---|---|---|---|---|
| Claude Code | `~/.claude/settings.json:153-157` SessionEnd → `S/claude-session-capture-dispatch.mjs` → queue `~/.aeon/session-capture/pending` → detached `S/session-capture-drain.mjs` → capture `--queue-worker`; SessionStart backfill 48h/max 50 (`capture.mjs:791-821`) | title `${repo}: first 60 chars of first prompt`; summary = Executive Summary (240) or first prompt; aiTitle floor; execSummary ≤10 bullets; body = stats, first prompt, files ≤50, commits (`git log --since` at drain time, HEAD of shared tree), final message; sourceMetadata {repo, branch, remote, sessionId, client, cwd, hookEvent, endReason, projectName, realmName, filesTouched, commits, stats}; tags [session, client, repo, branch:x] (`capture.mjs:373-479`) | per-record gitBranch, message.model, usage tokens, cost-state (totalCostUSD, lines added/removed, modelUsage), toolUseResult (Bash stdout → PR URLs from `gh pr create`, test pass/fail, commit lines), is_error counts, tool-name histogram, subagent use, AEON_TASK_ID, KAIROS_SESSION_ID | idea / 0.6 (streamClass unset → DB default `memories.ts:886-887,968`) | `taskId` hardcoded null (`capture.mjs:445`); commits misattributed on shared tree (inferred); `branch:` tag >43 chars → tag max 50 (`validators/memory.ts:65`) 400s the whole capture → dead-letter (latent) |
| Codex | `~/.codex/config.toml` hooks → `S/codex-session-capture-dispatch.mjs`; backfill 5/start | messages, tool calls, apply_patch file headers (`S/session-transcript.mjs:47-92`) | `function_call_output` dropped (no test results/errors/PR URLs); tokens/model not inspected | idea / 0.6 | retries as `source=hook` if server rejects source |
| Copilot CLI | `~/.copilot/settings.json:118-131` (the `.disabled` hooks file is NOT active) | turns + session_files from `~/.copilot/session-store.db` (`S/copilot-session-transcript.mjs:52-120`) | ALL tool calls (files faked as Edit tool_use); model; tokens | idea / 0.6 | 242 dead-letters in `~/.aeon/session-capture/failed`: 215 zero-turn, 22 user-only, 5 real (all later rescued) → `retryOnEmpty` (`capture.mjs:638,858,870`) makes empty sessions retry = noise not loss |
| Hangar missions | runner posts session_events + terminal `kind:'result'` envelope (`K/poller.ts:486-548`) → `W/app/api/v1/sessions/[id]/events/route.ts:90-130` → `recordSessionResult` (card metadata + column) | envelope already has status, outcome, summary ≤8000, branch, commit, artifacts, tests{status,summary}, questions, recommended_tasks, stats{cost,tokens,turns,durationMs,toolCalls,model} (`validators/hangar.ts:167-203`) | **no memory written at all**; plus the CLI's own SessionEnd hook captures a generic row: repo `.aeon-worktrees`, identical title from the brief pointer (`K/poller.ts:698-703`, truncated `capture.mjs:378-379`), summary = same pointer (no Executive Summary in mission output); worktree removed at teardown (`poller.ts:564`) before the detached drain runs git (inferred → branch/commits null) | — | env `KAIROS_SESSION_ID`/`AEON_TASK_ID` injected (`poller.ts:309-314`) but dispatcher queues only stdin payload (`claude-session-capture-dispatch.mjs`, `session-capture-queue.mjs:378`) → lost. Worktree slug: `KAIROS_WORKTREE_ROOT=dev_26/.aeon-worktrees` (`runner.env.bat:18`); `repoSlugFromCwd` takes first segment after `/dev_26/` (`capture.mjs:109-114`) = `.aeon-worktrees`; next segment is the registry slug (`aeon`) not the folder name (`shadow_app_aeon`) that `dominion_repos`/`repoToProjectName` expect |
| POST /api/v1/memories/capture | `W/app/api/v1/memories/capture/route.ts` → captureMemory (`memories.ts:1054-1088`), source=webhook | — | streamClass not exposed | idea / 0.6 | only in-repo caller is a one-shot backfill script |
| Board auto-capture | `W/lib/kairos/auto-capture.ts:33-59` from UI actions only (board, boardBulk, fuse, assignees) | snapshot / achievement on complete | MCP task tools emit activityEvents (actor 'agent') but never captureBoardEvent → agent card moves never become memories; taskId only in sourceMetadata | idea until 23:00 reclass (`project-snapshot.ts:169-178`); achievements stay idea forever | backfill script matches `board_action`, writer uses `board_event` |
| Summariser | `~/.claude/settings.json:158-161` SessionEnd → `~/.claude/hooks/summarise-memories/summarise.ps1` → detached `claude -p --model claude-sonnet-4-6` → `list_memories_needing_summary`(12) + `update_memory {aiTitle, execSummary}` ×5 batches | aiTitle, execSummary | — | — | **No synthesis reader uses aiTitle/execSummary** (archetypes/micro/LAST-24H/briefer read title+summary; only `contradiction-prompt.ts:32` reads aiTitle). Claude-only trigger. Summarises micro-consolidate deltas (`observation` in `memories.ts:156-158`; log confirms). `update_memory` bumps updatedAt → resets confidence decay (machine enrichment counts as reinforcement) |

## B. Recency audit — readers disagree on "recent"

| Reader | Window |
|---|---|
| Chat LAST-24H (`chat-recency-context.ts:17-23,69-119,136-163`) | rolling 24h, ≤10 titles/category, 800-char cap (sessions render first, push out reflections/board) |
| Retrieval substrate (`retrieve.ts:46-61,279-301`) | 90d createdAt window; multiplier `1+0.3·exp(-d/14)` (comment says 14-day half-life; real half-life ≈ 9.7d) |
| prepareContext (`memories.ts:1853-1860,2061-2068`) | same formula |
| Confidence decay (`confidence.ts:27-80`) | 90d half-life on updatedAt, floor 0.5 |
| micro-consolidate (`micro-consolidate.ts:44-45,88-134`) | since max(last delta, today's cortex, UTC 00:00); newest 30 titles only |
| Archetypes (`archetypes.ts:54,94-101`) | 14d rolling, newest 80 (incl. traces/deltas/snapshots/advisories), title + summary cut to 200 (`archetypes-prompt.ts:55`) |
| Cortex/Aether "Today so far" (`cortex.ts:77-106`, `aether.ts:47-73`) | the NEW UTC day at 03:00 → **off by a day**; first delta lands 06:15 so they never see the day being consolidated |
| Briefer (`dominions.ts:258-281`, `briefer.ts:79-83`) | newest 25/Dominion, 15 rendered, no time window; overnight traces/delta/proposals compete for slots |
| Digest (`digest.ts:214-216`) | UTC calendar day, runs 18:00 → **18:00-24:00Z never counted**; prompt labels board counts "last 24h" (`digest-prompt.ts:43-44`) |
| Contradiction (`contradiction.ts:35`) | 7d |

Other confirmed bugs: 21:15-24:00Z activity never enters any delta (window resets at 00:00; last cron 21:15) · micro-consolidate stamps USER-WIDE board counts (incl. shared projects via `accessibleTo`) into every Dominion's delta (`micro-consolidate.ts:171-174`, `board-signals.ts:101-130`) · Voyage rerank orders the final top-5 by relevance only (`retrieve.ts:398-405`) so recency/confidence only pick the 12-row pool → the 07-24 recency miss can recur · vector-error fallback returns unranked `ftsRows.slice(0, SUBSTRATE_TOP_K)` (`retrieve.ts:411`) · `createdAt` = capture time not session time (backfill books yesterday as today) · briefer bundle + archetype pool include trace/delta meta-rows.

Visibility of something the operator does today: tonight's cortex NOT guaranteed (only via 02:30 archetypes, FK-filed, within newest-80); tomorrow's brief NOT guaranteed (newest-15); 18:00 digest as a count only if before 18:00Z; chat 1h later yes, title only.

## C. Proposed shape (design, no code yet)

**One session record** in `sourceMetadata.session` (v1), written by all clients AND the Hangar events route:
- identity {client, sessionId, externalId, hangarSessionId, taskId, projectId, repo (canonical folder slug), registrySlug, worktree:boolean}
- time {startedAt, endedAt, durationMin} → set `validAt` = endedAt so windows key on when work happened
- intent {firstPrompt ≤500, objective, cardName}
- outcome {status completed|needs_input|failed|abandoned, outcome, questions[]}
- delivery {branch (from transcript gitBranch), commits[{sha,subject}] parsed from Bash toolUseResult, prs[{number,url,action}] parsed from `gh` output}
- verify {tests{status,summary}} from test-command tool results or envelope.tests
- telemetry {model, inputTokens, outputTokens, cacheReadTokens, costUsd, linesAdded, linesRemoved, toolCalls{name:n}, errorCount}
- files ≤50
- title → `${repo}: ${cardName || aiTitle}`; summary → first execSummary bullet or envelope summary (the fields synthesis actually reads)

**Choke point:** `defaultStreamClass(source, type)` in `createMemory` when `input.streamClass` is undefined (replaces `memories.ts:886-887`): reflection→reflection · session_summary from claude/codex/copilot/hook→agentic (0.45), with hangarSessionId→execution (0.35) so the transcript row doesn't double-weight the mission memory · snapshot→snapshot · achievement/observation from system→execution · cron/import→execution · else idea. Add snapshot+aether to `CONFIDENCE_BY_STREAM`.

**Injection points (priority order, existing plumbing only):**
1. **Mission envelope → memory**: after `applied = await recordSessionResult(...)` at `events/route.ts:123` (only when `applied` non-null): `captureMemory(auth.id, {...})` then `attachSessionMemory(id, auth.id, memory.id)`. type session_summary, source system, class agentic, `sourceMetadata.kind:'hangar_mission'`, externalId `hangar:{sessionId}`; fold Flight Deck error/downgrade/warning counts; exclude engine `kairos-chat`. Digest gain: "3 missions landed: X (completed, aeon/1a2b pushed, tests passed), Y needs input: …, Z failed". 5-20/day.
2. **Session hook enrichment** (record above) in `buildPayload` (`capture.mjs:373-479`); dispatchers (claude/codex/copilot) copy `KAIROS_SESSION_ID`/`AEON_TASK_ID` into the job; set the `taskId` column; fix `repoSlugFromCwd` for `.aeon-worktrees` (map next segment via `apps/kairos-worker/repos.local.yaml` path basename) or hydrate server-side from agent_sessions. 15-25/day.
3. **Board rollup from activity_events** (already covers UI+MCP+REST, actor human/agent): read in micro-consolidate + digest as named items; optionally `captureBoardEvent` in MCP `tools/tasks.ts`.
4. **PR merged / prod deploy**: no GitHub/Vercel webhook route exists. Add a step to `.github/workflows/auth-smoke.yml` (deployment_status) + a pull_request closed workflow POSTing `/api/v1/memories/capture` channel `github`, externalId `gh:pr:{n}:merged` / `deploy:{sha}`. **Needs an `AEON_API_KEY` repo secret → owner sign-off.** Until then, #2 catches `gh pr create/merge` from tool output.
5. **Reader alignment**: summariser also writes `summary`; drop `observation` deltas from `SUMMARY_WORTHY_TYPES`; micro/archetype/chat/briefer prefer `aiTitle ?? title`; digest window rolling 18:00→18:00; cortex/aether "Today so far" reads the PREVIOUS UTC day's deltas; micro-consolidate final slot after 21:15 or window carry-over.

Unresolved: which client produced the 20 `.aeon-worktrees` rows (query `sourceMetadata->>'client'`); whether `dominion_repos` holds registry slugs; rerank-vs-recency impact (run `S/eval-retrieval.mjs` with/without Voyage key).
