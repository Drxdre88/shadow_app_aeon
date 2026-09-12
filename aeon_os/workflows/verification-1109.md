# Production workflow verification — 11 September 2026

**Supersedes** [verification.md](verification.md) (10 September). That record and every failure receipt under
`results/` are retained unchanged; nothing was repaired into a pass.

**Headline: the delivery pipeline is production-ready. The research it delivers is not yet trustworthy.**
Ten consecutive real production missions passed full validation with zero debris. Independent content review of
those same ten reports returned **0 clean passes and 4 outright failures**. A production API acceptance suite
found **3 real defects**. Readiness is therefore a split verdict, not a single yes/no.

Test project: [Aeon OS production verification 1009](https://aeon.shadow-lab.ai/project/e4b0af95-d3ad-46ba-8275-1ecc28911683).

## 1. The blocker is closed — Windows worktree cleanup

The 10 September batch stopped at job 2 because a delivered mission left its checkout on disk (`EBUSY`).

**Measured root cause** (probe, 11 September, node 24): a live process whose current directory is inside the
worktree makes `rmSync` fail `EPERM` *and* `renameSync` fail `EBUSY`, and **both succeed the moment that process
exits**. The agent CLI runs with `cwd` = the worktree, so any straggler it spawned pins the whole tree. The
historical log signature — `EBUSY: resource busy or locked, rename '...aeon-121c5001-75c76b'` — matches this
class exactly and cannot be an open file handle, which does not block deletion at all.

Rename does not dodge a cwd lock, so no single pass can be correct: only waiting can. `destroyLocked` now runs a
**bounded retry of the whole safe sequence** (drop links → rescan → refuse unless provably link-free → delete),
never just the delete, so a tree that gains a reparse point between attempts still never meets a recursive
delete. Safety refusals are deterministic and are not retried. Budget: 15.75s across 6 backoffs.

| Evidence | Result |
|---|---|
| Regression test — tree pinned, released mid-retry | recovers, `removed:true` (1.5s) |
| Regression test — tree pinned permanently | bounded, and never reports a removal that did not happen |
| Negative control (single pass, i.e. old behaviour) | **fails** with the exact production symptom |
| Real 10 September orphan `aeon-121c5001-75c76b` | removed by the repaired teardown in 745ms |
| Worker suite, plain `npm run test`, **6 consecutive runs** | **144/144 every run** |

### The historical "four timeouts" are also closed — and they were a test defect, not a product one

Two clean suite runs on an idle machine initially looked like a repair. Repeating the suite while the machine was
busy exposed four *pre-existing* flaky tests — the same four the 10 September record reported. They fail with
**`Test timed out`, never an assertion failure**: `worktree.test.ts` drives a real throwaway git repo, a single
test shells out to git up to ten times, and each call costs 200ms–1s on Windows. Those tests already sat at
2.8–3.4s against vitest's 5s default, so any load pushed them over.

Fixed at the root by setting `testTimeout`/`hookTimeout` to 30s in `apps/kairos-worker/vitest.config.ts`, rather
than requiring a `--testTimeout=30000` flag that every future run would have to remember. The work is genuinely
slow, not hung — the repo lock keeps its own timebox, so a real wedge still fails. Verified by six consecutive
clean runs.

One new test of mine was also flaky and was corrected: it asserted that Windows *must* refuse to delete a pinned
tree for the whole budget. Which handle the OS hands out for a cwd lock is not something this code controls, so
the test now asserts only what the code guarantees — that teardown is **bounded** and that it **never reports a
removal that did not happen**.

## 2. Four test-instrument defects fixed before the product could be judged

Two production runs were recorded FAIL on 11 September while the **product had actually succeeded**. Both were
harness faults. They are listed because an instrument less reliable than the system it measures cannot answer a
readiness question.

| Defect | Effect | Fix |
|---|---|---|
| `api()` threw on any transport failure, bypassing its own GET-retry policy | one network blip discarded a whole paid batch; run `…0595ae` delivered its report and reached `succeeded`, yet was recorded FAIL | retry reads on transport failure and on 5xx; never retry a non-idempotent POST |
| `waitForDelivery` read the **bare** origin with `git -C` | `safe.bareRepository=explicit` (injected by Copilot CLI via `GIT_CONFIG_KEY_*`) makes git refuse, so no SHA was ever read and a pushed branch was reported as "publication did not settle" | address bare repos with `--git-dir`, as `verifyGit` already did |
| `--max-ai-credits 30` | a mission wrote its report, ran out of budget before committing, and teardown destroyed the work | raised to 60; cap retained as cost containment |
| Citation instruction said only "as path:line" | agent mixed full paths with bare-filename shorthand on repeat mentions; unverifiable | prompt now demands a repository-root-relative path for **every** citation |

## 3. Production batch — 10/10

Run `2026-09-11T12-17-25-014Z-1a3691`, status `passed`. Ten distinct sessions, ten report-only commits, each
validated for terminal status, exit code, publication, single-commit report-only diff, Conventional subject,
marker, resolvable citations, exactly one result event, credential absence, envelope completeness, card
`lastResult` equality and `Landing` placement, then re-verified after worker shutdown.

- **Leftover checkouts: 0/10.** The cleanup repair held across every mission.
- **Model provenance: 10/10 provably `claude-sonnet-5`** from provider telemetry — this closes the earlier
  `observed identity unknown` gap in substance. **The platform still records `observedModel:"unknown"` in all ten
  attempt records**: the evidence exists in the event stream but is not captured. Fixable assurance gap.
- **Cost envelope: 1 premium request per mission, 10 total.** Duration p50 89.4s, p95 106.8s, max 106.8s.

## 4. Independent content review — the research does NOT pass

Three independent reviewers verified every numbered finding against the exact base revision
`3b7b3f30`, reading the cited source lines rather than trusting the citation.

| Verdict | Count | Attempts |
|---|---:|---|
| PASS (clean) | **0** | — |
| PASS_WITH_CORRECTIONS | 6 | 1, 3, 4, 5, 7, 9 |
| **FAIL** | **4** | 2, 6, 8, 10 |

All three reviewers independently concluded the batch is **not trustworthy to a paying user as delivered**.
Failures are not cosmetic — each contains a claim the cited code disproves, for example:

- *Attempt 2*: "every envelope is sanitized before any caller sees it" — contradicted by `extractEnvelope`,
  which returns the unsanitized parsed object, in the same file.
- *Attempt 6*: claims pre-launch setup failures reuse the worker kill path; every such failure occurs before the
  child starts, so it does not.
- *Attempt 8*: claims both parser failure paths degrade to raw text; `flush()` loses its buffer instead.
- *Attempt 10*: claims an `this.defaultModel` pattern is unique to Claude while all three adapters share it.

**Citation drift is systematic** across passing reports too — cited lines are routinely off by a few lines, or
point at a function declaration or a test title rather than the evidence. The mechanical harness cannot see
this, because it only checks that the path exists and the line number is in range.

## 5. Production API acceptance — 12/15

`prod-acceptance.mjs`, run live against production, confined to the test project, no worker started, all
temporary cards and sessions cleaned up, the ten mission cards untouched.

Passing: unauthenticated and garbage-token rejection (401, no leak), non-existent project (404), missing fields
(400), invalid engine (400), oversized payload (400), injection-like prompt exact round-trip, queued-session
cancellation, kill idempotency, non-existent kill (404), and all ten cards reading back `completed` / `Landing` /
correct marker.

| # | Defect | Severity |
|---|---|---|
| 4 | `not-a-uuid` project id reaches the database and returns **500** — missing syntactic validation before query | real |
| 7 | Invalid `metadata.hangar.objective` is **accepted (201)** — session metadata is free-form and the Hangar objective validator is not enforced | real |
| 10 | Four concurrent launches produced exactly **one** session (money is safe, the unique index holds), but the three rejections return opaque **500** instead of a clear duplicate 4xx | real, UX/contract |

**Additional design risk (check 14, not a failure):** every objective — including `implement` and `bug_fix` — can
report `completed` with no branch, no commit and no artifacts, and `summary` may be an empty string. A mission
can claim success having delivered nothing.

## 6. What remains open

- Mission **quality** is not gated. PASS is structural; the independent review is a postscript. Until review is
  part of the gate, "10/10 passed" overstates readiness.
- `observedModel` is recorded `unknown` despite the identity being present in the event stream.
- The three API defects above, and the envelope-permissiveness risk.
- Still unexercised: objectives other than `recon`, multiple repositories, 2+ concurrent missions, worker crash /
  lease expiry / reclaim, result-retry recovery, and authenticated browser launch through Save & Launch.
- No **shift lease / fencing token**, so there is no safe single-manager handover between a local and a cloud
  orchestrator. Heartbeats exist; expiry and auto-reclaim do not.
