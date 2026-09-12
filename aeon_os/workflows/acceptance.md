# Aeon OS workflow acceptance — 1009

The operator authorized ten real Aeon test jobs, repository research, isolated research branches and a repeatable workflow folder on 10 September 2026. Research agents may commit only their assigned report. Runner publication targets an isolated **local Git remote**. This does not authorize GitHub publication, merge or production deployment.

## What this exercise proves

Each job must become a queued session through production Aeon's existing REST API, be claimed by the existing Hangar runner, run the installed agent CLI, produce a source-backed research report, commit it on its own `aeon/*` branch, and return a result to the correct card. After runner cleanup and shutdown, the report and its exact revision must remain retrievable from the local remote and match the saved evidence.

**Operator correction:** run against the existing production service at `https://aeon.shadow-lab.ai`, using REST rather than MCP. No new launch API or local app is part of the test. The generic session API creates real card-linked sessions but bypasses the UI's card-launch validation, registry gate, launch-history recording and disarming. Browser session authentication and that launch wrapper are separate acceptance evidence.

## Per-job acceptance

- Unique card, session, marker and report; no unrelated card or session changed.
- Persisted session metadata names the actual card and mission; auto-run stays off. UI launch-history/disarm behavior is not claimed from this API path.
- Worker identity and running evidence are recorded. Requested model and provider-reported model are distinct; absent provider identity remains unknown.
- Terminal result is `completed`, the exit code is zero, and card/session/result links agree.
- A full report contains the unique marker and at least three concrete repository findings with source references. Test coverage claims are honest.
- Delivered branch descends from the recorded base; its diff contains only the assigned report. The result commit equals the delivered commit.
- Report hash and full contents survive worktree cleanup and an idle runner stop. A short summary or artifact path alone is insufficient.
- Every run has an explicit PASS/FAIL record; failures remain visible and stop expansion until diagnosed. Do not replace failed attempts with invented successes.

## The gate: mechanical validation plus independent review

Passing the mechanical checks above is necessary and **not sufficient**. On 11 September a batch passed all of them 10/10 while three independent reviewers, re-reading every claim against the pinned revision, returned zero clean passes and four failures. Mechanical PASS therefore only moves a run to `review_pending`.

- Every attempt must additionally carry a stored independent review verdict at `results/<runId>/reviews/NN.json`. A run is `passed` only when every one of those verdicts is exactly `PASS`.
- Any `PASS_WITH_CORRECTIONS` or `FAIL` ends the run `failed`. The receipt is retained and is never repaired into a pass.
- The reviewer must not be the model that wrote the report. Reviewer engine and model come from the `review` block of `bootstrap.json`; a same-model review requires `--allow-same-model` and that admission is recorded inside the verdict.
- The reviewer judges each numbered claim against the resolved source lines at the pinned revision. A claim the cited code contradicts is a FAIL. Citation drift — off by lines, or pointing at a declaration or test title rather than the evidence — is at least `PASS_WITH_CORRECTIONS`.
- Reviewer output that fails schema validation is stored raw and counts as **not reviewed**, never as a pass. A `PASS` that carries a finding of any severity beyond the cosmetic set is self-contradictory and is refused.
- Verdicts may also be supplied by a human or another agent via `review --import`, validated against the same schema and recorded with `reviewer.engine` of `import`. An import must agree with any `runId` or `attempt` it states, cannot overwrite a stored verdict without `--force`, archives rather than deletes what it supersedes, and **may never replace a stored non-PASS verdict with a PASS under any flag**.
- The reviewer runs outside the git working tree with no shell, write or network tools, so it cannot read credentials or the repository; a reviewer that overruns its timeout has its whole process tree killed.
- Terminal runs are immutable: `review` refuses them, and `run --count=N` refuses to reopen a `passed` or `partial_pass` run or to run a count that adds no attempt. Runs completed before this gate existed keep their original verdict and are displayed as legacy.
- `prepare --new` may archive `failed`, `passed`, `partial_pass` or `review_pending`. Abandoning a `review_pending` run stamps its receipt `abandoned: true` with the review progress; an abandoned run is never a pass.

## UI acceptance

Exercise Save without launch, Save & Launch sequencing, invalid/incomplete input, save/launch failure, stored authorization/arming, duplicate launch rejection, registry restrictions, and persist-before-drop launch. Run the focused contract suite ten times and retain each exit code. Component tests may mock external boundaries, but must execute the actual component/handler/action under test.

A redirect to login is not a successful authenticated UI test. Record hosted browser launch, reload/result display, and visual operator acceptance as NOT RUN until exercised. Ten backend jobs or ten unit passes do not remove this limit.

## Production decision

A passing research lane establishes supervised research delivery by committed branch. Exact-revision independent review is now part of the gate rather than an open item, but it is a machine reviewer with a strict schema, not a human sign-off. It does not establish uncommitted artifact retention, lease/crash recovery, enforced general publication policy, secretary coordination, accepted research ingestion or outcome-to-memory linkage.

Known result-retry failure between event insertion and card application needs a controlled failure-injection regression and repair before claiming dependable unattended delivery. Missing browser evidence, unresolved test failures, or a failed required delivery check keep the production verdict **NO-GO**. Keep the new source changes and test evidence reviewable on the existing working branch; do not deploy as a side effect of testing.

The abandoned local launch-API design was not implemented. Dependency versions and test behavior are verified from this checkout.
