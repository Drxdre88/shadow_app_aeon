# Architecture — AI Hangar + Aeon OS harness

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

Last updated: 2026-09-16 (PR #127 + the review-gate live-fire wave).

## 1. What it is

The **Hangar** turns a board card into an autonomous CLI-agent mission. A card carries
`metadata.hangar` (objective, repo, engine, model, instruction, autoRun). Launching writes an
`agent_sessions` row in `queued` (`lib/actions/hangar.ts` `spawnSessionFromCard`); a pull-mode
runner (`apps/kairos-worker`) claims it, creates a disposable git worktree, shells the engine CLI
(claude / copilot / codex), streams typed telemetry back as session events, and posts a terminal
**result envelope** (`lib/data/validators/hangar.ts` `hangarResultEnvelopeSchema`) that is folded
back onto the card.

**Aeon OS** (`aeon_os/`) is not another app: it is the production-verification harness that
proves the Hangar on the live API. `aeon_os/workflows/run.mjs` flies real card → session → worker →
result cycles against a dedicated production project, then `review.mjs` gates every attempt behind
an **independent-review PASS** from a different model. Plumbing success alone (`review_pending`) is
explicitly not "passed". Docs, receipts and handovers live under `aeon_os/` and `aeon_os/workflows/results/`.

## 2. Surfaces

| Surface | Detail | Files |
|---|---|---|
| Mission editor | Objective · repo (realm Hangar registry) · engine · **model picker** (per-engine catalogue + "Custom model ID") · instruction · auto-run; Save / **Save & Launch** | `components/board/MissionEditorModal.tsx`, `lib/hangar-models.ts` |
| Auto AI toggle | Project setting `settings.hangar.{enabled, triggerColumnId}`, owner-only; gates "Make AI card" / "Edit AI mission" in the card menu | `components/project/EditProjectModal.tsx`, `lib/actions/hangar.ts` `setHangarBoardSettings`, `lib/store/hangarUiStore.ts` |
| Drop-to-launch | Dragging into the trigger column launches only when the card's DB `autoRun` is true (client copy may be stale) | `lib/actions/hangar.ts` (`origin:'auto-drop'`) |
| Flight Deck | Live telemetry drawer + timeline for a session; Tower overlay | `components/kairos/flightdeck/FlightDeckDrawer.tsx`, `TowerOverlay.tsx`, `lib/flightdeck/timeline.ts` |
| REST | `POST /api/v1/sessions` (spawn: 201; **400** malformed `metadata.hangar`; **409** naming the live session when the card already has one), `GET` list, `GET/PATCH /sessions/[id]` (**404** on a non-uuid id), `POST /sessions/claim`, `/[id]/heartbeat`, `/[id]/kill`, `/[id]/events` (batch + single + result envelope) | `app/api/v1/sessions/**`, tests `sessions/__tests__/spawn-contract.test.ts`, `session-id-guard.test.ts` |
| MCP | `spawn_session`, `list_sessions`, `get_session`, `list_session_events`, `kill_session`, `claim_session`; registry: `register_hangar_repo`, `list_hangar_repos`, `update_hangar_repo`, `delete_hangar_repo` | `app/api/[transport]/tools/sessions.ts`, `tools/hangar.ts` |
| Server actions | `spawnSessionFromCard`, `saveCardMission`, `listProjectHangarRepos`, `listProjectColumnsForHangar`, `setHangarBoardSettings` | `lib/actions/hangar.ts` |
| Dispatch contract | The mission prompt names the `aeon-dispatch-contract` and `aeon-objective-<objective>` skills; those are **user-global** skills (`~/.claude/skills`), not in this repo | `lib/actions/hangar.ts` `buildDispatchPrompt` |

## 3. Runner — `apps/kairos-worker`

| Concern | Detail | File |
|---|---|---|
| Engines | claude: `-p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits [--model] [--effort] [--fallback-model]`; copilot: `-p <prompt> --allow-all-tools --no-ask-user --output-format json [--model]`; codex: `exec <prompt> --json [-o out] -s workspace-write -C <cwd> [-m]` | `src/engines.ts` |
| Claim / poll / heartbeat | `KAIROS_POLL_INTERVAL_MS` (15s), `KAIROS_HEARTBEAT_MS` (30s), `KAIROS_MAX_CONCURRENT`; argv from the DB held to `SAFE_ARG`; mission branches confined to the `MISSION_BRANCH_PREFIX` namespace so a mission can never push to an operator branch | `src/poller.ts` |
| Worktrees | `createWorktree` / `removeWorktree` per mission, per-repo lock, junction/symlink sweep, `pushBranch`, `deleteBranchIfEmpty`; Windows cwd-pinned teardown retried as a bounded whole-sequence retry (PR #127) | `src/worktree.ts` |
| Envelope | `extractEnvelope` scans fenced ```json blocks last-to-first, rejects the prompt's own template (`looksLikeEnvelope`), `normalizeEnvelope` canonicalises status aliases and NUL-sanitises for jsonb | `src/envelope.ts` |
| Stream parsers | claude + copilot typed events (tool_use / thinking / usage); copilot's fills `observedModel` from `session.start` so a mission records the model that actually ran, not "unknown" | `src/stream-parser.ts` |
| Env knobs | `KAIROS_MODE` (push/poll/both), `KAIROS_WORKER_PORT` (8787; harness uses 8799), `KAIROS_WORKER_SECRET`, `KAIROS_REPOS_FILE`, `KAIROS_WORKTREE_ROOT`, `KAIROS_{CLAUDE,COPILOT,CODEX}_BIN`, `KAIROS_*_DEFAULT_MODEL`, `AEON_BASE_URL`, `KAIROS_AEON_API_KEY` — creds in ignored `runner.env.bat` | `runner.env.example.bat`, `start-hangar-runner.bat` |
| CI | typecheck + test steps for the worker were added to `.github/workflows/ci.yml` on 2026-09-03 (shipped without a gate until then) | |

## 4. Data

| Table / shape | Key columns | Notes |
|---|---|---|
| `agentSessions` | `taskId` (Hangar rows; chat/dialogue rows share the table with `taskId` null), `engine`, `repo`, `branch`, `claimedBy/claimedAt`, `lastHeartbeatAt`, `status` ∈ queued · running · succeeded · failed · killed · timeout, `metadata.hangar` | `lib/db/schema.ts`; terminal = last four |
| One live per card | partial unique index `agent_sessions_one_live_per_task_idx` on `(task_id)` where status ∈ (queued, running) — the real 409 guard, enforced by Postgres across REST, MCP and drop-to-launch | migration `0033`, `lib/data/sessions.ts` `isOneLivePerTaskViolation` (coded 23505 only) |
| `hangarRepos` | `realmId`, `slug` (unique per realm), `gitUrl`, `ghSlug`, `defaultBranch`, `branchPrefix`, `allowedEngines`, `runCmd`/`envSetupCmd`/`appUrl`, `active` | realm-scoped registry; host paths stay on the runner (`repos.local.yaml`) |
| `metadata.hangar` | `objective`, `repo`, `agent`, `model`, `instruction`, `outputMode:'auto'`, `autoRun`, `sessionIds[]`, `lastResult` (system-written) | `lib/data/validators/hangar.ts` |
| Result envelope | `status`, `outcome`, `summary`, `branch`, `commit`, `artifacts[]`, `tests`, `questions[]`, `recommended_tasks[]`, `stats{}` | same file; `stats.model` feeds observedModel |

## 5. Aeon OS harness — `aeon_os/workflows/`

| Script | Proves |
|---|---|
| `run.mjs` — `preflight` · `prepare [--new]` · `run --count=N` · `review` · `status` · `stop` | The full production round-trip with an isolated local git origin, a one-claim bootstrap and a private worker. Mechanical validation = result event + succeeded session + card result + one report-only Conventional Commit off the prepared base + marker + ≥3 resolvable `path:line` citations + publication + worktree removal. Ends at **`review_pending`**, never `passed` |
| `review.mjs` | Dispatches an independent reviewer per attempt (`bootstrap.json.review`, copilot / gpt-5.6-sol; must differ from the mission model). **Whole prompt piped on stdin, `-p` never passed** (Copilot ignores piped input when `-p` is present — proven live 16 Sept). **Receipt token**: a random per-dispatch uuid placed only on the last line of the bundle must be echoed in the verdict, else NOT REVIEWED. Provenance from `--usage-output-file` (`currentModel` / `modelMetrics`), raw usage kept in the record. `MAX_PROMPT_CHARS = 110_000` (largest measured delivery 118,754). Sandbox: throwaway cwd outside the tree, `--deny-tool` shell/write/url, `--secret-env-vars`, process tree killed on timeout |
| `review-bundle.mjs` | The reviewer package: report + every citation resolved to its real source line at the pinned revision. `extractCitations` expands shorthand continuations (`file.ts:173, :187, and :234`) with a clause guard against attaching to a different file |
| `prod-acceptance.mjs` | 15 checks against production REST (15/15 since 16 Sept): 404/400/409 contracts, concurrent-launch race, teardown |
| `verify-ui.mjs` | Focused Vitest contracts ×10 (no browser) |
| `review-gate.test.mjs` | 56 synthetic gate tests, no reviewer dispatched |

**Gate rules.** `passed` only when every attempt carries a stored verdict of exactly `PASS`; any
`PASS_WITH_CORRECTIONS` / `FAIL` → run `failed`, receipt kept. Terminal runs are immutable: `review`
refuses them, `run --count` refuses to reopen them, `prepare --new` archives (`review_pending` →
`abandoned:true`). `review --import` never overwrites without `--force` and **never** replaces a
stored non-PASS with a PASS. A stored record naming a different report marker than its attempt counts
as unreviewed. A FAIL caused by a harness fault stays a FAIL — fix the harness and prepare a new run.

**Receipts.** `results/<runId>/` (`run.json`, `attempt-NN.json`, `reports/`, `reviews/NN.json` +
`NN.raw.txt` + `NN.bundle.md` + error sidecars) are committed and never edited; `results/ui-*/`
holds UI evidence. Runtime state under ignored `.runtime/`.

**16 Sept live-fire.** Three runs: `86cdc5` (mission cited lines past the end of a file → mechanical
fail), `0f2824` (reviewer judged an empty message → harness-artefact FAIL, kept), `24c870` (first
legitimate verdict: FAIL with 10 findings, three confirmed citation drift by hand). Browser Save &
Launch exercised the same day (`results/ui-2026-09-16-browser/`).

## 6. Known gaps

| Severity | Gap | Where |
|---|---|---|
| Medium | ~45 more `/api/v1/**/[id]` routes pass raw path segments to Postgres (same 500 class as the fixed projects/sessions routes) — needs a shared uuid guard | `app/api/v1/**` |
| Medium | Spawn has no project-membership check on `taskId`; a caller can spawn against a foreign card and `recordSessionResult` later rewrites it | `lib/data/sessions.ts` |
| Medium | Objective-completion contract: `implement` / `bug_fix` can reach `completed` with no branch, commit or artifacts (acceptance check 14 standing risk) | `lib/data/validators/hangar.ts` |
| Low | A project in no realm cannot launch from the browser (repo registry is realm-scoped; editor shows the amber "No repos" hint) while REST accepts any slug; the harness's own test project is created realm-less | `lib/actions/hangar.ts` `listProjectHangarRepos` |
| Low | All three engines receive the mission prompt via `-p`; a prompt over ~32k chars would hit the Windows argv cap (the reviewer already moved to stdin for this reason) | `apps/kairos-worker/src/engines.ts` |
| Low | Mission-side: 3/3 real sonnet-5 recon reports drifted on test-file line numbers; whether to tighten `missionPrompt` or leave it to the gate is undecided | `aeon_os/workflows/run.mjs` |
