# Architecture — AI Hangar + Aeon OS harness

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

Last updated: 2026-09-21 (v0.29.0 release candidate; mission-card and repository UI, runner tier forwarding). Full production acceptance baseline: 17 September, PR #129. Supervised production research evidence: 21 September; deployment tracked in PR #130.

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

Mission cards are distinguished by `boardTasks.metadata.hangar`, not by `repo:*` or
`obj:*` labels. They share board placement, members and priority with ordinary tasks,
but have their own face and mission section. The original blueprint's bespoke UI was
only partially delivered before this wave; no new task table or migration is needed.

| Surface | Detail | Files |
|---|---|---|
| Mission editor | Objective · repo (realm Hangar registry) · engine · **model picker** (per-engine catalogue + "Custom model ID") · instruction · auto-run; **Save draft** (incomplete allowed, no execution) / **Save & Launch** (complete mission required) | `components/board/MissionEditorModal.tsx`, `lib/hangar-models.ts` |
| Mission card | Dedicated Agent mission identity and labelled configuration; mission details and cached result displayed ahead of task organization. Cached result is not proof of current execution or publication | `components/board/MissionCardFace.tsx`, `MissionDetailsSection.tsx`, `MissionResultSection.tsx`, `TaskEditContent.tsx`, `autoRun.ts` |
| Repositories | Board toolbar opens the realm-scoped directory and add/edit/retire controls; realm permissions apply. Registration does not configure host-local paths | `components/board/HangarRepositories.tsx`, `lib/actions/hangar-repositories.ts` |
| Auto AI toggle | Project setting `settings.hangar.{enabled, triggerColumnId}`, owner-only; gates new mission creation/conversion and drop launch; existing missions remain configurable and explicitly launchable. New missions retain their draft type when configuration is cancelled | `components/project/EditProjectModal.tsx`, `components/board/QuickAddTask.tsx`, `lib/actions/hangar.ts`, `lib/store/hangarUiStore.ts` |
| Drop-to-launch | Crossing into the trigger column launches only a complete mission when Auto AI is enabled and the card's DB `autoRun` is true; defaults off and disarms on launch | `lib/actions/hangar.ts` (`origin:'auto-drop'`) |
| Flight Deck | Live telemetry drawer + timeline for a session; Tower overlay | `components/kairos/flightdeck/FlightDeckDrawer.tsx`, `TowerOverlay.tsx`, `lib/flightdeck/timeline.ts` |
| REST | `POST /api/v1/sessions` (spawn: 201; **400** malformed `metadata.hangar`; **409** naming the live session when the card already has one), `GET` list, `GET/PATCH /sessions/[id]` (**404** on a non-uuid id), `POST /sessions/claim`, `/[id]/heartbeat`, `/[id]/kill`, `/[id]/events` (batch + single + result envelope) | `app/api/v1/sessions/**`, tests `sessions/__tests__/spawn-contract.test.ts`, `session-id-guard.test.ts` |
| MCP | `spawn_session`, `list_sessions`, `get_session`, `list_session_events`, `kill_session`, `claim_session`; registry: `register_hangar_repo`, `list_hangar_repos`, `update_hangar_repo`, `delete_hangar_repo` | `app/api/[transport]/tools/sessions.ts`, `tools/hangar.ts` |
| Server actions | `spawnSessionFromCard`, `saveCardMission`, `listProjectHangarRepos`, `listProjectColumnsForHangar`, `setHangarBoardSettings` | `lib/actions/hangar.ts` |
| Shared mission status | Project members can poll the exact card/session status, including another member's run; the action returns only identifiers and status. Generic session/transcript access remains user-scoped | `lib/actions/sessions.ts` `getMissionSessionStatusAction`, `lib/data/sessions.ts` `findMissionSessionStatus` |
| Dispatch contract | The mission prompt names the `aeon-dispatch-contract` and `aeon-objective-<objective>` skills; those are **user-global** skills (`~/.claude/skills`), not in this repo | `lib/actions/hangar.ts` `buildDispatchPrompt` |

## 3. Runner — `apps/kairos-worker`

| Concern | Detail | File |
|---|---|---|
| Engines | claude: `-p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits [--model] [--effort] [--fallback-model]`; copilot: `-p <prompt> --allow-all-tools --no-ask-user --output-format json [--model] [--reasoning-effort] [--context]` (knobs `KAIROS_COPILOT_EFFORT` / `KAIROS_COPILOT_CONTEXT`, passed on argv because the CLI does not restore `contextTier` from settings at startup); codex: `exec <prompt> --json [-o out] -s workspace-write -C <cwd> [-m]` | `src/engines.ts` |
| Trust + tier | Host configuration must put worktrees under a trusted development directory for repository instructions/skills. Local owner configuration selects `claude-opus-5` / `xhigh` / `long_context`; the adapter fallback remains `claude-sonnet-5`, with optional effort/context. Reviewer configuration selects `gpt-5.6-sol` / `high` / `long_context`. Installed CLI flags were probed on 21 September; configuration is distinct from a live mission receipt. On 21 September the authenticated account offered Sonnet 5 but neither configured Opus 5 nor Sol; no automatic substitute is made | `runner.env.bat`, `src/engines.ts`, `aeon_os/workflows/bootstrap.json` |
| Claim / poll / heartbeat | `KAIROS_POLL_INTERVAL_MS` (15s), `KAIROS_HEARTBEAT_MS` (30s), `KAIROS_MAX_CONCURRENT`; argv from the DB held to `SAFE_ARG`; mission branches confined to the `MISSION_BRANCH_PREFIX` namespace so a mission can never push to an operator branch | `src/poller.ts` |
| Worktrees | `createWorktree` / `removeWorktree` per mission, per-repo lock, junction/symlink sweep, `pushBranch`, `deleteBranchIfEmpty`; Windows cwd-pinned teardown retried as a bounded whole-sequence retry (PR #127) | `src/worktree.ts` |
| Envelope | `extractEnvelope` scans fenced ```json blocks last-to-first, rejects the prompt's own template (`looksLikeEnvelope`), `normalizeEnvelope` canonicalises status aliases and NUL-sanitises for jsonb | `src/envelope.ts` |
| Stream parsers | claude + copilot typed events (tool_use / thinking / usage); copilot's fills `observedModel` from `session.start` so a mission records the model that actually ran, not "unknown" | `src/stream-parser.ts` |
| Env knobs | `KAIROS_MODE` (push/poll/both), `KAIROS_WORKER_PORT` (8787; harness uses 8799), `KAIROS_WORKER_SECRET`, `KAIROS_REPOS_FILE`, `KAIROS_WORKTREE_ROOT`, `KAIROS_{CLAUDE,COPILOT,CODEX}_BIN`, `KAIROS_*_DEFAULT_MODEL`, `KAIROS_COPILOT_EFFORT`, `KAIROS_COPILOT_CONTEXT`, `KAIROS_CLAUDE_EFFORT`, `KAIROS_CLAUDE_FALLBACK_MODEL`, `AEON_BASE_URL`, `KAIROS_AEON_API_KEY` — creds in ignored `runner.env.bat` | `runner.env.example.bat`, `start-hangar-runner.bat` |
| Availability | Foreground launcher resolves its environment file by absolute script path and calls npm. Polling lasts only while the host process runs; no checked-in supervisor/autostart or stale-session reconciler | `start-hangar-runner.bat`, `src/index.ts`, `src/poller.ts` |
| CI | typecheck + test steps for the worker were added to `.github/workflows/ci.yml` on 2026-09-03 (shipped without a gate until then) | |

## 4. Data

| Table / shape | Key columns | Notes |
|---|---|---|
| `agentSessions` | `taskId` (Hangar rows; chat/dialogue rows share the table with `taskId` null), `engine`, `repo`, `branch`, `claimedBy/claimedAt`, `lastHeartbeatAt`, `status` ∈ queued · running · succeeded · failed · killed · timeout, `metadata.hangar` | `lib/db/schema.ts`; terminal = last four |
| One live per card | partial unique index `agent_sessions_one_live_per_task_idx` on `(task_id)` where status ∈ (queued, running) — the real 409 guard, enforced by Postgres across REST, MCP and drop-to-launch | migration `0033`, `lib/data/sessions.ts` `isOneLivePerTaskViolation` (coded 23505 only) |
| `hangarRepos` | `realmId`, `slug` (unique per realm), `gitUrl`, `ghSlug`, `defaultBranch`, `branchPrefix`, `allowedEngines`, `runCmd`/`envSetupCmd`/`appUrl`, `active` | realm-scoped registry; host paths stay on the runner (`repos.local.yaml`) |
| `metadata.hangar` | `objective`, `repo`, `agent`, `model`, `instruction`, `outputMode:'auto'`, `autoRun`, `sessionIds[]`, `lastResult` (system-written) | `lib/data/validators/hangar.ts` |
| Result envelope | `status`, `outcome`, `summary`, `branch`, `commit`, `artifacts[]`, `tests`, `questions[]`, `recommended_tasks[]`, `stats{}` | same file; `stats.model` feeds observedModel |

**Completion is a claim, not publication proof.** `enforceObjectiveDeliverables`
(shipped in PR #129) downgrades `implement`/`bug_fix` results with no branch+commit
and no artifact paths to `needs_input`. The runner stamps a locally-ahead branch/HEAD
before posting. Push happens afterward; failure emits an event without revising the
accepted result. Artifact paths alone do not preserve file contents.

**Column movement.** Completed missions target `Landing`; `needs_input` targets
`Tower`, matching existing column names case-insensitively. Both the UI's
`settings.hangar.enabled=true` and legacy `settings.boardMode='hangar'` enable this
mapping. Missing destination columns and failed missions keep their current column.
Landing/Tower are review states: automation never marks a card Done; final Done is an operator action. Priorities and checklists do not schedule or launch missions. Process success and card movement do not imply an independent-review PASS.

## 5. Aeon OS harness — `aeon_os/workflows/`

| Script | Proves |
|---|---|
| `run.mjs` — `preflight` · `prepare [--new]` · `run --count=N` · `review` · `status` · `stop` | The full production round-trip with an isolated local git origin, a one-claim bootstrap and a private worker. Mechanical validation = result event + succeeded session + card result + one report-only Conventional Commit off the prepared base + marker + ≥3 resolvable `path:line` citations + publication + worktree removal. Ends at **`review_pending`**, never `passed` |
| `review.mjs` | Dispatches an independent reviewer per attempt (`bootstrap.json.review`, copilot / gpt-5.6-sol; must differ from the mission model). **Whole prompt piped on stdin, `-p` never passed** (Copilot ignores piped input when `-p` is present — proven live 16 Sept). **Receipt token**: a random per-dispatch uuid placed only on the last line of the bundle must be echoed in the verdict, else NOT REVIEWED. Provenance from `--usage-output-file` (`currentModel` / `modelMetrics`), raw usage kept in the record. `MAX_PROMPT_CHARS = 110_000` (118,754 was an external delivery probe; the product gate rejects more than 110,000). Sandbox: throwaway cwd outside the tree, `--deny-tool` shell/write/url, `--secret-env-vars`, process tree killed on timeout |
| `review-bundle.mjs` | The reviewer package: report + every citation resolved to its real source line at the pinned revision. `extractCitations` expands shorthand continuations (`file.ts:173, :187, and :234`) with a clause guard against attaching to a different file |
| `prod-acceptance.mjs` | 15 checks against production REST (15/15 since 16 Sept): 404/400/409 contracts, concurrent-launch race, teardown |
| `verify-ui.mjs` | Focused Vitest contracts ×10 (no browser) |
| `review-gate.test.mjs` | Synthetic gate and argv tests run in CI; no reviewer dispatched by the suite |

**Gate rules.** `passed` only when every attempt carries a stored verdict of exactly `PASS`; any
`PASS_WITH_CORRECTIONS` / `FAIL` → run `failed`, receipt kept. Terminal runs are immutable: `review`
refuses them, `run --count` refuses to reopen them, `prepare --new` archives (`review_pending` →
`abandoned:true`). `review --import` never overwrites without `--force` and **never** replaces a
stored non-PASS with a PASS. A stored record naming a different report marker than its attempt counts
as unreviewed. A FAIL caused by a harness fault stays a FAIL — fix the harness and prepare a new run.

**Receipts.** `results/<runId>/` (`run.json`, `attempt-NN.json`, `reports/`, `reviews/NN.json` +
`NN.raw.txt` + `NN.bundle.md` + error sidecars) are committed and never edited; `results/ui-*/`
holds UI evidence. Runtime state under ignored `.runtime/`.

**Recorded live evidence.** The 16 September signed-in browser check queued a mission,
then killed it; completed research execution was proven in separate runs. The best
stored independent review is `PASS_WITH_CORRECTIONS` with four minor findings
(`08668a`), which remains failed under the exact-PASS gate. PR #129's 17 September
handover records 15/15 production acceptance plus successful auth smoke. These are
dated receipts, not proof that the current workstation runner is online.

## 6. Known gaps

**21 September production Swarm exercise:** a real Sonnet 5 mission claimed the
Swarm checkout, discovered its native project skills, read production data, wrote
canonical HTML and automatically reached Landing. Its research failed supervisor
review (country casing, state semantics and missing fresh evidence); a correction
run also failed content acceptance and was stopped. The supervisor completed the
report from independent read-only extracts. Kill propagation and mission worktree
cleanup were observed. This proves supervised backend execution and confirms that
automatic Landing does not enforce content acceptance. The v0.29.0 UI is a release candidate in PR #130; authenticated browser acceptance is still outstanding. Receipt:
[PRODUCTION_SWARM_2109.md](../aeon_os/PRODUCTION_SWARM_2109.md).

| Severity | Gap | Where |
|---|---|---|
| Medium | ~45 more `/api/v1/**/[id]` routes pass raw path segments to Postgres (same 500 class as the fixed projects/sessions routes) — needs a shared uuid guard | `app/api/v1/**` |
| Medium | Spawn has no project-membership check on `taskId`; a caller can spawn against a foreign card and `recordSessionResult` later rewrites it | `lib/data/sessions.ts` |
| Medium | Durable output delivery remains incomplete: uncommitted artifacts can be lost at teardown, push failure is separate from accepted result status, and vault/RAG delivery plus automatic draft PR creation are not implemented | `apps/kairos-worker/src/poller.ts`, `worktree.ts`; Sprint 3C |
| Medium | Runner supervision and stale-session recovery are not implemented; a queued mission can wait while the host is offline | `apps/kairos-worker/src/index.ts`, `poller.ts` |
| Low | A project in no realm cannot launch from the browser (repo registry is realm-scoped; editor shows the amber "No repos" hint) while REST accepts any slug; the harness's own test project is created realm-less | `lib/actions/hangar.ts` `listProjectHangarRepos` |
| Info | Full mission instructions travel in a temporary brief file, with a short pointer on argv; finalisation deletes the brief. Reviewer prompts use stdin | `apps/kairos-worker/src/poller.ts`, `engines.ts` |
| Low | No exact-PASS autonomous harness research receipt yet; the 21 September supervisor-completed report has a separate saved-evidence audit PASS. Citation rules were tightened in PR #129; latest recorded best verdict still requires minor wording corrections | `aeon_os/HANDOVER_1709.md` |
