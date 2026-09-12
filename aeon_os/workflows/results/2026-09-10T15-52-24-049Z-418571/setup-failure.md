# First production attempt — FAIL before agent launch

Date: 10 September 2026. Production project: `e4b0af95-d3ad-46ba-8275-1ecc28911683`. Card: `3bd8dc3f-d4a8-4a00-87c5-2b21cbc0f89b`. Session: `5c78a299-b7e4-482d-8c97-29983bdf4323`.

The production API accepted the session and worker `002LND2094-236993` claimed it. Checkout creation then failed before a Copilot process started. The session persisted as failed and the harness stopped its worker.

Runner error:

```text
git worktree add failed for aeon/3bd8dc3f
fatal: a branch named 'aeon/3bd8dc3f' already exists
```

A direct detached-worktree reproduction at the same path depth exposed the original checkout error:

```text
error: unable to create file inferno-specs/aeon-core/2503_linear-style-instant-feel-audit/assets/architectural_archaeology_2503_1530.md: Filename too long
fatal: Could not reset index file to revision 'HEAD'.
```

The initial remote-base attempt created the branch before checkout failed. The runner then attempted to create that same branch from the local base and reported the second error, hiding the path-length cause. The test clone had no `core.longpaths` setting. The next isolated test clone will enable it; the operator checkout and global Git configuration remain unchanged.

This failed attempt is not counted as a successful end-to-end run. The local reproduction's partial checkout is retained under this ignored run directory; no recursive cleanup was attempted.

Mitigation verified locally: enabling `core.longpaths=true` only in the failed run's isolated source clone allowed a second detached checkout at the same depth (`aeon-longpath-proof`) to complete with exit code 0 and all 1,262 files. Both diagnostic checkout paths remain inside this ignored run directory. This verifies checkout creation, not agent execution or delivery.
