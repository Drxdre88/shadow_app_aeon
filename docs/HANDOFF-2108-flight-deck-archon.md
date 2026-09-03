# HANDOFF 2108 — Flight Deck (Hangar Phase 2) + Archon pattern mining

**For the spawned Phase-2 session.** Owner directive 2026-08-21: this workstream runs as its own swarm session while the origin session finishes the live ARQ mission. Read this fully before touching anything. Sibling context: `docs/HANDOFF-1908-ai-hangar.md` (Sprint 1 + POC + accepted risks) and `docs/ai-hangar-blueprint-1808.md` (§1–7 design).

## Mission statement

Build the **Flight Deck**: turn the Hangar's already-captured agent telemetry into a stunning live mission-observability surface, mining UI/orchestration patterns from the operator's local Archon clone. This is the V3 "admin tower" pulled forward and rebranded, scoped to solo-operator.

## ⚡ The decisive fact (verified live 2026-08-21)

**Capture is already done.** The runner streams Claude Code's raw `stream-json` into `sessionEvents` — typed records are sitting in prod TODAY: `assistant` messages with `tool_use` blocks (tool name + full input), thinking blocks, per-turn token usage (cache read/write + output = live cost), hook firings, init config (model, permissionMode, tool roster). Verified on session `65cbac1c-1098-4787-84be-17dadb73ae91` (mini-ARQ analysis mission).

**The gap is rendering, not plumbing:** the runner coalesces stdout into ~2s text batches stored as `kind:'message'` events; the `toolName` column on `sessionEvents` exists but is never populated; the Live Sessions drawer renders raw text.

## Build plan (proposed phases — confirm with owner before major deviation)

### Phase A — typed event pipeline (small, unlocks everything)
- Runner (`apps/kairos-worker/src/poller.ts` + `callback.ts`): parse each stream-json line instead of blind-batching. Emit typed events: `kind: 'tool_call' | 'thinking' | 'message' | 'usage' | 'system'` with `toolName` populated, tool input summary + token usage in payload. Keep raw text fallback for unparseable lines (Copilot/Codex engines emit different formats — parse best-effort per engine, degrade to text).
- Consider fixing the two transcript debts in the same pass (accepted risks from 1908): retry non-terminal batches (bounded), and the seq-floor issue if reclaim ever lands. At minimum don't make them worse.
- DB: `sessionEvents` schema likely sufficient (payload jsonb + toolName + kind). If a migration is needed: journal frozen at 0010, head is 0031 — HAND-WRITE `0032_*.sql`, NEVER `db:generate`; `db:push` for dev.
- Rollup: on terminal result, compute mission stats (total tokens, est. cost, tool-call count, duration) into `metadata.hangar.lastResult.stats` (or session metadata) so cards can show cost without replaying events.

### Phase B — Flight Deck UI
- Upgrade/replace the Live Sessions drawer: mission timeline with tool-call chips (icon per tool class: read/search/edit/bash/subagent/mcp), collapsible thinking, subagent tree (Task spawns), live cost meter, phase markers, kill/abort.
- A board-level **Tower view** for Hangar mission cards: all sessions for the operator across machines — status, runner id (`claimedBy`), heartbeat freshness (surface "unresponsive" when stale — NEVER auto-fail, rule E1), engine, cost, duration; click-through to transcript.
- House style: Aeon's existing stack (Next.js/React/Zustand/Tailwind/Framer). Realtime: reuse Pusher board channel or 2s polling like the current drawer — do NOT invent a new transport.

### Phase C — Archon mining (feeds A+B, do first as recon)
**Local clone with full git history: `C:\Users\anselikhov\data_science\ext_repo_26\Archon` — read from disk, no internet needed.**

Archon today (verified 2026-08-21, repo evolved massively since the 1808 recon): deterministic workflow engine — YAML DAG workflows (AI nodes + script nodes + human approval gates), 19 built-in workflows, git-worktree isolation per run, Bun/TypeScript, web dashboard.

Mine these specifically (patterns, not code-paste — check `LICENSE` in the clone before lifting anything verbatim):
1. **Chat/transcript UI with tool-call transparency + streaming** — their rendering of tool calls inline is the closest existing thing to Flight Deck's transcript.
2. **Workflow execution view** — per-node progress for a running workflow → our per-mission phase timeline.
3. **Dashboard / mission control** — running-runs list, filterable history (project/status/date) → Tower view.
4. **Approval gates as first-class nodes** — maps onto our `needs_input` envelope status + typed-answer rule (E2). Steal the UX shape for answering a blocked mission.
5. **Worktree isolation mechanics** — informs the V2 parallelization item (4–5 concurrent missions); note what they do about cleanup + branch naming.
6. **DAG workflow definitions (YAML)** — future: multi-mission chains (a plan mission auto-spawning its recommended cards). Recon only; NOT in this phase's build scope.

Recon lanes (prowler subagents): dashboard/frontend components; execution engine + event/streaming model; worktree lifecycle. Output: a mining report in `docs/investigations/` with file references into the clone + a "rip list" mapped to Phase A/B items.

## Out of scope (separate workstreams — do not absorb)
- V2 storage (full report text in Aeon + hangar-vault repo + SharePoint mirror) — sibling Sprint 2 item.
- Launch semantics (`trigger: manual|on_drop`, launch/abort toast) and model pickers.
- Multi-user/team layer, runner identity, env scrubbing (V4 debts).

## Board
Per aeon-dev-live: create ONE new directional card on AI Mission Control — "AEON: Hangar Flight Deck — typed telemetry + mission observability" (repo:aeon + dom:KAIROS), checklist groups = Phase C recon / Phase A pipeline / Phase B UI / Review. The Sprint-1 Hangar card (`0563df9f…`) stays untouched in Landing Zone awaiting owner confirm.

## Traps (do not relearn)
- Drizzle journal frozen at 0010; hand-write numbered migrations; `db:push` dev only.
- MCP/REST parity invariant — any new session/event surface needs both sides + parity test (`sessions-parity.test.ts` pattern).
- `.claude/` + CLAUDE.md are gitignored in this repo.
- Corp network drops curls (000/DNS fail → retry); `aeon.app` does NOT resolve — prod is `https://aeon.shadow-lab.ai`.
- Event POSTs from runner can 10s-timeout against busy servers (fire-and-forget by design today).
- Single-branch discipline: one feature branch off main (suggest `feat/flight-deck`), structured commits, no parallel branches.
- Runner claims are user-scoped; ~~`KAIROS_MAX_CONCURRENT=1` — don't raise it until worktree isolation exists~~ (2408: worktree isolation SHIPPED — missions run in disposable worktrees, concurrency raised to 4).
- Verification tier: LIGHT/MEDIUM (vitest + targeted smoke); owner tests UI visually — hand over early.

## State at handover (2026-08-21 ~16:00Z)
- Hangar Sprint 1 fully live in prod (PR #104), auth gate green (PR #105 + #106).
- Runner operational on host `002LND2094` (`start-hangar-runner.bat`, `runner.env.bat` configured, key `hangar-runner`).
- First real prod mission (mini-ARQ portability analysis, engine=claude, card `5c5134a4…` on the owner's new **Auto AI** board `3e50717a…`) claimed and running — origin session is watching it; its envelope may have landed by the time you read this (check the card).
- Owner intent: Flight Deck is the Sprint-2 centerpiece alongside storage; "stunning" is a requirement, not a nicety.
