# Archon pattern mining — Flight Deck (2026-08-21)

Recon of the local Archon clone (`C:\Users\anselikhov\data_science\ext_repo_26\Archon`) feeding the
Hangar Flight Deck build (see `docs/HANDOFF-2108-flight-deck-archon.md`). Three prowler lanes:
frontend/dashboard, execution engine + events, worktree lifecycle + DAG definitions.

**License: MIT** (Cole Medin, 2025-2026). Verbatim lifting is legally clear; we mine patterns, not code.

**Archon stack** (surprisingly close to ours): React 19 + Tailwind + Zustand 5 + TanStack Query/Virtual,
`@xyflow/react` + dagre for DAG graphs, Radix primitives, `react-resizable-panels`, `react-markdown`.
Realtime is **SSE (EventSource), not WebSocket** — REST for history/truth, SSE for liveness.

---

## Lane 1 — transcript / dashboard UI (`packages/web`)

### Transcript with tool-call transparency (`components/chat/`, `hooks/useSSE.ts`, `lib/chat-message-reducer.ts`)
- **Event taxonomy**: every SSE frame carries a `type` discriminator (`text`, `tool_call`, `tool_result`,
  `session_info` (cost/tokens), `workflow_status`, `dag_node`, `heartbeat`, …). Unknown types are logged
  and ignored — never crash the stream.
- **50ms text batching** (`useSSE.ts`): token deltas buffer in a ref and flush as one state update per
  50ms window; buffer force-flushes when a `tool_call`/`tool_result` arrives so ordering is preserved.
  Kills render-thrash with zero perceived latency.
- **Pure message-segmentation reducer** (`chat-message-reducer.ts`): `(prevMessages, content, meta) => newMessages`,
  no DOM, no I/O, unit-tested numbered rules for "new bubble vs append". Transport hook does I/O only.
- **Tool-call card** (`ToolCallCard.tsx`): collapsed by default; header = chevron + spinner/terminal icon +
  mono tool name + Running/Complete pill + one-line summary (first string arg, 60 chars) + live elapsed
  ticker (1s interval while running). Expanded = pretty-printed JSON input + output `<pre>` capped at
  20 lines with "Show N more". No per-tool-class icons — the name text carries that.
- **Recovery**: if a terminal signal arrives while a streaming bubble is still empty (lost SSE events),
  re-fetch full history via REST and merge. **SSE is best-effort, REST is source of truth.**

### Workflow execution view (`components/workflows/`)
- **Topology computed once, status overlaid separately** (`WorkflowDagViewer.tsx`): `baseNodes` memoized
  on node/edge count; live `statusMap` merged on top → no re-layout jitter on status ticks.
- Node states via left-border + tint (`border-success bg-success/5` etc.); the **running node gets a real
  CSS glow** (`shadow-glow`) and its edges animate (`animated: true`, a React Flow boolean) — cheap liveness.
- **Graph + synced sidebar list + synced logs** three-pane layout (`react-resizable-panels`): clicking a
  node scrolls the logs panel to that node's first event timestamp (trigger-counter forces re-scroll).
- Status via REST poll (3s, stops when terminal) merged with SSE store; explicit precedence comments —
  SSE = dynamic status, REST = structural truth, REST wins when SSE was sparse.

### Dashboard / "Mission Control" (`routes/DashboardPage.tsx`, `components/dashboard/`)
- Two tiers: **Active** (card grid) above **History** (dense filterable table).
- **Filter bar** (`StatusSummaryBar.tsx`): status count-chips doubling as toggle filters (Running chip
  pulses when count > 0), project + date-range dropdowns, 300ms-debounced search, `Capacity: 2/5 active`
  readout. **All filter state lives in URL search params** — bookmarkable, back/forward-safe.
- **Run card** (`WorkflowRunCard.tsx`): status dot + name + pill + live elapsed; `{done}/{total} nodes` +
  current step + current tool; terminal runs show `✓ 4/5 nodes · 1 failed` + `$0.0421 USD`; platform icon;
  status-gated actions (Approve/Reject when paused, Cancel/Abandon when running, Delete when terminal),
  destructive ones through one shared Radix AlertDialog.
- **One multiplexed SSE connection per dashboard** (`useDashboardSSE.ts`) fanned into a Zustand store
  keyed by runId; cards subscribe narrowly (`s.workflows.get(runId)`). N cards ≠ N connections.

### Approval gates UX
- Paused run shows a warning-tinted inline banner (Pause icon + author-defined message) on the run card —
  **no modal takeover, no separate review page**. Two actions: Approve (one click) and Reject (optional
  free-text reason via shared dialog; reason feeds the workflow's `on_reject` branch as a variable).
- Resolution = REST mutate → invalidate query → let SSE confirm the status flip.

## Lane 2 — engine / event model (`packages/providers`, `packages/workflows`, `packages/core`)

- **Two-tier event storage**: lean typed events (node/tool lifecycle, approvals) in the DB
  (`remote_agent_workflow_events`); verbose assistant/tool content **never touches the DB** — it goes to
  an append-only JSONL file per run (`.archon/logs/{runId}.jsonl`). Stated policy in the migration.
- **Ordering**: `event_order` int + 3-key `ORDER BY (created_at, event_order, id)` — timestamp ties are
  expected and solved structurally.
- **Fire-and-forget event writes as contract**: `createWorkflowEvent` catches and logs, never throws —
  event persistence must never fail the run. One exception: the approval-gate CAS write is transactional
  with its event write.
- **Per-engine event bridges**: every provider implements `sendQuery(): AsyncGenerator<MessageChunk>`;
  the cleanest example is Copilot's **pure mapper** `mapCopilotEvent(event, ctx): MessageChunk[]`
  (`community/copilot/event-bridge.ts`) — one exhaustive switch, side effects behind a tiny context
  object, `default: log.debug + return []`. Directly unit-testable against fixture lines.
- **`MessageChunk` union** (`providers/src/types.ts:185`): `assistant | system | thinking | result |
  rate_limit | tool | tool_result | task_* | hook_*` — each variant carries only its own fields.
  `toolCallId` correlates tool→result pairs under concurrency.
- **Stats rollup**: per-node tokens/cost from each provider's terminal `result` chunk land on the
  `node_completed` event; a **single, explicitly-commented aggregation point** (`dag-executor.ts:7889`)
  accumulates run totals with `Number.isFinite()` guards; totals persist onto the run row on completion,
  **omitted when zero** ("absent = no usage reported" ≠ "zero spend"). Child-run totals roll up into the
  parent node's cost.
- **Robustness**: idle-timeout wrapper around the stream (resets on every chunk, not wall-clock; 30min
  default) + a shorter first-event timeout (60s) with structured diagnostics; subprocess retry with
  structural (not text-matched) error classification — only rate-limit/crash retry, auth fails fast.
- **SSE transport** (`server/src/adapters/web/transport.ts`): per-conversation ring buffer
  (500 events / 60s TTL) replayed on reconnect; 5s disconnect grace (React StrictMode double-mount);
  build-time assertion `TTL >= grace`.

## Lane 3 — worktrees / concurrency / DAG (`packages/git`, `packages/isolation`, `packages/workflows`)

- **Worktree layout**: `~/.archon/workspaces/<owner>/<repo>/worktrees/<branch>`; branches
  `archon/issue-{id}` / `archon/task-{slug}` / `archon/pr-{N}-review`. Creation: fetch base →
  `git worktree add --no-track -b <branch> <remote>/<base>` → stamp worktree-local git identity →
  submodules → copy git-ignored files per config (path-traversal blocked).
- **The concurrency-safety primitive is a path-exclusive lock, not a worktree count** (`executor.ts:1433`):
  before a run starts, query for any other live run with the same `working_path`; if found, self-cancel
  with a pointer at the blocker. N worktrees = N free paths automatically. Read-only workflows can set
  `mutates_checkout: false` to opt out and share a checkout.
- **Cleanup**: idempotent destroy (`git worktree remove` → rm leftover → prune → verify); **no
  auto-cleanup at process startup** (explicitly rejected — killed other processes' runs); scheduled 6h
  sweep removes gone/merged/stale (14d) worktrees; cap 25/repo with `makeRoom()` that only ever removes
  merged branches.
- **CAS state transitions with stale-row windows**: resume flips `status` only `WHERE status IN (...)`
  under a row lock; pending rows older than 5min don't block the path; crashed processes just age out —
  no reaper needed on the hot path.
- **Concurrency knob**: global `MAX_CONCURRENT_CONVERSATIONS=10` semaphore + FIFO queue (in-process,
  not DB-backed); DAG fan-out capped separately (`mapWithLimit`, default 5).
- **DAG YAML**: flat schema, mode inferred from which key is present (`command/prompt/bash/script/loop/
  loop_group/approval/cancel/include/workflow`); `depends_on` + `when:` + `trigger_rule`; `$nodeId.output`
  threading with declared-field enforcement; `workflow:` node = child run with own row/artifacts/audit +
  `isolation: worktree` + `fan_out` — the future mission-chain primitive. The `archon-ralph-dag.yaml`
  loop (fresh-context iterations, all state on disk, prompt is the state machine) is the reference for
  long autonomous missions.

---

## Rip list → Flight Deck phases

### Phase A — typed event pipeline (runner + ingest)
| # | Pattern | Source | Application |
|---|---------|--------|-------------|
| A1 | Pure per-engine mapper `mapLine(line, ctx) -> TypedEvent[]`, unknown → log + `[]` | copilot `event-bridge.ts` | `stream-parser.ts` in kairos-worker; claude first, copilot/codex degrade to text |
| A2 | Two-tier storage: typed events in DB, verbose raw only as fallback/tail | `workflow-events.ts` policy | keep payloads summarized (input summary, capped text); raw tail only on parse failure |
| A3 | `toolCallId` correlation between tool_use and tool_result | `MessageChunk` | store `tool_use_id` in payload; drawer pairs chips with results |
| A4 | Single aggregation point for stats + `Number.isFinite` guards + omit-when-zero | `dag-executor.ts:7889` | one rollup fn in runner finalize → session `costUsd` + `metadata.hangar.lastResult.stats` |
| A5 | Usage dedupe by request id (one API request streams N content-block lines) | our live capture 2108 | count usage once per `request_id` |
| A6 | Fire-and-forget event writes; terminal writes retry (already ours) | both | keep; batch typed events under the 60/min budget (2s flush cadence preserved) |
| A7 | Event ordering: seq stays canonical; sub-order within a batch | `event_order` 3-key sort | seq-per-event from the existing monotonic counter — already sufficient |

### Phase B — Flight Deck UI
| # | Pattern | Source | Application |
|---|---------|--------|-------------|
| B1 | Collapsed tool-call chip: icon + mono name + status pill + 1-line summary + elapsed ticker | `ToolCallCard.tsx` | mission timeline chips (we add per-tool-class icons: read/search/edit/bash/subagent/mcp) |
| B2 | Pure segmentation reducer separate from transport | `chat-message-reducer.ts` | `buildTimeline(events)` pure fn; polling hook stays dumb |
| B3 | Poll = truth (we have no SSE); keep 2s tail + full refetch on terminal | dual-source policy | existing drawer poll pattern, upgraded renderer |
| B4 | Tower: status count-chips as filters + URL-param filter state + capacity readout | `StatusSummaryBar.tsx` | Tower view header; heartbeat-freshness "unresponsive" badge (never auto-fail, E1) |
| B5 | Run card: `{n} tools · current tool (spinner)` + cost badge on terminal | `WorkflowRunCard.tsx` | mission cards in Tower + card-front status chip |
| B6 | Inline approval banner + Approve/Reject-with-reason, no modal takeover | approval UX | `needs_input` (Tower column) answer box — matches blueprint E2 |
| B7 | Running-element CSS glow + animated connector | DAG viewer | "stunning" budget: glow on live mission rows/chips |
| B8 | Shared store keyed by sessionId, narrow subscriptions | `useDashboardSSE.ts` | one poll loop feeding a sessions store; cards/drawer subscribe narrowly |

### V2 parallelization (recon only — not this phase)
- Path-exclusive lock keyed on checkout path; worktrees make N paths (Archon `executor.ts:1433`).
- `mutates_checkout: false` analog: read-only objectives (recon/analysis) may share a checkout.
- CAS transitions + stale-age windows instead of startup reapers; never auto-clean other processes' runs.
- Ownership verification before adopting an existing worktree dir.
- `workflow:` child-run node + `fan_out` = the mission-chain primitive to study when chains land.

## Deviations from the handoff worth noting
- Handoff proposed event kinds `tool_call | thinking | message | usage | system`; the existing
  `sessionEventKindSchema` already has `tool_use`/`tool_result` — we extend with `thinking`, `usage`,
  `system` and keep the existing names (no churn, hooks already post `tool_use`).
- Archon streams per-chunk over SSE with no batching at transport; we keep our 2s coalescing because the
  binding constraint is Aeon's 60 writes/min API budget, not render performance. The 50ms render batching
  idea applies client-side if we ever move to SSE (not this phase — poll stays, per handoff rule).
