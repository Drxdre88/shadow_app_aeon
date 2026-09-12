# Aeon OS production workflow proof

This harness runs controlled, card-linked research missions through the existing production Aeon session API and the repository's real pull-mode Kairos worker. Each mission uses a disposable Git worktree backed by a local bare origin. The configured origin points only to that local bare repository, the main checkout is never used as the mission working directory, the prompt authorizes one report only, and delivery validation rejects any other changed path.

The proof covers production session creation, worker claiming, Copilot execution, event delivery, terminal persistence, card `lastResult`, branch publication, and worktree cleanup. It deliberately does **not** claim that the UI launch control was exercised. UI behavior needs its own component/browser evidence before production acceptance.

## Commands

Run from the repository root in this order:

```powershell
node aeon_os/workflows/run.mjs preflight
node aeon_os/workflows/probe-copilot-models.mjs
node aeon_os/workflows/run.mjs prepare
node aeon_os/workflows/run.mjs prepare --new # only after a failed or completed run
node aeon_os/workflows/run.mjs run --count=1
node aeon_os/workflows/run.mjs run --count=10
node aeon_os/workflows/run.mjs review
node aeon_os/workflows/run.mjs review --attempt=3 --allow-same-model
node aeon_os/workflows/run.mjs review --import verdict.json --attempt=3 [--force]
node aeon_os/workflows/run.mjs status
node --test aeon_os/workflows/review-gate.test.mjs
```

`preflight` performs account-scoped GETs only and reports zero writes. `prepare` creates an isolated local Git origin and adopts `bootstrap.json`'s dedicated production Aeon project with Queued, Flight, Landing, and Tower columns. `prepare --new` archives a finished run's state into its existing durable result folder, keeps its runtime repository, and starts a new run against the same project. It accepts `failed`, `passed`, `partial_pass` and `review_pending`; abandoning a `review_pending` run stamps its receipt `abandoned: true` with the review progress, so it can never be mistaken later for a reviewed pass. `run --count=1` creates and validates the pilot. If it passes, `run --count=10` reuses the same run and adds attempts 2–10 sequentially. Counts are strict integers from 1 to 10.

## The PASS gate has two halves

Mechanical validation alone can only carry a run to `review_pending`. It measures plumbing, and plumbing is not quality: on 11 September a batch reached 10/10 mechanically while three independent reviewers, reading the cited lines at the pinned revision, returned zero clean passes and four outright failures.

`review` closes the second half. For every attempt without a verdict it builds the reviewer package with `review-bundle.mjs` — the report plus every citation resolved to its real source line at the pinned revision — and dispatches a reviewer that is **not** the model under review. The reviewer engine and model come from the `review` block in `bootstrap.json`; a reviewer whose model equals the mission model is refused unless `--allow-same-model` is passed, and that admission is recorded inside the verdict. The reviewer must answer with a single JSON object (`verdict`, `findings[{claim, cited, actual, severity}]`, `summary`); the harness attaches the measured `reviewer` provenance itself. A `PASS` carrying any severity outside the cosmetic set (`minor`, `info`, `nit`, `none`) is self-contradictory and refused. Every stored verdict must name its own attempt as an integer matching its filename, so one clean verdict copied across ten filenames reviews nothing. If the provider reports which model actually answered and it is not the configured reviewer — or it turns out to be the mission model without `--allow-same-model` — the verdict is discarded as unattributable. Verdicts land in `results/<runId>/reviews/NN.json` next to the raw reviewer output and the exact bundle that was judged. One attempt whose package cannot be built does not abort the sweep; it is recorded as unreviewed and the rest continue.

The run reaches `passed` only when **every** attempt carries a stored verdict of exactly `PASS`. Any `PASS_WITH_CORRECTIONS` or `FAIL` ends the run `failed` with its receipt retained. `review` exits zero **only** on a complete clean review, so a still-pending run and a failed one both exit non-zero; importing the fifth of ten verdicts is expected to exit 1. Output that cannot be parsed against the schema is stored raw with an error sidecar and counts as **not reviewed** — never as a pass — so the run simply stays `review_pending` until it is reviewed properly. `status` shows the progress as n/N reviewed with per-verdict counts. Runs that completed before this gate existed are displayed as legacy and are never retro-marked; `review` refuses to touch a terminal run at all, and `run --count=N` refuses to reopen one or to run a count that would add no attempt. `node --test aeon_os/workflows/review-gate.test.mjs` proves the gate logic on synthetic verdicts without dispatching a reviewer.

### Importing a verdict

`review --import <file> --attempt=N` ingests a verdict produced by a human or another agent through the same schema, recorded with `reviewer.engine` of `import` and its raw text kept separately at `reviews/NN.import.raw.txt` so it can never overwrite a dispatched reviewer's output. If the file states its own `runId` or `attempt` they must match the target; only absent fields are stamped. An import will not overwrite an existing verdict without `--force`, and `--force` archives the previous verdict as `reviews/NN.superseded-<timestamp>.json` rather than deleting it. **Replacing a stored `FAIL` or `PASS_WITH_CORRECTIONS` with a `PASS` is refused outright, with or without `--force`** — that is the one edit that would let a run reach `passed` with the disqualifying verdict erased.

### Reviewer containment

The reviewer judges text that is already in its prompt, so it is given no reason and no means to touch the machine. It runs with its current directory set to a throwaway directory under the OS temp root, **outside the git working tree**: Copilot scopes file access to the working directory subtree and `--allow-all-paths` is never passed, so `runner.env.bat`, `apps/web/.env.local` and the repository are unreachable. `--disallow-temp-dir` removes the implicit grant over the rest of the temp root, and the shell, write and URL tool kinds are denied — path verification does not constrain the shell, so denying it matters most. Known credential variable names are passed to `--secret-env-vars` on top of being deleted from the child environment. The scratch directory is removed after each attempt, and a reviewer that overruns its timeout has its **whole process tree** killed, so no survivor can pin that directory. A reviewer package too large to pass in argv is refused rather than handed over as a file, because reading a file would mean granting a tool the reviewer otherwise never needs; review those out of band and ingest the verdict with `--import`.

Use `node aeon_os/workflows/run.mjs stop` to kill only the current workflow session, wait for its child process to leave the worker, and then stop only the recorded workflow worker. The harness refuses to start while any other account-owned card-linked session is queued or running, because its isolated runner must never claim unrelated work.

## Credentials and containment

The harness reads only literal `SET` lines for `AEON_BASE_URL`, `KAIROS_AEON_API_KEY`, and `KAIROS_COPILOT_DEFAULT_MODEL` from `apps/kairos-worker/runner.env.bat`; process environment values override them. It does not evaluate the batch file and never prints or persists the Aeon key. Copilot authentication must already be available in the process environment or the installed CLI's credential store.

The configured model is passed explicitly with no fallback. A per-run wrapper removes Aeon credentials from the Copilot child, disables the Aeon MCP server, and adds `--max-ai-credits 60` (raised from 30 on 11 September, when a mission wrote its report and ran out of budget before committing it). The reviewer's own cap is separate and comes from `review.maxAiCredits` in `bootstrap.json`. A one-claim bootstrap forwards the expected first successful production claim and returns an empty queue to later polls, so this test worker cannot consume a session that appears after its own mission. The production claim endpoint is account-wide, so a narrow race remains if an older unrelated session appears between the final empty-queue check and the first claim: the gate refuses to execute it and reports an error, but the server-side claim has already occurred and requires operator recovery. The worker uses concurrency 1, 15-second polling, 30-second heartbeats, port 8799, verified system CAs, an isolated repo registry, and an isolated worktree root. Each job is limited to eight minutes and the batch to 90 minutes.

Mutable state and worker logs live under ignored `.runtime/`. Sanitized evidence is durable under `results/<runId>/`: one JSON record and a full report copy per attempt, the stored verdicts under `reviews/`, plus the run summary. Mechanical validation requires one result event, a succeeded persisted session, a matching card result, a single report-only Conventional Commit descending from the prepared base, the exact marker, at least three citations whose paths and line numbers exist at that base, publication to the local origin, and removal of the mission worktree. None of those checks were relaxed to make room for review; they are now the entry condition to `review_pending` rather than the whole gate. The credential is scanned out of the report, result envelope, event set, reviewer package and reviewer output before evidence is persisted. The record distinguishes the requested model from the observed model; absent runtime identity is saved as `unknown`.

Creation POSTs are never retried because a lost response could otherwise duplicate a project, task, or session. GET requests retry HTTP 429 on a bounded schedule. The batch stops at the first failed validation and retains its failure evidence.

Model verification uses the installed Copilot CLI's authenticated `models.list` before creating any card/session. The standalone probe makes no model-generation call. The controlled research wrapper disables Aeon, Playwright and built-in GitHub MCP servers; no MCP tools are needed for these repository reports. These are per-test process flags, not changes to the user's global integrations.
