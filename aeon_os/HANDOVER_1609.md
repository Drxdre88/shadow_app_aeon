# Beacon: Aeon OS acceptance SHIPPED — PR #127 merged, prod acceptance 15/15, quality gate armed but never fired

**Date:** 2026-09-16  **Repo:** shadow_app_aeon  **Branch:** main at `1d8beea` (PR #127 merge)
**Status:** Everything from the 1209 handover is LIVE on https://aeon.shadow-lab.ai. Production acceptance now
**15/15**. The independent-review gate exists in the harness but **no real `review` run has ever executed**.
Nothing uncommitted. Next session is about USING the gate, not building it.

## What shipped (PR #127, merged 2026-09-15 18:56Z by owner; auth-smoke on main green 18:59Z)
| Commit | What | Where it matters |
|---|---|---|
| `5b038fd` | Worker teardown: bounded retry of the whole safe sequence for a cwd-pinned worktree on Windows | `apps/kairos-worker/src/worktree.ts`; vitest timeouts in config |
| `4027f84` `0e36c21` | Hangar model picker (per-engine catalog + custom id) after warden fixes; launch coverage tests | `MissionEditorModal.tsx`, `lib/hangar-models.ts` |
| `8c94e5e` | Malformed project/session ids → 404, not 500 (check 4) | `api/v1/projects/[id]`, `sessions/[id]`, `sessions/[id]/kill` |
| `f37b9db` | Spawn validates `metadata.hangar` (check 7); duplicate launch → 409 with winner id (check 10); REST + MCP parity | `validators/hangar.ts`, `data/sessions.ts`, both spawn surfaces |
| `b874d10` | Copilot stream parser → `observedModel` populated from `session.start` | `apps/kairos-worker/src/stream-parser.ts`, `engines.ts`, `poller.ts` |
| `6582a2d` `c035d6d` | Harness with independent-review PASS gate + docs | `aeon_os/workflows/` |
| `5e4c7fa` | Aeon OS docs, readiness, flight manual, handovers | `aeon_os/`, `docs/` |

Review record: two warden waves. Gate wave = 1 blocker (import could overwrite a FAIL with a PASS) + 10 findings, all
fixed, 49 `node --test` cases. API wave = nits fixed (text-match only on coded 23505; envelope counters clamped).

## Verified on production, 2026-09-16
`node --use-system-ca aeon_os/workflows/prod-acceptance.mjs` → **exit 0, 15/15 PASS** (was 12/15 on 1109).
Checks 4/7/10 now return 404 / 400 / 409 respectively; four concurrent launches → one session + three 409s naming the
winner. Temp cards and sessions cleaned up; the ten 1109 proof cards untouched (`completed` / Landing / marker).
Check 14 still reports the design risk: every objective can `completed` with no branch, commit, artifacts.

## The gate, as it stands (never exercised for real)
- `run.mjs run` now ends at `review_pending`; `run.mjs review` builds each attempt's bundle (report + every citation
  resolved to the real source line at the pinned revision) and dispatches a reviewer from `bootstrap.json.review`
  (copilot / `gpt-5.6-sol`, 30 credits, 15 min) that must differ from the mission model. cwd = mkdtemp outside the
  working tree; `--deny-tool` shell/write/url; `--secret-env-vars`; process tree killed on timeout.
- `passed` only when every attempt has a stored verdict of exactly `PASS`; PWC or FAIL → `failed` (failureKind
  `review`, receipt kept, exit 1); malformed / misattributed reviewer output → unreviewed, never PASS.
- `review --import <file> --attempt=N [--force]`: refuses to overwrite without --force, NEVER replaces a stored
  non-PASS with a PASS, refuses a file naming a different run/attempt.
- Terminal runs immutable (`run --count` refuses passed/partial_pass); `prepare --new` accepts
  failed|passed|partial_pass|review_pending (review_pending archives as `abandoned:true`).
- Legacy run `2026-09-11T12-17-25-014Z-1a3691` stays `passed` + `legacy:true`; it is NOT reviewable via the tool.
- **Untested against a real reviewer:** the JSON-verdict prompt, `--deny-tool` append-vs-replace semantics (ordered
  with `shell` last as a hedge), reviewer provenance (`observedModel`) from the copilot usage event, bundle size
  (real bundles 15–27k chars; oversize is refused, not filed).

## Immediate next work (in order)
- [ ] **Fire the gate for real.** `prepare --new` → a SMALL batch (`--count=2` or 3, recon objective) →
      `run` → `review`. Expect surprises in prompt/JSON parsing on the first go; fix in `review.mjs`, re-run
      `review` only (attempts already mechanically validated are not re-run). Costs ~1 premium request per
      mission + 1 per review. Do NOT re-run the ten-job batch.
- [ ] Read the first verdicts against the bundle by hand once — the gate is only as good as the reviewer prompt.
- [ ] Owner: one browser **Save & Launch** on the test project (never clicked; only REST spawn has been exercised).
- [ ] Then the objective-completion contract: implement/bug_fix must require branch+commit (or artifacts) before
      `completed` — check 14's standing risk; the harness's report-only validator also cannot pass those objectives.

## 1609 afternoon — the gate FIRED for real (three runs, two harness defects fixed, verdict legit)

**State at close:** `aeon_os/workflows/` has UNCOMMITTED fixes (review.mjs, review-bundle.mjs, run.mjs, tests, README)
plus three new evidence folders under `results/`. Gate suite **56/56**. Warden pass DONE (6 findings + 3 nits) AND full horsemen
(butcher PASS, judge + warden PASS_WITH_NOTES, stalker FAIL → six end-to-end gate tests added via seams on runReview/dispatch, floor moved into `assertCitationFloor`; suite 62/62) with every finding folded in: receipt token,
usage scanned + kept outside the sandbox, exit-grace against a pipe-holding grandchild, numeric prose (`3.5:1`) no
longer aborts, bounded continuation guard that also spots bare file names, `@` accepted in the floor regex.

| Run | What happened | Receipt |
|---|---|---|
| `2026-09-16T14-52-00-295Z-86cdc5` | `run --count=2`: attempt 1 PASS mechanically; attempt 2 FAILED mechanically — the mission (claude-sonnet-5) cited `envelope.test.ts:189-192, 202-205` in a 178-line file (real tests sit at ~167-177). Harness correct, run terminal `failed`. | `results/…86cdc5/` |
| `2026-09-16T14-58-19-989Z-0f2824` | `run --count=1` PASS mechanically → `review`: **defect 1** bundle 31,754 chars > 24,000 argv cap → NOT REVIEWED. Patched to stdin+`-p` → reviewer returned FAIL "no bundle present": **defect 2**, Copilot IGNORES piped stdin when `-p` is present (GitHub docs say so; probes confirmed). That FAIL is a harness artefact, but the run is terminal and immutable by design. | `results/…0f2824/reviews/01.json` (FAIL, artefact) |
| `2026-09-16T15-10-24-504Z-24c870` | `run --count=1` PASS mechanically → `review` with stdin-only delivery: **reviewer gpt-5.6-sol (observedModel verified) read the bundle and returned FAIL with 10 findings in 52 s.** Hand-checked: findings 2/7/8 are real citation drift (fixture line cited as a test title; `cardUpdates()` cited at :82-84, it is at :74; a comment cited for a constant). Finding 5 exposed **harness gap 3**: the report's shorthand `:173, :187, :234, and :245` continuations were never resolved into the bundle, so three CORRECT assertions looked unverifiable. | `results/…24c870/reviews/01.json` (FAIL, legit) |

### Fixes in the working tree
- `review.mjs`: whole prompt piped to stdin, `-p` never passed (`reviewerArgs` has no `-p`; test asserts it). `MAX_INLINE_PROMPT` → `MAX_BUNDLE_CHARS = 400_000`, `inlineFits` → `bundleFits`. `dispatchCopilotReview({ stdinText })`, stdio pipe, EPIPE tolerated. `promptDelivery: 'stdin'` in every verdict.
- `review.mjs`: `observedModelFromUsage()` — real `--usage-output-file` shape is `currentModel` + `modelMetrics{<id>}` (probed on CLI 1.0.85); the old `usage.model` key never existed, so provenance had been silently null. Multi-model sessions join as `a+b` and fail provenance.
- `review-bundle.mjs`: `extractCitations` exported; sticky `CONTINUATION_PATTERN` expands `, :N`, `and :N`, ranges. `run.mjs` unions those into mechanical validation (original strict regex kept). The 24c870 report now yields 26 citations instead of 21.
- `run.mjs`: progress label shows `NN/<batchTarget>` instead of a hardcoded `/10`.

### Warden round (all closed in the tree)
- **Proof of receipt (medium, then hardened by horsemen):** the verdict JSON must echo `"receipt"` — a random uuid per
  dispatch placed ONLY on the last line of the piped bundle (`receiptEchoError`). The marker was tried first and rejected
  by the warden: it is `AEON_OS_E2E_<runId>_NN` and the run id sat in the instruction header, so it was reconstructible;
  the header now names only the attempt. Stored records also carry the marker and a record filed under an attempt with a
  different marker counts as unreviewed at gate evaluation. A bundle whose report was suppressed is refused before dispatch.
  `dispatchCopilotReview` refuses an empty/non-string `stdinText` before spawning.
- **Ceiling tied to a measurement (medium):** `MAX_PROMPT_CHARS = 110_000` (renamed from MAX_BUNDLE_CHARS by the judge), just under a 118,754-char stdin probe that
  was fully inlined (lastCallInputTokens 38,159) and answered. Raise only after a bigger probe.
- **Continuation misattribution (low-med):** a shorthand `:N` is dropped when the rest of its clause names another
  path-like token that is not itself a citation (`clauseNamesAnotherPath`); live forms `x:65 and :68` still resolve.
- **Floor unchanged (low):** the 3-citation floor counts only explicit `path:line` tokens.
- **Timestamp abort (low, pre-existing):** a bare `15:10` / `3.5:1` no longer throws `invalid citation path`; only a
  directory-less token WITH a file extension is rejected.
- **Usage kept (low):** the raw `--usage-output-file` JSON is stored under `reviewer.usage` in every record.
- Nits: `bundleFits` boundary asserted both sides; stdin delivery locked by a fake reviewer (node -e reads stdin,
  echoes byte count + last line; `dispatchCopilotReview({ buildArgs })` is the test-only seam); README wording fixed.
- Copilot CLI is now 1.0.85 (flags re-probed: all present; `--max-ai-credits` minimum is 30).

### Verified / not verified
- Verified live: JSON verdict parsing, severity/PASS consistency, provenance from usage file, sandbox flags accepted, stdin-only delivery inlines the full prompt (input tokens +8k on a 37k-char probe), reviewer tree exits 0 and cleans scratch.
- NOT verified: a PASS verdict end-to-end (every real report so far drifted on test-file line numbers); `--deny-tool` append-vs-replace still hedged by ordering; a >400k-char bundle path.

### Next (in order)
1. Commit the harness fixes + the three receipts as one `fix(aeon-os)` commit (do not repair any receipt). Then the
   next `review` dispatch is the first to demand the marker echo — expect that to be the first thing to break if the
   reviewer ignores the new field; fix the contract wording in `OUTPUT_CONTRACT`, not the check.
2. Mission-side: sonnet-5 recon reports drift on line numbers in TEST files in 3/3 real runs. Tighten the mission prompt in `run.mjs` (`missionPrompt`) to demand `path:line` for every assertion and forbid shorthand — or accept that the gate's job is exactly to catch this and leave it. Decide, then one more `prepare --new` + `run --count=1` + `review` to chase the first real PASS.
3. Owner: browser Save & Launch (unchanged). Then the objective-completion contract (unchanged).

## Parked (on card "Fix Aeon live bugs and hardening", group "API hardening (from 1209 acceptance)")
- 45 more `/api/v1/**/[id]` routes pass raw path segments to Postgres (same 500 class; needs a shared helper).
- Spawn has no project-membership check on `taskId` — a caller can spawn against a foreign card and
  `recordSessionResult` later rewrites that card (pre-existing).
- implement/bug_fix can complete with nothing delivered (see above).
- `apps/kairos-worker/src/engines.ts` passes every mission prompt as `-p` (claude, copilot, codex). Not hit by the stdin-ignore rule (no stdin is piped), but a mission prompt above ~32k chars would die on the Windows argv cap; copilot would need stdin-only delivery like `review.mjs` (1609).

## Board
Card **AEON: Hangar Sprint 3** (Live), group "3D Aeon OS acceptance (1209)": 7/8 checked; open = browser Save &
Launch. Card stays in Live until owner confirms the sprint. Do not create a new card for gate usage — add items to 3D.

## Resume commands
```
$env:NODE_TLS_REJECT_UNAUTHORIZED='1'                 # always, from repo root
node --use-system-ca aeon_os/workflows/run.mjs status # legacy run 1a3691, passed, legacy:true
node --use-system-ca aeon_os/workflows/run.mjs prepare --new
node --use-system-ca aeon_os/workflows/run.mjs run --count=2
node --use-system-ca aeon_os/workflows/run.mjs review
node --use-system-ca aeon_os/workflows/prod-acceptance.mjs   # 15/15 as of 1609
node --test aeon_os/workflows/review-gate.test.mjs           # 49/49
cd apps/kairos-worker; npm run test                          # 155/155
```
Creds in ignored `apps/kairos-worker/runner.env.bat` (never print). Worker port 8799 (harness) / 8787 / 8790.

## Traps carried forward
- Copilot CLI shell injects `GIT_CONFIG_KEY_0=safe.bareRepository=explicit`: bare repos need `git --git-dir`.
- Repo files are CRLF: python `str.replace` with `\n` in the needle silently matches nothing.
- Pushes hang on this machine (GCM GUI prompt + wrong active gh account): use the inline-token recipe in memory.
- `.env.local` IS production Neon. Drizzle journal frozen at 0010: never `db:push` / `db:generate`.
- `aeon_os/workflows/results/` receipts are committed and immutable; never repair one into a pass.

**First action:** read `aeon_os/workflows/README.md` (gate section), then `prepare --new` + `run --count=2` +
`review`, and fix whatever the first real reviewer round breaks.
