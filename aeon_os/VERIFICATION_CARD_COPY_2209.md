# Card extraction, native copying and planning evidence

**22 September 2026 · local changes only · not deployed**

## Delivered locally

- Shared card right-click and ellipsis menu includes **Extract contents**.
- Selectable modal presents title, description, all checklist groups/items, completion state, label names and configured priority name. Done and Not doing remain simple text beside normal bullets.
- Top-right copy control writes plain and escaped rich HTML, falls back to plain text, and gives a manual-selection message if browser copying fails. Multiline content is preserved.
- Board Ctrl/Cmd+C/V no longer steals native text/editor/dialog copying. Modified keys cannot fall through to bare-letter actions. Internal card paste requires a valid copied card in the active project.
- A modeless pinned card leaves board shortcuts available while keys inside that card remain native.

## Checks

| Check | Result |
| --- | --- |
| Final web Vitest, bounded four-worker run | **237 files / 3,934 tests passed**, exit 0 |
| Session-capture checks | **44 passed** |
| Root typecheck | Passed web and worker; extraction follow-up typechecks also passed |
| Root ESLint | Passed, 0 errors / 44 existing warnings; follow-up owned-file lint passed |
| Production build | Passed, including compilation and type checking |
| Diff whitespace check | Passed |
| Isolated extraction component render | Actual component/CSS with mocked read action; screenshot and rendered DOM confirmed full content |
| Planning HTML | Internal anchors and relative-file links valid; desktop render inspected |
| Preview shutdown | Temporary port 3012 listener stopped and verified absent |

Initial integrated test run exposed two old card fixtures importing the new authenticated modal action. Those tests now mock the unrelated modal child. The complete rerun above passed.

The keyboard regression suite first reproduced the prior behavior (nine failing cases in its initial eleven-case run), then passed with the fix. Correctness review found a modeless-dialog regression and checklist-state omission; both were corrected and regression coverage added before the final integrated run.

Ignored local evidence lives under `.cache/card-extract-2209/` (test/build logs, mocked render/screenshot) and `.cache/agent-os-guide-2209/` (planning HTML render).

## Verification boundaries

- Browser rendering used a local Chrome process, not Playwright MCP. The component's read action was mocked; no authenticated production interaction was exercised.
- Keydown handling and copy serialization/fallbacks were exercised by DOM tests. Actual operating-system clipboard behavior and the user's signed-in production symptom remain unconfirmed. The bug is not declared production-closed.
- The extraction covers the fields explicitly listed in the request. Hangar-specific execution metadata is not part of this export.
- Agent OS source/web auditing and attachment scoping were read-only. No Agent OS runner, mission, live exploit, storage provisioning, migration, Git commit, push, PR or deployment was performed.

## Planning outputs

- [Agent OS audit and next iteration](NEXT_ITERATION_2209.html): twelve source-confirmed gaps, six connected implementation phases, five adoption gates, official research and explicit deferred scope.
- [Separate attachment scope](ATTACHMENTS_SCOPE_2209.html): historical unreleased prototype, current absence, private card/project file contract and staged acceptance.
- Markdown companions are retained beside the HTML for the next implementation session.
