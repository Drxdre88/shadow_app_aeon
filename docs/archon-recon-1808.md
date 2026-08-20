# Archon Recon — Synthesis (1808)

**Mission:** understand Archon (`ext_repo_26/Archon`) end-to-end as the SOTA reference before building Aeon's **agent command centre** — spawning and driving Copilot / Claude Code session agents from Aeon boards.
**Method:** 5 parallel prowlers (architecture · engine core · agent spawn mechanics · control surfaces · persistence/auth/ops), read-only. Upstream state verified current as of 2026-08-18 (v0.9.x, April-2026 TypeScript rewrite; the old Python RAG/task-manager Archon is archived).

---

## 1. What Archon is now

A **workflow engine / harness builder for AI coding agents**. YAML workflows (`.archon/workflows/*.yaml`) define a DAG of typed nodes — `prompt`, `bash`, `script`, `loop`, `loop_group`, `approval`, `workflow` (child sub-run, fan-out capable), `include`, `command`, `cancel` — mixing deterministic steps with AI steps. Every run gets an isolated git worktree (or Docker container). Drivable identically from CLI, Web UI (React SPA), Slack, Telegram, Discord, and GitHub webhooks. Single-tenant-per-install (one VPS per client), Bun monorepo, single process = HTTP API + SSE + SPA + chat adapters + the executor itself.

**Stack:** Bun + TypeScript strict + Zod v4 everywhere · Hono/OpenAPI server · React 19 + Vite + Zustand + TanStack Query + xyflow (visual DAG builder) · dual SQLite (default) / Postgres, raw SQL adapters, no ORM · Better Auth (web) + AES-256-GCM-encrypted per-user provider credentials · Claude Agent SDK / Codex SDK / Copilot SDK / Pi / OpenCode behind one `IAgentProvider` interface.

**Package DAG (strictly enforced):** `paths → git → providers → isolation → workflows → core → adapters → server → cli`, with `web` consuming only generated OpenAPI types (never engine internals).

## 2. The five load-bearing mechanisms

### a) Agent sessions are DB rows, not live processes
Pause/resume/cancel all work by persisting `workflow_runs.status` + a `metadata.approval` JSON blob (`ApprovalContext`), with **cooperative status polling** between DAG steps — not held subprocesses, not SIGKILL. Resume re-enters the executor fresh (possibly a different process) and reconstructs everything from the row. Hard interrupt exists only as the SDK's own AbortController on an actively-streaming turn.

### b) Spawning Claude Code: SDK, not raw spawn
`@archon/providers` calls the Claude Agent SDK's `query()` async generator with: `permissionMode: 'bypassPermissions'`, preset `claude_code` system prompt, `cwd`/`env` (with the target repo's own `.env` stripped — env-boundary discipline), `resume`/`forkSession` (always fork on resume so retries never corrupt the source transcript), `model/effort/thinking/maxBudgetUsd/outputFormat`, and an in-process MCP server exposing Archon's own functions (e.g. `manage_run`) to the agent. Binary resolution: env var → config → `~/.local/bin/claude` autodetect. Refuses to run as root. Retry: 3×, exponential, typed error classes (rate-limit/crash retry; auth never). 60s first-event timeout catches hung subprocesses. Synthetic-error detection: the SDK sometimes encodes API failures as a fake "successful" assistant message — Archon disambiguates structurally, never by parsing prose.

### c) Completion & approval are typed, never inferred from prose
Loops declare completion via 3 independent channels: `until` (prose sentinel), `until_bash` (exit-0 script), `until_field` (schema-declared required boolean in `output_format` — validated at load time). Approval gates are a first-class node kind, resolved by **atomic compare-and-swap SQL** (`WHERE status='paused' AND resolved IS NULL`) so racing approvers can't double-fire. Their #2565 postmortem: a plain chat objection once silently *approved* a gate — hence the rule "Natural Language Is Not a Wire Format": approve/reject flows through a typed tool/verb, ambiguity re-asks, never proceeds.

### d) One operations layer under every surface
`workflowOperations.{approve,reject,resume,cancel,abandon}` is called *identically* by the Slack button (stateless `action_id = "approve:<runId>:<nodeId>"`), Telegram/CLI text verbs, the REST API, and the web dashboard. Live progress = SSE push for in-process runs + a DB event-table poller (Postgres LISTEN/NOTIFY wake + poll backstop) for runs started by *other* processes. Slack/Telegram use outbound sockets/polling (zero inbound webhook surface); only GitHub needs HMAC webhooks. Unauthorized senders are silently dropped (masked log, no reply).

### e) Concurrency & isolation without a lock service
Worktree-per-run by default (`~/.archon/workspaces/{owner}/{repo}/worktrees/{branch}`), branch names typed per workflow kind (`archon/issue-N`, `archon/task-<slug>`). "Who holds this checkout" is a DB compare-and-swap on `working_path` with a deterministic `(started_at, id)` older-wins tiebreaker. Orphan recovery: on boot, all `running` rows → `failed`; next dispatch at the same path auto-resumes from the completed-node snapshot. Cleanup fails closed: a DB error during reaping means "don't touch", never "orphan, delete".

## 3. Schema worth stealing (for an Aeon `agentSessions` layer)

| Archon table | Shape to borrow |
|---|---|
| `remote_agent_sessions` | `parent_session_id` self-FK + `transition_reason`/`ended_reason` enums — sessions are immutable, transitions create linked rows (full audit trail) |
| `remote_agent_workflow_runs` | `status` enum incl. `paused`, `parent_run_id` self-FK (`ON DELETE SET NULL`, never CASCADE — audit survives), `output_root` written once (survives project renames), `metadata` JSONB carrying the pause context |
| `remote_agent_workflow_events` | append-only event log, DB-assigned `event_order`, fire-and-forget writes that never fail the run |
| `remote_agent_isolation_environments` | worktree/container as a first-class tracked resource; partial unique index on `status='active'` |
| `remote_agent_user_identities` | (platform, platform_user_id) → canonical user — one identity model across web/Telegram/CLI/GitHub |
| `remote_agent_user_provider_keys` | per-user AI credentials, AES-256-GCM at rest, key from env var first (Neon/Vercel-friendly), resolved into the *acting* user's run env |

## 4. What this means for Aeon — the architecture verdict

**The single most important structural lesson:** Archon's executor lives in a long-lived process. **Vercel serverless can never own the Claude Code subprocess.** The natural Aeon split:

```
Aeon (Vercel, Next.js)          =  command centre / state plane
  boards & cards                   agent_sessions + agent_events tables
  approval UI on cards             dispatch queue (DB rows)         Pusher live updates
        │  poll / claim (outbound only from runner)
        ▼
Runner (long-lived: local machine now, small always-on host later)
  claims dispatch rows → spawns Claude Code via Agent SDK (fork-on-resume,
  worktree-per-run, env-stripped) → streams events back to Aeon REST → PR
        +
GitHub Copilot coding agent      =  the zero-runner path (already proven
  (GraphQL assign, poll PR/CI)      by kairos-delegate) — no subprocess at all
```

Two provider shapes, don't force one abstraction (Archon itself couldn't): **Copilot = hosted fire-and-forget** (assign → poll PR); **Claude Code = full local lifecycle** (spawn/resume/abort). Aeon can ship Copilot-from-cards first with zero new infrastructure, and add the Claude Code runner as phase 2.

### Design rules to adopt (distilled from all 5 reports)
1. **Session = DB row**; pause/resume/cancel = status flips the runner polls; never trust an in-memory handle.
2. **Never auto-fail on ambiguity** — a stale session gets a "needs resolve" state + one-click human resolve, not a timer-driven auto-flip (matches our never-dismiss-bug-reports discipline).
3. **Typed approval, CAS-resolved** — approve/reject as explicit actions on the card, atomic conditional UPDATE, ambiguous chat input re-asks.
4. **Completion via structured output** (required boolean field / exit-0 check), not a magic prose string.
5. **One operations layer** — web card button, MCP tool, Telegram verb, REST all call the same `lib/actions` function.
6. **Fork-on-resume, env-strip, first-event timeout, typed retry classes, synthetic-error detection** when we get to the Claude runner.
7. **Audit-preserving FKs** (`SET NULL`, immutable session rows) + append-only event log driving the card's live activity feed via Pusher.
8. **Per-user encrypted provider credentials** (AES-256-GCM, `TOKEN_ENCRYPTION_KEY` env) if realm members ever bring their own keys.
9. **Migration-statement-order guard** (tables/columns before indexes/comments) as a test — Archon crash-looped twice on this; directly relevant to our hand-written migrations.
10. **Skip the YAML engine for v1.** Aeon's card + checklist-groups model already *is* the coarse workflow. A minimal gate layer (dispatch → run → approval → done) on cards beats porting a 10-node-type DAG engine. Revisit only if multi-step per-card automation proves necessary.

## 5. Proposed build phases (pending owner go)

- **P1 — Copilot from cards (no runner):** `agent_sessions` + `agent_events` tables; "Delegate to Copilot" on a card (GraphQL assign via stored GitHub token); poll PR/CI status into the card; card activity feed. Productizes `kairos-delegate`.
- **P2 — Claude Code runner:** local long-lived runner claims dispatch rows, spawns sessions via Claude Agent SDK with worktree isolation, streams events to Aeon; card buttons = approve/reject/cancel (CAS).
- **P3 — Gates & loops:** approval-gate card states, `until_field`-style completion, session resume/fork, Telegram approve/reject verbs through the same actions.

---

*Full per-aspect prowler reports live in the session transcript (architecture, engine, spawn, surfaces, persistence). This doc is the durable synthesis.*
