# Aeon OS: supervised pilot readiness

**Updated 10 September 2026 (1009).** Branch `feat/member-avatar-styling`, research base revision `3b7b3f3`. Model correction and model-picker implementation are verified locally. Production testing achieved one complete transport pass; batch expansion stopped on a repeated Windows cleanup failure. See the [current verification results](workflows/verification.md), [model configuration](workflows/models-1009.md), [repeatable workflow](workflows/README.md), and [acceptance scope](workflows/acceptance.md).

The sections below preserve the earlier preparation assessment. Their statements that no mission had launched describe that earlier check, not current state. The operator subsequently authorized isolated research branches and report commits, and directed the tests to the existing production service through REST. Read with [direction](summary.md), [overview](aeon_os_overview.html), and the [flight manual](../docs/aeon-flight-manual-0709.html#flight-tests).

## Recommendation and current evidence

Prepare one supervised **transport-only** flight, followed by the human-question canary. These test dispatch and result delivery. They do not establish the secretary, durable research delivery, independent review, or unattended operation. Keep mission concurrency at one for the pilot.

| Check | Observed result | What it establishes |
|---|---|---|
| Worker typecheck | PASS | Current worker source typechecks |
| Web Hangar suites | PASS: 149 tests across validators, claims/results and API parity | Local validation and mocked/source-level contracts; not live database races |
| Worker default suite | 138 passed, 4 timed out; cleanup hook failed with Windows `EPERM` | Default worker baseline is not green; see diagnostic rerun below |
| Worktree diagnostic rerun | PASS: 27 tests and cleanup, isolated with 30-second limits | Assertions pass with more time; does not establish the cause or fix the default timeout/cleanup failure |
| Local health, `localhost:8787/health` | Timed out after 3 seconds | Runner availability unknown; does not prove all runners are off |
| Calling user's account-wide queued/running sessions | No card-linked sessions; 8 chat/dialogue rows | No eligible card backlog observed at check time; repeat immediately before launch |
| Tool discovery | Node 24.13.0, npm 11.6.2; three CLI commands resolved | Presence only; sign-in, model access, entitlement and provider identity unverified |

The first web command accidentally selected the full suite because its npm script chains two commands. That run was stopped; only the explicit 149-test run above is a completed web result. No application boot or live persistence exercise was performed.

## Source-confirmed gaps

| Gap | Current source evidence | Acceptance before expansion |
|---|---|---|
| Artifact retention | `apps/kairos-worker/src/poller.ts:539–543, 603`; `worktree.ts:398–445`: cleanup removes the mission checkout; result stores paths, not report bodies | Retrieve full promised artifact after cleanup and runner stop; compare content/hash; unavailable delivery prevents objective completion |
| Publication permission | `poller.ts:584–603`: teardown pushes when the mission added commits; no publication authorization check here | Enforced no-push policy, tested even when a mission created a commit; separate explicit publish permission |
| Completion and questions | `apps/web/src/lib/data/sessions.ts:223–258`; worker `envelope.ts:40–47`: `needs_input` can yield session `succeeded` | Blocker stays visible; objective remains unfinished until resolved and accepted |
| Board mapping | `sessions.ts:22–26, 207–219`: `Landing` / `Tower`, only for Hangar-mode boards, rather than Mission Control's `Landing Zone` / `Live` | Configured mapping; never infer Done from process exit or a single attempt |
| Objective acceptance | `apps/web/src/lib/data/validators/hangar.ts:129`: generic envelope; artifacts/commit/tests optional | Objective-specific required outputs and review receipt tied to delivered revision; changed revision invalidates approval |
| Result retry gap | `apps/web/src/app/api/v1/sessions/[id]/events/route.ts:84–106`: event insertion precedes result application; same-sequence replay skips application | Inject failure after event insertion, retry, and prove the card receives its result exactly once; current source indicates a recovery defect, not yet runtime-reproduced |
| Isolation policy | Runner creates mission worktrees; active delegation instructions require one checkout | Record an explicit Hangar pilot exception or implement an approved alternative before launch; concurrency one does not resolve this |

These are source findings, not newly reproduced live incidents. A green local suite does not close them. Existing session capture is a separate path: eventual outcome-to-memory acceptance needs the actual persisted memory ID and a retrievable link to the accepted result.

## First live session: launch gates and order

1. Record the approved test repository/base revision, disposable card, engine/model, one-attempt limit, time/cost ceiling, and operator. Resolve the worktree-policy exception. This preparation does not grant it.
2. Inspect account-wide queued/running sessions across all projects and identify eligible runners on every host. The worker is not restricted to the visible board. Do not cancel unrelated sessions.
3. Inspect the target repo registry and local launcher settings without copying secrets into evidence. Confirm host path/base branch, no setup command, no unnecessary copied credentials/shared dependencies, concurrency one, and authenticated CLI/model access. Do not treat instructions such as “no push” as runner enforcement.
4. Use a fresh disposable test card with no branch override, separate from the coarse workstream card. Keep auto-run off. Paste the self-contained no-file handshake from the manual, including its explicit exception to the usual Recon report requirement. The mission starts from the registered base branch and cannot see this checkout's untracked handover files. Observe automatic session/board writes as part of the declared test.
5. Run **T01 → T02 → T03**: save without dispatch; queue with all eligible runners off and reject duplicate launch; cancel while queued. Reload after each action and prove the exact session count/status. If an unexpected worker claims anything, stop the sequence and identify it.
6. Recheck the queue; start only the authorized runner. Run **T04**, then **T05** on a separate attempt: unique handshake marker reaches the correct card; the question envelope contains one blocker and starts no follow-on work. Record both process/session status and objective disposition. `succeeded` alone is not a pass for completion.
7. After evidence review, exercise **T06** one-shot drop launch on the test board. Keep **T07–T10**, secretary routing, research acceptance and five-objective batches gated until their prerequisites are met. Confirm idle/no active child before stopping the runner.

For each attempt save: test ID/unique marker; UTC times; card/session/worker IDs; requested engine/model and observed identity (unknown when absent); scope/permission record; repo/base/delivered revision; raw result and event references; observed branch/publication/cleanup outcome; artifact reference/hash if applicable; reviewer/operator verdict; limitations. Use `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN` explicitly. Export the manual's browser logbook; it is self-reported local storage, not the durable mission record.

## Next implementation tests, in order

| Owner / scope | Behavior to prove |
|---|---|
| Runner delivery + result storage | Capture a report before deletion; retain it on callback failure; retry with stable IDs; duplicate delivery has one effect; report retrieval survives process loss |
| Runner publication + server acceptance | No-push enforced; failed/missing tests and absent required deliverables cannot complete the objective; review applies only to the delivered revision |
| Claims/recovery + board workflow | Worker loss/expired ownership cannot create two accepted writers; stale workers cannot finalize; bounded retries; cancellation waits for child termination; configured review/blocker columns |
| Secretary + research + memory | Fresh turn resumes recorded scope/approval; quota exhaustion blocks without paid fallback; proposals do not dispatch; rejected findings stay out of accepted knowledge; accepted result has a retrievable memory link |

## Repeatable local commands

From the repository root:

```powershell
npm run typecheck --workspace=apps/kairos-worker
npm run test --workspace=apps/kairos-worker
Push-Location apps/web
node ../../node_modules/vitest/vitest.mjs run src/lib/data/__tests__/validators-hangar.test.ts src/lib/data/__tests__/sessions-claim.test.ts src/app/api/__tests__/sessions-parity.test.ts --maxWorkers=1 --minWorkers=1
Pop-Location
```

Worker tests create disposable local Git repositories and child Node processes; callbacks are mocked and these tests do not dispatch a model mission. The claims suite uses mocked database operations, so real concurrent claims remain a later controlled integration test. Do not pass filters through `npm run test --workspace=apps/web -- ...`: they reach the second chained command, leaving Vitest unfiltered.

Diagnostic rerun: `node ../../node_modules/vitest/vitest.mjs run src/worktree.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=30000 --hookTimeout=30000` from `apps/kairos-worker`. **27/27 passed, including cleanup**, in 55.31 seconds; individual Git cases took up to 13.86 seconds. This is a diagnostic timeout override, not a repository configuration change. Default-run failures were failed-add cleanup, empty-branch deletion, copied-env exclusion and already-ignored copy, plus the cleanup hook. No claim that the default suite is repaired.

The failed run left `%TEMP%/aeon-worktree-test-0iRWzc`. Automatic approval review rejected its subsequent scoped cleanup with “blocked by policy”; the directory was left in place.

**Status:** test preparation complete; live pilot remains NOT RUN. No runner/model/service configuration, application code, board state, repository commits or publication changed by this preparation. Temporary test repositories contain fixture commits only.
