# Beacon: Aeon OS production acceptance — blocker closed, 10/10 shipped, quality gate missing

**Date:** 2026-09-12  **Repo:** shadow_app_aeon  **Branch:** feat/member-avatar-styling
**Last commit:** 3b7b3f3 chore: merge main (v0.26.1) into feat/member-avatar-styling
**Status:** Windows cleanup blocker CLOSED. Production batch **10/10 PASSED**. Independent review says the
delivered research is **NOT trustworthy**. Three live API defects found. Nothing committed, nothing deployed.

## Goal
Prove the Aeon Hangar mission pipeline is ready for real use: fix the Windows cleanup blocker, run real
production missions at scale, and test the production platform hard with business-level (not unit-level) tests.

## User direction and authorization
- Real production testing on **https://aeon.shadow-lab.ai** is authorized. Confine writes to test project
  `e4b0af95-d3ad-46ba-8275-1ecc28911683`. User: *"these are prod tests on prod platform… TEST EVERYTHING YOU
  POSSIBLY CAN"*.
- User explicitly **rejected local-Playwright UI testing**; wants prod-platform testing instead. A local dev
  server was started and then shut down at their instruction.
- Prefers **Claude Sonnet 5**. No silent fallback. No push to `main`; feature branches only.
- Test publication goes to an **isolated local bare origin**. No GitHub push, no deploy, no app commit occurred.
- `aeon_os/summary.md`, the overview and the flight manual are user handover assets — preserve them.

## 1. Blocker CLOSED — Windows worktree cleanup

**Root cause, measured (not inferred):** a live process whose **current directory is inside the worktree** makes
`rmSync` fail `EPERM` *and* `renameSync` fail `EBUSY`, and **both succeed the instant that process exits**. The
agent CLI runs with `cwd` = the worktree, so any straggler it spawned pins the tree. The 10 September log
signature `EBUSY … rename '…aeon-121c5001-75c76b'` matches this class exactly; an open file handle does **not**
block deletion at all (probed and disproven).

**Fix** in `apps/kairos-worker/src/worktree.ts`: `destroyLocked` now runs a **bounded retry of the whole safe
sequence** (drop links → rescan → refuse unless provably link-free → delete), extracted into `sweepOnce`. Never
retries just the delete, so a tree that gains a reparse point between attempts still never meets a recursive
delete. Safety refusals are deterministic and not retried. Budget `CLEANUP_BACKOFF_MS` = 15.75s over 6 backoffs.
Rename-to-trash kept as a fallback for the *other* locker class; `freeTrashPath` keeps the `.trash-<13+ digits>`
shape so `sweepTrash` can still age-parse it.

Proven four ways: released-mid-retry test recovers in 1.5s; **negative control** (backoff set to `[]`) fails with
the exact production symptom; the real 10 Sept orphan was removed in 745ms; and 10/10 production missions left
**zero** checkouts.

**The historical "four timeouts" are also fixed, and they were a TEST defect.** They fail with `Test timed out`,
never an assertion error: `worktree.test.ts` drives a real git repo, ~10 subprocess calls per test, 2.8–3.4s idle
against vitest's 5s default. Fixed at the root — `testTimeout`/`hookTimeout` = 30s in
`apps/kairos-worker/vitest.config.ts`. **Verified by 6 consecutive clean `npm run test` runs, 144/144 each.**
Do NOT re-introduce a `--testTimeout=30000` flag; the config now owns it.

Caution learned: two clean runs on an idle machine are NOT proof of stability here. Repeat under load.

## 2. Four harness (NOT product) defects fixed in `aeon_os/workflows/run.mjs`
Two 11 September runs were recorded FAIL while **the product had actually succeeded**. Do not mistake these for
product regressions.

| Defect | Effect | Fix |
|---|---|---|
| `api()` threw on transport failure, bypassing its own GET-retry policy | one network blip discarded a whole paid batch | retry reads on transport failure and 5xx; never retry a non-idempotent POST |
| `waitForDelivery`/`validateAfterWorkerStop` read the **bare** origin with `git -C` | `safe.bareRepository=explicit` is injected by Copilot CLI via `GIT_CONFIG_KEY_*`, so git refuses and a *pushed* branch read as "publication did not settle" | use `--git-dir` for bare repos (as `verifyGit` already did) |
| `--max-ai-credits 30` | a mission wrote its report, ran out of budget before committing, teardown destroyed the work | raised to 60; cap retained |
| Citation instruction said only "as path:line" | agent mixed full paths with bare-filename shorthand; unverifiable | prompt now demands a repo-root-relative path for **every** citation |

**Any agent running the harness from a Copilot CLI shell inherits `GIT_CONFIG_KEY_0=safe.bareRepository=explicit`.
Always address bare repos with `git --git-dir`, never `git -C`.**

## 3. Production batch — 10/10 PASSED
Run **`2026-09-11T12-17-25-014Z-1a3691`**, state `passed`. Project
[Aeon OS production verification](https://aeon.shadow-lab.ai/project/e4b0af95-d3ad-46ba-8275-1ecc28911683).

- 10 sessions, 10 report-only commits, **0 leftover checkouts**, all 10 cards in **Landing**.
- **20.9 min wall** (12:17:56→12:38:15); per mission 60–113s, mean 90s; **1 premium request each**.
- **Model provenance: 10/10 provably `claude-sonnet-5`** from provider telemetry — closes the old "observed
  identity unknown" gap **in substance**. But the platform still records `observedModel:"unknown"` in all ten
  attempt records: the evidence is in the event stream and is simply not captured. Fixable assurance gap.
- Reports: `aeon_os/workflows/results/2026-09-11T12-17-25-014Z-1a3691/reports/01.md … 10.md`; full evidence in
  `attempt-01.json … attempt-10.json` (report text, sha256, `baseSha`, timings).
- Topics in order: session claim ownership · result envelope parsing · mission worktree retention · Hangar launch
  editor · auto-drop launch behaviour · mission cancellation · runner repository registry · Flight Deck telemetry
  · terminal result retries · engine model arguments.

## 4. THE HEADLINE PROBLEM — mechanical PASS ≠ good work
Three independent reviewers re-read every claim against pinned revision `3b7b3f30`, reading the cited lines.

| Verdict | Count | Attempts |
|---|---:|---|
| PASS (clean) | **0** | — |
| PASS_WITH_CORRECTIONS | 6 | 1, 3, 4, 5, 7, 9 |
| **FAIL** | **4** | 2, 6, 8, 10 |

All three independently concluded: **not trustworthy to a paying user**. Not cosmetic — each failure contains a
claim the cited code disproves (e.g. attempt 2's "every envelope is sanitized before any caller sees it" is
contradicted by `extractEnvelope` in the same file). **Citation drift is systematic even in passing reports.**
The harness cannot see this: it only checks the path exists and the line number is in range.

## 5. Production API acceptance — 12/15
`aeon_os/workflows/prod-acceptance.mjs` (new). Ran live, test project only, no worker started, all temp cards and
sessions cleaned up, the 10 mission cards untouched. Exits non-zero until the defects below are fixed.

| # | Defect | Note |
|---|---|---|
| 4 | `not-a-uuid` project id reaches the DB → **500** | missing syntactic UUID validation before query |
| 7 | Invalid `metadata.hangar.objective` **accepted (201)** | session metadata is free-form; Hangar objective validator not enforced |
| 10 | 4 concurrent launches → exactly **1** session (money IS safe, unique index holds) but the 3 rejections return opaque **500** instead of a duplicate 4xx | UX/contract defect only |

Design risk (passed as a check, still serious): **every** objective incl. `implement`/`bug_fix` can report
`completed` with no branch, no commit, no artifacts, and an empty `summary`.

## 6. New tooling (untracked, under `aeon_os/workflows/`)
- `review-bundle.mjs` — builds a reviewer package: report text + every citation resolved to its **actual source
  line at the pinned revision** via `git --git-dir`. Handles both evidence shapes. Fails loudly instead of
  returning an empty list.
- `prod-acceptance.mjs` — the 15-check production suite above.
- `verification-1109.md` — the full evidence record. Read this first for detail.

## Immediate next work
- [ ] **Wire independent review into the PASS gate in `run.mjs`.** This is the top recommendation. Today the gate
      measures plumbing and review is a postscript, which is why "10/10" and "not trustworthy" are both true.
      `review-bundle.mjs` already emits exactly what a reviewer needs.
- [ ] Fix the three API defects (§5) — all small and localised.
- [ ] Capture `observedModel` from the event stream instead of writing `"unknown"`.

## Boundaries that remain open
- Only the `recon` objective has ever run. `plan`/`analysis`/`implement`/`bug_fix` are **unexercised**, and the
  harness's report-only validator cannot pass `implement`/`bug_fix` as written.
- The harness bypasses `spawnSessionFromCard`, so **Save & Launch has never been clicked**. Authenticated browser
  launch, reload/result display and visual acceptance remain NOT RUN.
- Unbuilt: multi-repo, 2+ concurrent missions, worker crash / **lease expiry / reclaim**, result-retry recovery,
  rerun/idempotency, quota exhaustion.
- **No shift lease / fencing token** — user wants a single-manager "shift" model (local CLI observer ↔ cloud
  orchestrator, only ever one on duty). Heartbeats exist; expiry, auto-reclaim and fencing do not. Design agreed
  this session: a `hangar_shift` row with `holder_id`, monotonic `epoch`, `heartbeat_at`; acquire by
  `UPDATE … SET holder=me, epoch=epoch+1 WHERE heartbeat_at < now() - 90s OR holder=me`; every manager write
  carries its epoch and stale epochs are rejected, so a laptop waking from sleep is fenced out. Keep
  **observer ≠ executor**.
- `apps/web/.env.local` `DATABASE_URL` points at the **production Neon DB** (live closed beta). Local dev writes
  real rows. User declined to treat this as a finding, but know it before running anything locally.

## Resume commands and operational context
- Credentials are in ignored `apps/kairos-worker/runner.env.bat`. Parse only literal `SET` keys
  (`AEON_BASE_URL`, `KAIROS_AEON_API_KEY`, `KAIROS_COPILOT_DEFAULT_MODEL`). Never print them.
- From repo root, always: `$env:NODE_TLS_REJECT_UNAUTHORIZED='1'` and `node --use-system-ca`.
```
node --use-system-ca aeon_os/workflows/run.mjs status      # -> 2026-09-11T12-17-25-014Z-1a3691, passed
node --use-system-ca aeon_os/workflows/run.mjs preflight
node --use-system-ca aeon_os/workflows/prod-acceptance.mjs # exits 1 until §5 defects are fixed
node aeon_os/workflows/review-bundle.mjs --run=2026-09-11T12-17-25-014Z-1a3691
cd apps/kairos-worker; npm run test                        # 144/144, no flags needed
```
- A `passed` run cannot be extended; `prepare --new` is only accepted from `failed` or `passed`. Failure receipts
  are deliberately retained — **never repair a historical result into a pass**.
- Worker port 8799 (harness). Normal worker 8787; Hangar launcher 8790.
- All work is **uncommitted** on `feat/member-avatar-styling`. `aeon_os/` is untracked in full.
  Pre-existing (not mine): `MissionEditorModal.tsx`, `hangar-models.ts`, the three web `__tests__` files,
  `docs/aeon-flight-manual-0709.html`, `apps/kairos-worker/README.md`. Mine: `worktree.ts`, `worktree.test.ts`,
  `vitest.config.ts`, and everything under `aeon_os/workflows/`.

**First action:** Read `aeon_os/workflows/verification-1109.md`, then wire the independent-review gate into
`run.mjs` using `review-bundle.mjs`. Do not re-run the ten-job batch to "re-prove" delivery — that is settled.
