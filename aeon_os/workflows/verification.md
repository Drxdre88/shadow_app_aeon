# Production workflow verification — 10 September 2026

**Model correction and UI implementation: verified locally. Production acceptance: incomplete.** Six production attempts are retained: one complete transport pass and five failures across setup, model selection, result format and cleanup. Four attempts delivered research commits. The final expansion stopped at job 2 because Windows worktree cleanup failed again. Local UI verification passed 10/10 rounds with 48 checks each; the UI changes are not deployed.

Production test project: [Aeon OS production verification 1009](https://aeon.shadow-lab.ai/project/e4b0af95-d3ad-46ba-8275-1ecc28911683).

## Exercised paths

The harness called the existing production REST service at `https://aeon.shadow-lab.ai`. A local instance of the existing Kairos pull worker claimed the real queued sessions and posted events and terminal results to production. The test worker used a dedicated registry, concurrency one, and a local bare Git origin. The model picker has been updated locally; no new API, deployment, or GitHub push was made.

The generic session API bypasses the UI's launch action. This exercise does not establish browser authentication, launch-history/disarm behavior, or successful clicking of Save & Launch. A test-only bootstrap restricts the worker to one successful claim and checks the expected session ID; the first claim still uses the account-wide production claim API. See [containment limits](README.md).

| Attempt | Observed production outcome | Evidence |
|---|---|---|
| `5c78a299-b7e4-482d-8c97-29983bdf4323` | Queued and claimed; Windows checkout failed before agent launch. Isolated-clone `core.longpaths=true` subsequently proved successful checkout at the same path depth. | [Failure diagnosis](results/2026-09-10T15-52-24-049Z-418571/setup-failure.md) |
| `413a3717-b35a-46dc-b987-d4cf13f4578f` | Queued, claimed, worktree created, Copilot launched; exit 1 because configured model `claude-sonnet-5.6` was unavailable. Failure event and failed card result persisted. | [Production evidence](results/2026-09-10T16-03-22-171Z-fcd473/runtime-failure.json) |
| `d6713992-c413-4a8f-89bc-39b42bec2435` | Sonnet 5 completed research with exit 0; report-only commit `e7de02f96c9f40cdde346c969cdec745e983b758` published to local origin on `aeon/7f1d368b`; result persisted and card moved to Landing. Full attempt FAIL: worktree cleanup returned Windows EBUSY. | [Delivery evidence](results/2026-09-10T16-18-20-247Z-510469/delivery-before-cleanup-failure.json), [report](results/2026-09-10T16-18-20-247Z-510469/report-01.md) |
| `ecc7154b-4c17-44af-bf84-f7b513901842` | Sonnet 5 exited 0 and published report commit `9a0009e483007f54bbc06c6b2c98f8bd4ff2758d` on `aeon/084ea9f9`; checkout was removed. FAIL: final envelope omitted mandatory `summary`, so the production API rejected it and the session failed. | [Result/error events](results/2026-09-10T16-29-31-771Z-238d57/runtime-events.json), [report](results/2026-09-10T16-29-31-771Z-238d57/report-01.md) |
| `6d3bb38e-fbc9-4068-8b2e-1f2a72c84acc` | **Transport PASS:** real research, exact report-only commit `b8af1ccde7509df0fcc84bfe04b7ae729f6fa44d` on `aeon/4d584a8b`, accepted result/card Landing, physical checkout removal and report retrieval after worker shutdown. | [Complete evidence and independent review notes](results/2026-09-10T16-37-07-347Z-4eb7a5/attempt-01.json), [report](results/2026-09-10T16-37-07-347Z-4eb7a5/reports/01.md) |
| `f215b5aa-1b60-471f-a25e-5a774ecbd781` | Sonnet 5 exited 0 and delivered commit `72e585848e455573511b37890dbb66c1a1c784fc` on `aeon/121c5001`; session succeeded. **FAIL:** physical checkout remained after Windows EBUSY. Batch stopped; jobs 3–10 were not launched. | [Delivery evidence](results/2026-09-10T16-37-07-347Z-4eb7a5/attempt-02-delivery.json), [failed run](results/2026-09-10T16-37-07-347Z-4eb7a5/run.json) |

The second card remained in its original column, as the source specifies for failed results. Its `lastResult.status` is `failed`. After the operator authorized correction, the saved runner default was changed to `claude-sonnet-5`. Authenticated Copilot discovery confirms Sonnet 5 and GPT-5.6 Sol are available. The harness now rejects unavailable model IDs before creating a production job; see [model evidence](models-1009.md). Failed attempts remain retained.

## UI and local verification

- [Final ten-round record](results/ui-2026-09-10T16-28-43-918Z/summary.json): 10/10 passed, 48 tests per round; includes hashes of the tested files. Components, handlers and actions execute with mocked external boundaries.
- Model presets/custom IDs, engine switching and fail-closed repository loading now have focused coverage, alongside launch sequencing/errors, persisted-move launch behavior and server-action gates. Full web typecheck, focused test-file lint and all nine worker engine-argument tests passed. The model catalog imports successfully with 16 Copilot, four Claude and six Codex entries.
- Correctness review passed after fixing repository-loading/error states that had allowed invalid engine choices to be saved. The UI source is locally updated, not deployed.
- One passing characterization test records a defect: a queued session survives if the subsequent launch-history/disarm write fails. A passing characterization does not close the defect.
- Hosted browser navigation reached login. Authenticated browser launch, reload/result display and visual acceptance remain **NOT RUN**.
- Harness syntax, help smoke, scoped diff checks and a mock one-claim-gate exercise passed. These are local checks, not additional live jobs.

## Remaining acceptance

The test runner is stopped; no active child is recorded. Failed checkouts remain in the ignored runtime folder. Physical deletion is checked separately from Git's deliberately retained, prunable worktree registration. The result template now includes every mandatory field; rejected envelopes were not patched into successes.

Independent review of the transport-passing report verified three substantive findings but found inaccurate line citations and a claim that confuses authorization with concurrency. Its record is `PASS_WITH_CORRECTIONS`, not acceptance into durable knowledge. Original report commits remain unchanged so review notes cannot obscure what the agent actually delivered. Provider-reported model identity was absent from the envelope, so the evidence records observed identity as unknown separately from the explicitly requested Sonnet 5 model.

Reliable Windows cleanup is the immediate gate before resuming the research batch. The exact owner of the transient directory handle was not observed; disabling unrelated MCP processes did not eliminate the failure. A bounded retry of the full safe cleanup operation and a focused Windows handle test are the next implementation work. No such worker-source repair is claimed here.

Unresolved UI partial-write behavior, result retry recovery, lease/crash recovery, publication policy and exact-revision review remain separate readiness gaps. The earlier [readiness assessment](../test_readiness.md) records their source evidence and the default worker-suite timeout/cleanup failures. Successful research jobs alone would not close those gaps.
