# Session Claim Ownership — Recon Report

Marker: AEON_OS_E2E_2026-09-10T16-18-20-247Z-510469_01

Scope: `apps/web/src/lib/data/sessions.ts` (claim/heartbeat logic) and
`apps/web/src/lib/data/__tests__/sessions-claim.test.ts`.

## Findings (observed code)

1. **`claimNextSession` defaults to a fixed engine allowlist.** The function
   signature accepts an `engines` parameter defaulting to `CLAIMABLE_ENGINES`,
   which is the literal array `['claude', 'codex', 'copilot']`.
   (`apps/web/src/lib/data/sessions.ts:18`, `apps/web/src/lib/data/sessions.ts:150-153`)

2. **The claim predicate is a four-part security boundary, not a plain
   filter.** Inside the transaction, the candidate-selection `where` clause
   requires `agentSessions.userId` to match the caller, `status = 'queued'`,
   `taskId IS NOT NULL`, and `engine IN (engines)` — all four combined with
   `and(...)`. The `IS NOT NULL` check on `taskId` is called out in the
   surrounding comment as mandatory because kairos-chat/dialogue rows share
   the same table and must never be claimable.
   (`apps/web/src/lib/data/sessions.ts:159-164`, comment at
   `apps/web/src/lib/data/sessions.ts:142-146`)

3. **Row selection uses `SKIP LOCKED` and the transaction body is
   intentionally minimal.** The select chain ends with
   `.for('update', { skipLocked: true })`, letting multiple runners poll
   concurrently without blocking on each other's in-flight claims. An adjacent
   comment states nothing but the lock and the subsequent update may happen
   inside the transaction, because the Neon pool times out an acquire at 8s,
   so anything else risks stranding the pool.
   (`apps/web/src/lib/data/sessions.ts:163`, comment at
   `apps/web/src/lib/data/sessions.ts:147-149`)

4. **A successful claim always sets six fields together.** On finding a
   candidate, the update sets `status: 'running'`, `claimedBy: workerId`,
   `claimedAt`, `lastHeartbeatAt`, `startedAt`, and `updatedAt` all to the
   same `now` timestamp in one `.set(...)` call, scoped `where` to
   `agentSessions.id = candidate.id`.
   (`apps/web/src/lib/data/sessions.ts:174-183`)

5. **`heartbeatSession` re-checks ownership and running-state on every ping,
   not just at claim time.** Its `where` clause requires matching `id`,
   `userId`, `claimedBy = workerId`, and `status = 'running'` simultaneously,
   and returns `null` (rather than throwing) if the session was reassigned,
   killed, or finished — the caller comment frames this as a cooperative stop
   signal for the runner.
   (`apps/web/src/lib/data/sessions.ts:192-201`, comment at
   `apps/web/src/lib/data/sessions.ts:188-191`)

## Findings (test-file evidence)

6. **The dedicated claim test module documents the same invariants as
   executable expectations.** Its header comment states `claimNextSession`'s
   predicate is "a security boundary, not a filter: user-scoped, card-linked
   only ... queued only, engine-narrowed," and separately notes
   `recordSessionResult` "must never re-apply a result to a session that
   already settled" — i.e. claim correctness and result idempotency are
   treated as two halves of the same ownership contract.
   (`apps/web/src/lib/data/__tests__/sessions-claim.test.ts:5-8`)

## Inference (not directly asserted in code/comments)

- The `SKIP LOCKED` + single-row `LIMIT 1` pattern combined with the narrow
  transaction body suggests the design deliberately optimizes for high
  concurrent-runner throughput under Neon's short pooled-connection acquire
  timeout, at the cost of not doing any additional validation inside the
  transaction — such validation is presumably pushed to callers or to
  `heartbeatSession`/result-recording paths instead.

