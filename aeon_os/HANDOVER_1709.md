# Beacon: PR #128 LIVE — gate suite in CI, objective-completion contract, five live gate runs (best: PASS_WITH_CORRECTIONS, 4 minor)

**Date:** 2026-09-17  **Repo:** shadow_app_aeon  **Branch:** `chore/aeon-os-ci-gate-first-pass` → main (PR pending at time of writing; see PR body for review record).
**Read next:** `aeon_os/HANDOVER_1609.md` (how the gate works and the 1609 live-fire detail), `aeon_os/workflows/README.md` (gate section), this file (what happened on 1709 and what to do).

## Rollout of PR #128 (merged by owner 2026-09-16 23:13Z, `9da76a8`)
| Check | Result |
|---|---|
| Auth Smoke on the production deployment | green, 23:15Z (run 35161521000) |
| `node --use-system-ca aeon_os/workflows/prod-acceptance.mjs` | exit 0, **15/15** (twice, 23:2x Z) |
| `node --test aeon_os/workflows/review-gate.test.mjs` on main | 63/63 |

## What changed on 1709
| # | Change | Where |
|---|---|---|
| 1 | **CI runs the gate suite.** `.github/workflows/ci.yml` now has `node --test aeon_os/workflows/review-gate.test.mjs`; a red gate test can no longer pass CI (it did on 1609). First Linux execution of the suite is this PR's CI run — if it is red, the suspects are `process.kill(-pid)` in `review.mjs`, the detached grandchild test, and CRLF. | `ci.yml` |
| 2 | **Objective-completion contract (acceptance check 14).** `enforceObjectiveDeliverables(objective, envelope)` in `lib/data/validators/hangar.ts`: for `implement`/`bug_fix`, a `completed` envelope with no (branch AND commit) and no artifacts is **downgraded to `needs_input`** with the missing deliverables prepended as a question; the card lands in Tower, `lastResult` carries the evidence, the ack carries `resultDowngraded`, the runner logs it. Not refused: a refused envelope would strand the card in Flight with no result. Recon/analysis/plan and free-form sessions untouched. 7 new vitest cases. | `validators/hangar.ts`, `api/v1/sessions/[id]/events/route.ts`, `kairos-worker/src/poller.ts` |
| 3 | **Mission prompt: citation + epistemics policy (decided).** Line numbers must come from a numbered listing (`grep -n` / `sed -n`) and be re-verified before writing; every mechanism line cited; each finding labelled Observed or Inference; no blanket "nothing was inferred"; no numbered finding built on absence ("never called", "no test", "not in a prior read"). | `run.mjs` `missionPrompt` |
| 4 | **Reviewer rule 6:** a statement the report labels Inference or files under "Unverified observations" is judged for honest labelling and contradiction only, never failed for lacking a citation. Numbered findings keep the full standard. | `review.mjs` `RULES`, test |
| 5 | **`AEON_OS_MISSION_CREDITS` (30–300)** overrides the mission wrapper's `--max-ai-credits 60` for one run; recorded as `missionCredits` in `run.json` (from the next run on — 08668a predates the projection field). | `run.mjs` `createBudgetWrapper` |

## The five live gate runs (all receipts committed under `results/`, immutable)
| Run | Mission model | Outcome | What it taught |
|---|---|---|---|
| `23-26-21…63aaf4` | claude-sonnet-5 (60 cr) | mechanical PASS → review **FAIL** (6) | No line drift any more (policy 3 worked). Report over-claimed: "no behavior was inferred" while inferring; two negative findings unprovable from cited lines; one genuine logic error (called a `not.toHaveBeenCalled` assertion non-informative). Legit FAIL. |
| `23-37-42…c12c29` | claude-sonnet-5 | mechanical PASS → review **FAIL** (5) | Two off-by-one citations (predicate on the next line); one negative claim; the labelled "Unverified observations" section was failed as an uncited claim → rule 6 added. |
| `23-43-16…f0f9ad` | claude-sonnet-5 | **mechanical FAIL** | Repeat mention abbreviated to bare `sessions.ts:286` in prose despite the prompt forbidding it. Gate correct. |
| `23-46-42…40918a` | claude-opus-5 (60 cr) | session **failed** | Opus spent 66.93/60 credits (15 premium requests) and was cut off mid-report; no envelope → worker reported failed. Cap made overridable (change 5). |
| `23-50-41…08668a` | claude-opus-5 (200 cr) | mechanical PASS → **PASS_WITH_CORRECTIONS** (4 minor) | Reviewer: "a paying user could rely on the report's core technical account"; findings are wording precision (userId "authenticated", "written atomically", heading overstating compiled-SQL coverage, absence/order wording). Run is `failed` by design — only exact PASS passes. |

Receipt token echoed on every dispatched review; reviewer provenance `gpt-5.6-sol` verified from the usage file each time. Mission model provenance: `requestedModel`/`observedModel` in `attempt-01.json`.

**Verdict on the chase:** the gate is doing exactly its job. Sonnet-5 slips on a different small thing every run; Opus-5 with budget produces a trustworthy report that still needs minor wording corrections. Whether PASS_WITH_CORRECTIONS-with-only-minor-findings should ever count as a pass is the owner's call; the harness was deliberately built strict and this handover does not relax it.

## Next session (in order)
1. **CI on this PR:** first Linux run of the gate suite. Fix any Linux-only failure in the harness, never by skipping the step.
2. **Owner decision:** keep exact-PASS strictness (recommended: yes) or allow a minor-only PASS_WITH_CORRECTIONS to settle a run as `passed_with_corrections`. If the latter, it is a `run.mjs`/`review.mjs` state change with tests, not a rule wording change.
3. **One more Opus run only if the owner wants the trophy:** `KAIROS_COPILOT_DEFAULT_MODEL=claude-opus-5 AEON_OS_MISSION_CREDITS=200` + one precision nudge in `missionPrompt` ("claim only what the cited line literally shows — no 'authenticated', 'atomically', 'before any' unless that line shows it"). ~15 premium requests per Opus mission.
4. **Contract follow-through:** the completion contract is enforced at the REST ingress only (the runner is the only writer of `kind:'result'`; there is no MCP mirror — verified). Consider a Hangar UI hint on a Tower card whose lastResult carries the downgrade question.
5. Parked, unchanged, on card "Fix Aeon live bugs and hardening": ~45 raw-id `[id]` REST routes (shared uuid guard), no membership check on spawn `taskId`, realm-less project cannot launch from the browser, `-p` argv cap on mission prompts in `engines.ts`.

## Traps carried forward
- Bash heredocs in this Git Bash collapse `\\` → `\` even when quoted: write patch scripts with the Write tool. `cd apps/web && …` in a Bash call moves the tool's working directory for later calls — always use absolute paths or `cd` back.
- Never chain `git push` behind a `grep`; gate on the test runner's exit code.
- `npm run test --workspace=apps/kairos-worker` only works from the repo root.
- Pushes: `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!f() {…Drxdre88…}' push`; `GH_TOKEN=$(gh auth token -h github.com -u Drxdre88)` for `gh`.
- Receipts under `results/` are immutable; a harness-caused FAIL stays a FAIL — fix, then `prepare --new`.
- `.env.local` IS production; drizzle journal frozen at 0010.
- Copilot credits: Opus-5 ≈ 3× Sonnet-5 on the same mission; 60 is not enough for Opus.

## Board
Card **AEON: Hangar Sprint 3** stays in **Live** (3C output sinks + 5-card live fire still open). 1709 items added under "3D Aeon OS acceptance (1209)" and "Review" and checked as done; the PASS chase item carries the 5-run status.
