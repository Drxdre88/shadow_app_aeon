# Recon: Session Claim Ownership

Marker: AEON_OS_E2E_2026-09-10T16-29-31-771Z-238d57_01

Scope: `apps/web/src/lib/data/sessions.ts` and its focused claim tests in
`apps/web/src/lib/data/__tests__/sessions-claim.test.ts`.

## Findings

1. **Claim is user-scoped, card-linked, queued-only, and engine-narrowed inside a single transaction.**
   Observed: `claimNextSession` (`apps/web/src/lib/data/sessions.ts:150`) opens a `db.transaction`
   whose candidate SELECT filters on `eq(agentSessions.userId, userId)`,
   `eq(agentSessions.status, 'queued')`, `isNotNull(agentSessions.taskId)`, and
   `inArray(agentSessions.engine, engines)` (lines 154-165). This is corroborated by the
   compiled-SQL assertions in the test at
   `apps/web/src/lib/data/__tests__/sessions-claim.test.ts:112-115`, which check the literal
   WHERE clause (`user_id = $1`, `status = $2`, `task_id is not null`) and that `OTHER_USER`
   never appears among bound params.

2. **Row locking uses `FOR UPDATE SKIP LOCKED` so concurrent runners never block each other.**
   Observed: `.for('update', { skipLocked: true })` at
   `apps/web/src/lib/data/sessions.ts:167`. The test
   `apps/web/src/lib/data/__tests__/sessions-claim.test.ts:126` asserts
   `captures[0].forArgs` equals `['update', { skipLocked: true }]`, directly confirming the
   locking mode reaches the query builder unchanged.

3. **A partial unique index, not application logic, is the sole guard against two live missions per card.**
   Observed: `sessions.ts:36` defines `ONE_LIVE_PER_TASK_IDX =
   'agent_sessions_one_live_per_task_idx'`, and `createAgentSession`
   (`apps/web/src/lib/data/sessions.ts:63`) catches a Postgres error whose message includes that
   index name and rethrows it as `LiveMissionExistsError` (class defined at
   `apps/web/src/lib/data/sessions.ts:29`). Inference: the comment above `createAgentSession`
   states this index is authoritative because it "covers the REST/MCP spawn surfaces, which
   never ran that check," but the REST/MCP call sites themselves were not part of this
   recon's scope and were not inspected to confirm that claim.

4. **`recordSessionResult` guards against replay by putting the terminal-status check in the UPDATE's WHERE clause, not in a prior read.**
   Observed: the update at `apps/web/src/lib/data/sessions.ts:262` filters with
   `notInArray(agentSessions.status, TERMINAL_STATUSES)` inside the same `db.transaction` used
   to patch the card. The test `apps/web/src/lib/data/__tests__/sessions-claim.test.ts`
   ("processes the card exactly once when two result posts race") simulates two racing calls
   sharing the same pre-read session row and asserts only one produces a card update and one
   `touchProject` call, confirming the race is resolved by Postgres row-affect count rather
   than by a check-then-write pattern in application code.

5. **`heartbeatSession` re-checks ownership, worker identity, and running status on every ping.**
   Observed: `apps/web/src/lib/data/sessions.ts:192` builds its WHERE from `eq(agentSessions.id,
   id)`, `eq(agentSessions.userId, userId)`, `eq(agentSessions.claimedBy, workerId)`, and
   `eq(agentSessions.status, 'running')`. No test in
   `sessions-claim.test.ts` exercises `heartbeatSession` directly — this file's test coverage is
   scoped to `claimNextSession`, `recordSessionResult`, and the `scrubPgText`/`scrubJsonb`
   helpers only (confirmed by the `describe` blocks in the test file).

## Notes on inference vs. observation

All five findings above cite specific `path:line` locations for the observed code and/or test
assertions. Item 3 contains one explicitly flagged inference (about REST/MCP call sites) that
was not independently verified within this recon's bounded scope.
