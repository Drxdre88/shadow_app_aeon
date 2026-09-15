# Beacon: Aeon agent models and production workflow verification

**Date:** 2026-09-11  **Repo:** shadow_app_aeon  **Branch:** feat/member-avatar-styling
**Last commit:** 3b7b3f3 chore: merge main (v0.26.1) into feat/member-avatar-styling; keep 0.27.0 above 0.26.1 in the changelog
**Status:** Model correction and UI verified locally; NOT deployed. Production workflow acceptance remains incomplete.

## Goal
Prove real Aeon research missions from launch through committed report delivery and cleanup, verify the launch UI ten times, and establish readiness before release.

## User direction and authorization
- Use existing **production REST at https://aeon.shadow-lab.ai**, not Aeon MCP or a new local launch API. A proposed API implementation was abandoned without source edits.
- User authorized real research jobs, isolated research branches/worktrees, report-only commits, and model reconfiguration. Main collaborating agents share the existing checkout; preserve all pre-existing edits.
- Test publication targets an isolated LOCAL bare Git origin. No GitHub push, application commit, merge or deployment was performed or authorized as part of these tests.
- User prefers **Claude Sonnet 5**, with **GPT-5.6 Sol** an acceptable alternative. No silent fallback.
- Read repository AGENTS.md/CLAUDE.md. Workstream Hangar Sprint 3 was already Live; do not infer completion or move coarse board cards from general test progress.

## Completed locally
- Fixed ignored `apps/kairos-worker/runner.env.bat:12`: `KAIROS_COPILOT_DEFAULT_MODEL=claude-sonnet-5`. Previous `claude-sonnet-5.6` was invalid; tracked `src/engines.ts` and the env example already had the correct default. No other saved runner settings changed.
- Authenticated Copilot `models.list` verified 16 usable models, including Sonnet 5, Opus 5 and GPT-5.6 Sol/Terra/Luna. No MCP/CLI upgrade needed. Copilot 1.0.83 reported current; Claude Code 2.1.267; Codex CLI 0.153.4.
- `apps/web/src/lib/hangar-models.ts`: dated presets (16 Copilot, four Claude, six Codex). Claude presets use official API IDs; Codex presets were checked with `codex debug models`. This is a snapshot, NOT live UI entitlement discovery.
- `MissionEditorModal.tsx`: engine presets, Runner default, retained custom IDs, incompatible-model reset on engine change, and fail-closed pending/error/missing-repository gates.
- New component/handler/action tests live in the three untracked `__tests__` files listed by `git status`. Correctness review passed after fixing repository-loading gates.
- Final UI verification: **10/10 rounds, 48 checks each**; web typecheck, focused ESLint and nine worker engine tests passed. Record: `workflows/results/ui-2026-09-10T16-28-43-918Z/summary.json`. Do not repeat ten rounds unless UI changes justify it.
- `workflows/run.mjs` is a reusable real production harness. `probe-copilot-models.mjs` queries authenticated CLI availability without generation and rejects unavailable configured models before creating jobs.
- Updated worker README and one stale model paragraph in the pre-existing `docs/aeon-flight-manual-0709.html`. Original `aeon_os/summary.md`, overview and flight manual are user handover assets; preserve them.

## Production evidence — measured 10 September
- Dedicated project: https://aeon.shadow-lab.ai/project/e4b0af95-d3ad-46ba-8275-1ecc28911683
- Six attempts retained: **one complete transport PASS, five failures; four research commits delivered**. Full indexed receipts: [workflows/verification.md](workflows/verification.md).
- Earlier failures: Windows long paths before CLI launch (fixed only in test clones with `core.longpaths=true`); invalid model; actual locked checkout; missing mandatory envelope `summary` (API correctly rejected it).
- Latest run: `2026-09-10T16-37-07-347Z-4eb7a5`; runtime state at `workflows/.runtime/state.json`; durable receipts under `workflows/results/<runId>/`.
- Job 1 PASS: session `6d3bb38e-fbc9-4068-8b2e-1f2a72c84acc`, branch `aeon/4d584a8b`, commit `b8af1ccde7509df0fcc84bfe04b7ae729f6fa44d`. Verified report-only diff, accepted result/card Landing, physical cleanup and retrieval after worker shutdown.
- Job 2 FAIL: session `f215b5aa-1b60-471f-a25e-5a774ecbd781`, branch `aeon/121c5001`, commit `72e585848e455573511b37890dbb66c1a1c784fc`. Process/session succeeded and report delivered; physical checkout remained with Windows EBUSY. Jobs 3–10 were NOT launched.
- Independent review of passing report: three supported findings, **PASS_WITH_CORRECTIONS**. Exact citations are inaccurate; one finding conflates user authorization with row-lock concurrency. Notes in `attempt-01.json`; original report/commit unchanged. NOT accepted into durable knowledge.
- Model explicitly requested was Sonnet 5; provider identity absent from envelope is recorded `unknown`. Do not relabel requested identity as observed telemetry.

## Immediate blocker and next work
- [ ] Reproduce and fix bounded Windows cleanup in `apps/kairos-worker/src/worktree.ts` around `destroyLocked` (~439–457), preserving junction/reparse-point safeguards. Add a focused Windows handle test.
- Confirmed: directory removal has short retries, rename only one attempt, and `removed:false` is not retried. The exact historical locker was NOT observed; do not claim a known orphan PID or antivirus cause.
- Disabling Playwright/Aeon/built-in MCP in test processes did NOT eliminate EBUSY. Known worker/shell/Copilot processes had exited in the diagnosed case; no global integration was changed.
- Git deliberately retains prunable registrations for ten minutes. Harness now checks physical absence and only tolerates the exact absent-path registration marked prunable. Do NOT mistake a stale registration for a retained directory or loosen real cleanup acceptance.
- The prompt now supplies an explicit canonical JSON envelope including mandatory summary. Invalid envelopes stay failures; never repair historical results into passes.
- [ ] After a real cleanup repair and relevant checks, archive the failed run with `prepare --new`, prove a fresh single job, then resume the ten-job target. Preserve failure receipts and independently review delivered content.

## Boundaries that remain open
- Generic REST session creation bypasses the UI launch action's registry/arming/history/disarm checks. Backend passes do NOT certify clicking Save & Launch.
- Hosted browser only reached login. Authenticated UI launch, reload/result display and operator visual acceptance remain NOT RUN; picker source is not deployed.
- Known separate gaps: queued session survives a failed subsequent launch-history/disarm write; result-event insertion/application retry gap; lease/crash recovery; general publish permission; exact-revision review. See [test_readiness.md](test_readiness.md).
- Earlier default worker suite: 138 pass, four timeouts plus Windows EPERM cleanup; isolated worktree tests passed with 30-second limits. Do not call the default baseline repaired.

## Resume commands and operational context
- Last checked 10 September: test runner port **8799 stopped**, state worker null. Recheck now; do not kill unrelated sessions/processes. Normal launcher uses 8790, not 8787.
- Credentials are in ignored `apps/kairos-worker/runner.env.bat`; parse only needed literal SET keys, never print/copy credentials. Harness uses verified system CAs; inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` must not leak into test calls.
- From repository root: `$env:NODE_TLS_REJECT_UNAUTHORIZED='1'; node --use-system-ca aeon_os/workflows/run.mjs status`
- Then read-only availability: `node --use-system-ca aeon_os/workflows/run.mjs preflight` and `node --use-system-ca aeon_os/workflows/probe-copilot-models.mjs`.
- After fixing cleanup: `node --use-system-ca aeon_os/workflows/run.mjs prepare --new`, then `run --count=1`, then `run --count=10` (same script prefix). Failed runs intentionally refuse continuation.
- Test-only one-claim bootstrap checks the expected session and blocks later claims; the first production claim is still account-wide. Check competing card jobs and read containment limits in [workflows/README.md](workflows/README.md).
- All application changes remain uncommitted. `.runtime/` is ignored and retains local origins/checkouts; no cleanup is required to start the new session.

**First action:** Read `aeon_os/workflows/verification.md` and inspect `destroyLocked` in `apps/kairos-worker/src/worktree.ts`; implement and prove the bounded Windows cleanup repair before launching more jobs.
