# Recon: Realtime Board Sync Pipeline (Hangar POC 1)

**Date:** 2026-08-20 · **Mission:** `bebece79-3c55-4a90-b375-2e170c2291e5` · **Objective:** recon (read-only)
**Method:** 3 parallel inferno-prowler lanes (server publish path · client subscription path · polling fallback), synthesized; anchor citations spot-verified against source by the coordinating agent.

---

## TL;DR

A card edit propagates as: **server action → data-layer mutation → `touchProject()` bumps `projects.boardVersion` → fire-and-forget Pusher `board-update` on channel `board-<projectId>` → every other client debounces 300ms and refetches the entire board**. The Pusher payload is `{ type }` only and the client never even reads it — the event is a pure "something changed, go refetch" doorbell. Conflict handling is not merge-based: incoming reloads are simply **refused** while local optimistic state is dirty (or within a 5s grace window), and the 30s poll (which is **always-on**, not a failure-activated fallback) catches up via a `boardVersion` inequality check. The design is deliberately coarse and therefore mostly safe, but it has real gaps: **`comment:changed` is declared but never fired anywhere**, the version bump is never in the same transaction as the mutation, there is no socket_id self-echo exclusion, no Pusher-reconnect resync, and a remote edit arriving during a local drag is silently dropped for up to ~35s.

---

## 1. End-to-end path (a card edit, client A → client B)

```
Client A                         Server                                  Client B
────────                         ──────                                  ────────
boardStore mutator               updateBoardTask (actions/board.ts:100)
 (optimistic, isDirty=true)  →    requireEditor :118  → zod :120
mutationQueue / directWrite   →   _updateTask (data/tasks.ts:95-134)
                                    db.update(boardTasks) :126-130
                                    await touchProject :132
                                      boardVersion+1 (projects.ts:68-71)
                                      Pusher publish (detached) :73-76
                                        publishBoardEvent
                                        (realtime/index.ts:17)
                                          trigger('board-update',
                                            {type:'task:updated'})   →   channel.bind('board-update')
                                    revalidatePath :144                    (useProjectData.ts:326)
                                                                          isDirtyOrGracePeriod? drop
                                                                          else debounce 300ms →
                                                                          knownVersionRef=null; doFullLoad()
                                                                            loadBoardData → full store replace
                                                                            (useProjectData.ts:49-129)
```

## 2. Server action layer (VERIFIED)

Representative mutation `updateBoardTask` — `apps/web/src/lib/actions/board.ts:100-146`:
auth guard `requireEditor(projectId)` at `:118` (defined `apps/web/src/lib/actions/helpers.ts:39`) → Zod validation `:120` → data-layer call `_updateTask` `:124` → fire-and-forget activity/gantt side-effects `:126-142` (all `.catch(() => {})`, not awaited) → `revalidatePath('/project/${projectId}')` `:144`.

## 3. `touchProject` / `boardVersion` bump (VERIFIED)

`apps/web/src/lib/data/projects.ts:67-78`:
- Awaits `db.update(projects).set({ updatedAt, boardVersion: sql\`boardVersion + 1\` })` (`:68-71`).
- If an `event` is passed, dynamically imports `@/lib/realtime` and calls `publishBoardEvent` **without awaiting** (`:73-76`) — the publish is detached; failures only `console.error`.
- **Never inside the mutation's transaction.** `updateTask` (`lib/data/tasks.ts:95-134`) does a bare `db.update(boardTasks)` then a separate `await touchProject(...)` at `:132`. Mutations that do use `db.transaction` (`createTask` `:75-89`, `deleteTask` `:196-204`, `reorderTasks` `:223-243`) still call `touchProject` **after** commit, never inside it.
- ~40 call sites across `lib/data/{tasks,columns,labels,dependencies,assignees,vault,workspaces}.ts` and `lib/actions/checklist.ts`. `lib/actions/memories.ts:46` documents a deliberate exemption (memory mutations don't bump the board version).

## 4. Pusher publish (VERIFIED)

- Server client: `apps/web/src/lib/pusher.ts:1-21`, singleton from `PUSHER_APP_ID/KEY/SECRET/CLUSTER`; `getPusher()` returns `null` (silent disable) if any env var is missing (`:6-8`). Channel helper `boardChannel(projectId) = 'board-' + projectId` (`:23-25`).
- Publish: `publishBoardEvent` — `apps/web/src/lib/realtime/index.ts:12-21`. Single wire event name **`'board-update'`**; the semantic type rides in the payload: `pusher.trigger(boardChannel(projectId), 'board-update', { type: event.type })` (`:17`).
- Payload is `{ type }` **only** — no entity id, no body, no `boardVersion`. No 4th `socket_id` argument → the originating client receives its own echo.
- `pusher.trigger` failures are try/caught and logged (`:18-20`); no retry, no surfacing. Because the publish is detached from `touchProject`'s return, it races `revalidatePath` and the HTTP response.

### Event type inventory (`BoardEvent` union, `realtime/index.ts:3-10`)

| Event type | Fired from (file:line) |
|---|---|
| `task:created` | `lib/data/tasks.ts:71,91,168`; `lib/data/vault.ts:253` |
| `task:updated` | `lib/data/tasks.ts:132,261,271,282` |
| `task:deleted` | `lib/data/tasks.ts:206,216`; `lib/data/vault.ts:165,213` |
| `task:moved` | `lib/data/tasks.ts:244` |
| `task:assigned` / `task:unassigned` | `lib/data/assignees.ts:92,106`; `lib/data/workspaces.ts:209` (unassign) |
| `column:created/updated/deleted/reordered` | `lib/data/columns.ts:60,83,104,114,130` |
| `label:changed` | `lib/data/labels.ts:50,65,75,92,114,129` |
| `dependency:changed` | `lib/actions/../data/dependencies.ts:43,63,106` |
| `checklist:changed` | `lib/actions/checklist.ts:62,95,103,114,126,138` — only type fired from the **actions** layer, not `lib/data/` |
| `comment:changed` | **NEVER FIRED** — declared in the union (`realtime/index.ts:10`) but `lib/actions/comments.ts` calls neither `touchProject` nor `publishBoardEvent` |

## 5. Client subscription (VERIFIED)

All realtime lifecycle lives in the hook `apps/web/src/app/project/[id]/useProjectData.ts`:
- `pusher-js` init `:310-342`: `new PusherClient(NEXT_PUBLIC_PUSHER_KEY, { cluster })` `:320`, subscribe `board-${projectId}` `:322`. Public channel — no private/presence, no channel-auth endpoint. Missing env vars → silent poll-only degradation (`:313`).
- **One binding**: `channel.bind('board-update', ...)` `:326-333`. The handler takes no argument — the `{ type }` payload is never read; all 13 semantic event types collapse to the same behavior:
  1. `if (isDirtyOrGracePeriod()) return` — drop while local writes are outstanding (`:327`).
  2. Debounce 300ms (`PUSHER_DEBOUNCE_MS`, `:14`).
  3. `knownVersionRef.current = null; doFullLoad()` (`:330-331`) — full `loadBoardData` server action + wholesale `useBoardStore.setState` replace (`:49-129`, `:74-116`). No field-level patching path exists.
- Nulling `knownVersionRef` makes the next poll tick re-seed instead of double-fetching.
- `doFullLoad` carries a request-generation guard `fetchIdRef` (`:45,50,54`): a stale in-flight response is discarded if a newer load started — last-launched-wins, protecting against out-of-order fetch responses (not out-of-order events; full-reload semantics make event ordering moot).

## 6. Dedup / self-echo / versioning (VERIFIED)

- **No socket_id exclusion, no client-generated event ids.** Grep for `socket_id` in `apps/web/src`: zero hits. Self-echo suppression is purely time-window-based via `isDirtyOrGracePeriod()` — `apps/web/src/lib/store/boardStore.ts:294-302`: `isDirty || directWrites > 0 || pendingWriteSources.some(...) || Date.now() - lastMutatedAt < DIRTY_GRACE_MS` (`DIRTY_GRACE_MS = 5000`, `boardStore.ts:126`). The comment at `boardStore.ts:279-284` documents this was hardened after a real race (single boolean reset by uncoordinated writers) with the `pendingWriteSources` + `directWrites` refcounts.
- **Reconciliation model is mutual exclusion, not merge**: local wins until all write sources clear, then the next event/poll does a full server-authoritative replace.
- **Optimistic writes**: every store mutator (`boardStore.ts:149-258`) applies instantly and sets `isDirty`/`lastMutatedAt`. Two write paths: the durable localStorage-persisted `mutationQueue` (`lib/store/mutationQueue.ts`, idempotent replay ids via `mutationDispatch.ts:15,95-98`, reload suppression up to `MAX_RELOAD_SUPPRESS_MS = 5min` `:130`), and direct-call writes bracketed by `beginDirectWrite`/`endDirectWrite` (`boardStore.ts:290-292`; e.g. `useBoardHandlers.ts:161,177,207,227`) with rollback + undo toast on failure.
- `isAlreadyApplied()` (`mutationDispatch.ts:95-98`) dedups **replayed mutations** against duplicate-key errors — unrelated to realtime events.

## 7. 30s polling "fallback" (VERIFIED)

- `POLL_INTERVAL = 30_000` (`useProjectData.ts:13`); `setInterval(poll, POLL_INTERVAL)` `:293` in an effect (`:268-306`) that mounts **unconditionally alongside** the Pusher effect. **It is always-on, not failure-activated** — there is no Pusher connection-state detection anywhere (zero grep hits for `connection.bind`/`state_change`/`.bind('error'`). "30s polling fallback" in CLAUDE.md describes the worst-case staleness bound, not a failover mechanism.
- Poll guards: tab must be visible `:270`, not dirty/grace `:271`, not already in flight (`pollingRef`) `:272`. A `visibilitychange` listener re-polls immediately on tab refocus `:295-300` — this is the de facto laptop-wake catch-up path.
- Endpoint: `GET /api/sync/version/[projectId]` (`apps/web/src/app/api/sync/version/[projectId]/route.ts`) — session-cookie auth (`auth()` `:11-14`), access check `verifyProjectOwnership` `:17` (misleading name: it's an alias of the general `verifyProjectAccess`-backed `findProjectById`, `lib/data/projects.ts:60-65`, so members and realm members pass too). Returns `{ version: boardVersion, updatedAt }` only (`:23-26`) — cheap version probe; full data comes from `loadBoardData` when drift is detected.
- Compare logic (`useProjectData.ts:279-287`): first tick seeds `knownVersionRef` silently; later ticks reload on plain **inequality** (not monotonic ordering — fine as long as `boardVersion` only increments).
- **No Pusher webhook exists.** `app/api/sync/` contains exactly the one version route; grep for `channel_name`/`pusher/auth` webhooks: zero hits. The CLAUDE.md/architecture-router note grouping `api/sync` with "Pusher webhook" is doc drift.
- Poll + Pusher coexist freely; correctness under racing reloads rests on the shared `isDirtyOrGracePeriod()` gate plus the `fetchIdRef` last-launched-wins guard — there is no mutex.

---

## Risks / gaps (ranked)

1. **`comment:changed` never fires** (VERIFIED). Comment mutations bump nothing and publish nothing — other clients don't see new comments via Pusher **or** via the poll (no `boardVersion` bump means the version probe can't detect them). Comments are effectively non-realtime until an unrelated mutation touches the project.
2. **Remote-edit blind spot during local activity** (VERIFIED mechanics, INFERRED impact). A peer's `board-update` arriving while the local client is dirty/in-grace is dropped outright (`useProjectData.ts:327`) — not queued. Recovery waits for the next poll tick after the local window clears: worst case ~30s + 5s with no pending-update indicator.
3. **`boardVersion` bump is never atomic with the mutation** (VERIFIED). If the `touchProject` update fails/crashes after the primary write commits, the change is invisible to version-diffing pollers until the next mutation. Low probability, silent when it happens.
4. **No reconnect resync** (VERIFIED absence). Nothing binds Pusher connection state; events missed during a WebSocket gap are never replayed. The visibilitychange poll covers sleep/wake, but a network blip with the tab foregrounded leaves only the 30s interval.
5. **No socket_id exclusion** (VERIFIED). The mutating client gets its own echo; suppression relies on the echo landing inside the 5s grace window. A slow round-trip (>5s, e.g. cold serverless function) yields a redundant-but-harmless full self-reload — and conversely, a >5s mutation not bracketed by `pendingWriteSources`/`directWrites` could have optimistic state clobbered (per-call-site bracketing coverage not audited — see next steps).
6. **Full reload per event, fixed-phase poll, no jitter** (VERIFIED). Any remote change, however small, triggers a full board refetch (300ms debounce is the only coalescing); every open tab polls on its own unjittered 30s clock — a thundering-herd shape against `/api/sync/version/*` at scale.
7. **Known adjacent gaps** (from `architecture/inventory-and-gaps.md:28,42,85`, consistent with this recon): Gantt mutations fire no Pusher/`touchProject`; `broadcastMemoryEvent` is a no-op stub; assignee pile is only realtime for the acting client.
8. **Doc drift** (VERIFIED): CLAUDE.md's "Pusher webhook" note for `api/sync` and the "30s polling fallback" framing both mischaracterize the code (no webhook; poll is always-on). Flag for the next `inferno-cartographer` pass.

## Recommended next steps

1. **bug_fix — wire `comment:changed`**: make comment mutations call `touchProject(projectId, { type: 'comment:changed' })` so comments sync in realtime and are poll-detectable. Smallest, highest-value fix in this map.
2. **implement — reconnect + missed-update recovery**: bind `pusher.connection` `state_change` → on `connected` after a gap, force an immediate version probe; optionally mark "updates pending" instead of silently dropping events during dirty/grace.
3. **implement — pass `socket_id` through the mutation chain** (or include a client-instance id in the payload) for exact self-echo exclusion, replacing the timing heuristic.
4. **analysis — audit direct-write bracketing coverage**: verify every mutation path that bypasses `mutationQueue` is bracketed by `beginDirectWrite`/`endDirectWrite`, so >5s round-trips can't be clobbered by a reload.
5. **Low-effort**: add jitter to the poll interval; correct the CLAUDE.md/architecture notes at the next cartographer refresh.
