# Agent mission UI and runner verification — 21 September 2026

Initial scope: local v0.29.0 preparation on `docs/handover-1709-close`.
The implementation checks below preceded the explicitly authorized live Swarm
research exercise recorded in `PRODUCTION_SWARM_2109.md`. That later exercise
registered Swarm and ran production missions; it did not deploy the v0.29.0 UI,
commit, or push. Pre-existing runner edits were preserved and completed in the
shared working tree.

## Delivered

- Agent missions use `metadata.hangar` as their type discriminator, with a
  dedicated card face, configuration/details, current run status and recorded
  result. Repository/objective are mission fields; labels are not execution data.
- Quick Add persists an incomplete mission before opening configuration, so
  cancellation and reload preserve its type. Existing mission metadata renders
  without a migration.
- The Hangar toolbar has a realm-scoped repository directory with add, edit,
  retire and restore. Registry slugs use the same contract as missions.
- Shared project members can read narrowly scoped card/session status. Launch
  confirmation preserves unrelated dirty state and board refresh.
- UI-enabled Hangar boards use existing Landing/Tower result routing.
- Runner effort/context and credit bounds are validated, forwarded and recorded;
  Windows startup loads the adjacent environment file and returns through npm.
- Architecture, roadmap, changelog and displayed application version are aligned
  at 0.29.0. Package scaffold versions remain unchanged.

## Verification

| Check | Result |
|---|---|
| Web Vitest, `npx vitest run --minWorkers=1 --maxWorkers=4` in `apps/web` | 233 files, 3,909 tests passed |
| `node apps/web/scripts/run-session-capture-tests.mjs` | 44 passed |
| Full kairos-worker suite | 164 passed, including worktree lifecycle tests |
| `node --test aeon_os/workflows/review-gate.test.mjs` | 71 passed, including production config/receipt and isolated Windows launcher checks |
| Root `npm run typecheck` | Web and worker passed |
| Root `npm run lint` | Passed: 0 errors, 44 warnings |
| Root `npm run build` | Passed production compilation and page generation |
| Changelog mirror / APP_VERSION / `git diff --check` | Passed |
| Final editor opacity polish | 17 editor tests passed; browser checks repeated |

An initial unrestricted full web run passed all assertions but exited with a
Vitest worker termination error. The bounded four-worker rerun above exited
cleanly and then completed all capture checks.

## Horsemen review

All four native reviewers ran against the coherent change. Warden and Judge
finished PASS. Stalker finished PASS after coverage gaps were closed. Butcher
reported minor cleanup notes; the duplicate launch reconciliation, unused DTO
fields and obsolete budget comment were removed. No blocking findings remain.
These were native role reviews, not a claim of different-model independent
research acceptance.

Review corrections included shared-card status access, preserving board refresh
after launch, consistent repository slug validation, and retaining mission type
when initial configuration is cancelled.

## Browser evidence and limits

Actual board, mission editor/details/results and repository components were
exercised at desktop 1440px and mobile 390px using mocked server actions. Checked
mission opening/configuration, input-required results, repository add/edit/retire,
ordinary cards, and no horizontal page overflow. Final run: zero page errors,
zero live missions launched. Local script, screenshots and JSON evidence are
under ignored `.cache/hangar-ui/`; they are fixture evidence, not deployment proof.
The mission editor was made opaque after visual inspection found background
text showing through it.

Signed-in production acceptance remains outstanding. The test browser reached
login; no authentication was fabricated. Latest recorded production acceptance
remains the separate 17 September evidence in `HANDOVER_1709.md`.

Durable artifact delivery, verified branch publication, automatic draft PRs,
runner supervision and stale-session recovery remain unfinished. A recorded
completed result or this local test pass does not establish those capabilities.
The separate safety workstream was not undertaken. The later Swarm exercise
uses explicit output in the canonical repository to preserve its HTML reports;
that scoped workaround does not implement general artifact delivery.

## Release preparation follow-up

The owner subsequently authorized PR #130 and production release. Final local
checks repeated successfully: web 3,909 tests, capture 44, worker 164, review gate
71, root typecheck and lint (zero errors, 44 warnings). Final workflow review
then corrected Save draft to accept incomplete valid setup while preserving
strict launch checks; all 18 focused editor tests passed, including incomplete
draft persistence without spawning a session. No migration is required.
Deployment and post-deploy smoke evidence are tracked on PR #130.
