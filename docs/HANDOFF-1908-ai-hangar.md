# HANDOFF 1908 — AI Hangar (pre-build, confirmation gate)

**For the next session.** Read this + `docs/ai-hangar-blueprint-1808.md` (the design brief, §1–7) before doing anything. `docs/archon-recon-1808.md` is the mechanism deep-dive behind it.

## ⛔ THE GATE — read first

**Owner directive (2026-08-19): do NOT start building.** The owner wants to **confirm each bullet of the build plan individually** before any implementation of the Hangar or surrounding bits begins. The next session's first job is to walk through the confirmation checklist below with the owner, item by item, capture amendments, and only then start Sprint 1 on the amended plan. Design decisions below are *proposals awaiting sign-off*, not settled facts.

## State as of 2026-08-19

- ✅ 8-prowler recon complete (5× Archon, 3× Aeon/fleet). Decisive finding: **~80% of the Hangar substrate already exists** — `agentSessions` + `sessionEvents` tables (schema.ts:606-665, migration 0019), REST `/api/v1/sessions/*`, 5 MCP session tools, and `apps/kairos-worker` already shelling `claude -p` (PUSH model; the pivot is push→pull).
- ✅ Blueprint written and iterated to v2 + POC directive + runbook (§1–7 of ai-hangar-blueprint-1808.md).
- ✅ Standards verified (2026-08-19): AGENTS.md = open standard (Codex/Copilot native; Claude Code reads CLAUDE.md only); SKILL.md skills portable across ~40 tools; Copilot CLI has official programmatic mode (`copilot -p --allow-tool --no-ask-user`, GHE Cloud docs).
- ❌ Nothing built. No branch, no migration, no runner changes.
- 📋 Board: card **"AEON: AI Hangar — agent command centre"** (id `0563df9f-0fb5-4824-849b-663eccd93448`) in **Landing Zone** on AI Mission Control; checklist 9/11 — open: "Confirm each build-plan bullet with owner" and the final Verify item.
- 🧠 Memory: `project_aeon_agent_command_centre.md` carries the durable summary incl. the Copilot-first work directive.

## ✅ Confirmation checklist — walk the owner through EACH of these

**A. Posture & migration**
- [ ] A1. POC runs **native Claude** for now; Copilot-first applies to the *work* POC later (Claude usage is under scrutiny at work — never make Claude the work-repo engine).
- [ ] A2. Initial repo migration = **3-line AGENTS.md stub referencing CLAUDE.md** (CLAUDE.md stays canonical); full AGENTS.md split + skills junctions deferred until Copilot goes primary.
- [ ] A3. Five global objective-contract skills (`~/.claude/skills/eon-objective-{bug_fix,implement,recon,analysis,plan}`) defining "finished" + the fenced-JSON result envelope.

**B. Schema & backend (Sprint 1)**
- [ ] B1. Fresh branch `feat/ai-hangar` off main (land/park `feat/pro-wave-1708` first — single-branch discipline).
- [ ] B2. Hand-written migration `0031_hangar.sql` (journal frozen — NEVER db:generate; head is 0030, data-layer.md stale): `agentSessions` += `taskId` FK (SET NULL) / `claimedBy` / `claimedAt` / `lastHeartbeatAt`; new **`hangarRepos`** registry table (slug, gitUrl, ghSlug, defaultBranch, branchPrefix, allowedEngines[], runCmd, envSetupCmd, appUrl, notes, active, metadata).
- [ ] B3. `claimNextSession()` — atomic `FOR UPDATE SKIP LOCKED` claim, filtered `engine IN ('claude','codex')` (kairos-chat/dialogue share the table). New pattern for this codebase → warden review mandatory (Neon 8s pool-timeout risk).
- [ ] B4. REST `POST /api/v1/sessions/claim` + registry routes; MCP mirrors (`claim_session`, `register_repo`, `list_repos`); add the missing `sessions-parity.test.ts` in the same pass.
- [ ] B5. Card payload in `boardTasks.metadata.hangar` (~18 fields, Zod-validated) — no new boardTasks columns. Result envelope = terminal `sessionEvents` row `kind:'result'`; on terminal status → write `metadata.hangar.last_result`, move card column, `publishBoardEvent`.
- [ ] B6. `spawnSessionFromCard(taskId)` action — creates `queued` session, no `dispatchSpawn` (push path stays untouched for Kairos).

**C. Runner**
- [ ] C1. Poll mode added to `apps/kairos-worker` (keep push mode intact): claim → `repos.local.yaml` slug→path lookup → branch `eon/<taskId>` → `claude -p "<dispatch>" --output-format stream-json --permission-mode acceptEdits` → stream events → extract fenced-json envelope → post result → heartbeat + cooperative kill check.
- [ ] C2. Registry split of truth: Aeon holds logical repo config; **host paths stay runner-side** in `repos.local.yaml`.
- [ ] C3. Dispatch prompt stays tiny (task id + objective + user text + skills + "fetch more via Aeon MCP") — repo CLAUDE.md does the heavy lifting.

**D. Run/POC sequence**
- [ ] D1. First onboarded repo: aeon itself or arq (owner picks).
- [ ] D2. First mission = **recon objective** (read-only loop proof), second = real **bug_fix**.
- [ ] D3. UI (Hangar board mode `projects.settings.boardMode='hangar'`, columns Hangar→Flight→Tower→Landing→Done, bespoke card editor, Hangar Bay registry panel) is **Sprint 2**, only after the loop is proven headless.

**E. Standing rules (from Archon recon — confirm adoption)**
- [ ] E1. Never auto-fail a session on staleness — surface "unresponsive" + one-click human resolve.
- [ ] E2. Approvals / needs_input answers are typed actions, never inferred from chat prose.
- [ ] E3. Standardise the result envelope, not the execution.

## Traps (unchanged, don't relearn)
Drizzle journal frozen at 0010, hand-write numbered migrations, db:push for dev · `aeon_k1_` API keys are unscoped (runner key = full user access — fine solo) · sessions MCP/REST parity has NO test today (B4 closes it) · `.claude/` + CLAUDE.md are gitignored in this repo · corp network drops curls (000 → retry).

## Next session, in order
1. Present checklist A–E to the owner, item by item; record confirms/amendments (tick the card checklist item when done).
2. On full confirmation: execute blueprint §7 runbook (build steps 1–9, run steps 1–5).
3. Move the card per aeon-dev-live rules; warden before Landing Zone; horsemen before PR.

---

# ✅ CONFIRMED 2008 — owner sign-off (supersedes the proposals above)

**Gate closed 2026-08-20. Build authorized.** Amendments vs the A–E proposals:

1. **Naming: `aeon`, not `eon`, everywhere** — branch prefix `aeon/<taskId>`, skills `aeon-objective-*` ("eon" was a voice-mode artefact).
2. **Multi-engine Sprint 1 (major change).** This was always the *GitHub Copilot POC* at heart. Runner ships with spawn adapters for **claude / copilot / codex** from day one; engine is a per-card field, envelope engine-agnostic. Mission 1 (recon) on claude proves the loop; mission 2 re-runs the same recon on **copilot-cli** (the true POC proof); mission 3 = real bug_fix. AGENTS.md 3-line stub (→ CLAUDE.md canonical) is the Copilot/Codex entry door — verify Copilot actually follows the pointer.
3. **Card payload = 7 user fields + 2 system** (`metadata.hangar`): `objective` · `repo` · `agent` (**default `copilot`**) · `model` (nullable; **copilot default = Opus 5** — verify exact slug during runner build) · `instruction` · `output_mode` (**enum with single value `auto` for now** — auto-derives deliverable from objective; more modes later) · `subagents[]` (**owner-facing multi-select** — guides which subagents the harness spawns; POC roster = `inferno-executioner`, `inferno-prowler` from `~/.claude/agents`); system-written: `session_ids[]`, `last_result`. Title = the card name itself.
4. **Cut from the card:** `skills` (auto-loaded/inferred — not user-managed), `base_branch` (registry default only), `attachments`/`linked_cards`/`linked_docs` (defer — paste into instruction), `artifact_dir` (objective skill defaults it).
5. **Dispatch contract MD (new artefact):** a workflow contract doc shipped with the objective skills that tells ANY harness (claude/copilot/codex) how to interpret an AI card's fields — objective semantics, subagent usage, output_mode=auto mapping, envelope requirements.
6. **B1 moot:** pro-wave-1708 was already merged (PR #103); `feat/ai-hangar` cut clean off main 2026-08-20.
7. Claim filter widens to `engine IN ('claude','codex','copilot')` (kairos rows still excluded).
8. A1–A3 (with aeon-naming), B2–B6, C1–C3, D2–D3, E1–E3: **confirmed as written**; AGENTS.md stub goes into the first repo regardless, for the copilot leg.

## 🎯 Owner directive 2008 — launch semantics & team boards (Sprint 2 scope)

Card creation must NEVER spawn a mission — launching is a separate conscious commitment ("half-typed card + Enter must never start an agent").
- New card field `trigger: 'manual' | 'on_drop'`, default `manual`. `manual` = card is a draft; spawn only via explicit "Save & Launch" button (never the Enter default) or the launch action. `on_drop` = spawn when the card is DRAGGED into the Hangar/queue column — the column move is the commitment surface.
- Launch toast with **Abort** — a queued session sits ~15s before claim; abort = kill before claim. Free undo window, no delay machinery.
- Board settings `settings.hangar`: `membersCanCreateCards` (teammates draft on shared boards) + `launchRoles` (owner-only initially) — drafting and launching are separate privileges.
- Constraint: post-C1 the runner claims only its owner's sessions, so shared-board V1 = teammates draft, operator launches. True multi-user launch needs a runner-identity concept (who runs whose missions on which host) — deliberate later step.

## 🏁 POC RESULTS 2008 — all three missions flew, loop proven live

- **Mission 1 (claude, recon):** completed — realtime-sync report + 4 recommended follow-up cards on the card face. `docs/investigations/20260820-realtime-sync-pipeline.md`.
- **Mission 2 (copilot, recon):** first attempt did the work but wrote `status:'complete'` (skills not junctioned to Copilot → never saw the field spec) and was failed on validation. Fixes: runner status-alias normalization + envelope schema inlined in every dispatch prompt + repo-root path rule. Retry on **claude-sonnet-5** (probed: Copilot carries the Claude 5 family, NO opus tier, no fable; `claude-sonnet-4.6/4.5`, `claude-haiku-4.5`, `gpt-5.4`, `gpt-5.3-codex` also valid) → completed cleanly. `docs/investigations/20260820-api-auth-chain.md`.
- **Mission 3 (claude, bug_fix):** fixed the comment-realtime bug mission 1 discovered — data-layer touchProject('comment:changed') repairing web+MCP+REST at once, 6 new tests, 2601 suite green, commit ff-merged to feat/ai-hangar.
- Ops: `start-hangar-runner.bat` + `runner.env.example.bat` = any machine becomes a mission host. Known dev-only noise: event POSTs can 10s-timeout against a busy `next dev` (fire-and-forget by design; terminal writes retry).

## 🗺️ Owner roadmap 2008 — V1→V5 (see memory project-hangar-roadmap-v1-v5)

V1 = this POC. **V2 (MVP, priority order):** 1) storage — full report text stored in Aeon + rendered on the card (non-repo users see everything in-app; NO repo copy needed), a dedicated **hangar-vault** git repo as the version-controlled archive of deliverables (product repos stay clean), SharePoint mirror for work missions (StaffOne RAG); 2) model lists per engine probe-driven + surfaced in the card model picker; 3) AGENTS.md/CLAUDE.md bridge verified per engine. Plus spawn UI (trigger field manual/on_drop, launch+abort toast) and 4-5-mission parallelization via git worktrees. **V3:** admin tower (all sessions across machines, live transcript drawer, kill/retry, cost). **V4:** team layer (draft-vs-launch roles, runner identity, prod-box runners). **V5:** copilot-cloud engine, plan→auto-cards, Telegram verbs, resume.

## ⚠️ Warden 2008 — deferred findings (Sprint 2 debts, criticals/highs were fixed pre-commit)

- **Trust ladder (N8):** `hangarRepos.runCmd`/`envSetupCmd` are realm-editor-writable but the runner does NOT execute them yet. Before Sprint 2 wires them up, decide the trust model — "realm editor writes a command the operator's host executes" is a higher bar than card editing. Options: operator-side allowlist, owner-only fields, or keep execution config runner-local.
- **Worktree isolation (H4 full fix):** Sprint 1 only *refuses* missions when the target repo has uncommitted changes. Sprint 2 should move to `git worktree add` per session so missions never touch the live checkout.
- **Branch naming (N5):** `aeon/<8-hex>` collides at scale and re-dispatch silently reuses a stale mission branch. Consider `aeon/<taskId8>-<seq>` per dispatch.
- **Seq reset on reclaim (N6):** per-launch event seq restarts at 1; if session reclaim is ever added, old (session_id, seq) rows collide and new events (incl. result) are silently dropped. Persist a seq floor before adding reclaim.
- **Killed missions keep no envelope (LOW-2, deliberate for now):** operator-kill flips status to 'killed' before the runner's result event arrives, so the terminal guard refuses it and `lastResult` stays empty — a killed run's partial summary is lost. Revisit if operators want kill post-mortems on the card.
- **Runner dispatch fallback is dead code (LOW-4):** poller's local prompt builder never fires because Aeon always sends a non-empty prompt; if session.prompt ever becomes optional, wire `instruction` into session metadata first.
- **metadata.hangar writability (M3 residue):** any project editor can write `metadata.hangar.sessionIds/lastResult` via update_task — validator comment says system-written. Acceptable solo; revisit for multi-user realms (strip system keys from user-supplied metadata).

---

# ✅ CONFIRMED 2008 — owner sign-off (supersedes the proposals above)

**Gate closed 2026-08-20. Build authorized.** Amendments vs the A–E proposals:

1. **Naming: `aeon`, not `eon`, everywhere** — branch prefix `aeon/<taskId>`, skills `aeon-objective-*` ("eon" was a voice-mode artefact).
2. **Multi-engine Sprint 1 (major change).** This was always the *GitHub Copilot POC* at heart. Runner ships with spawn adapters for **claude / copilot / codex** from day one; engine is a per-card field, envelope engine-agnostic. Mission 1 (recon) on claude proves the loop; mission 2 re-runs the same recon on **copilot-cli** (the true POC proof); mission 3 = real bug_fix. AGENTS.md 3-line stub (→ CLAUDE.md canonical) is the Copilot/Codex entry door — verify Copilot actually follows the pointer.
3. **Card payload SLIMMED to 5 user fields + 2 system** (`metadata.hangar`): `objective`, `repo`, `agent` (**default `copilot`**), `model` (nullable; **copilot default = Opus 5** — verify exact slug during runner build), `instruction`; system: `session_ids[]`, `last_result`. Title = the card name itself.
4. **Cut from the card:** `skills` (auto-loaded/inferred — not user-managed), `base_branch` (registry default only), `output_mode` (**auto-derived from objective** for now, field addable later), `subagents` (inferred from `~/.claude/agents`; POC set = `inferno-executioner` + `inferno-prowler` only), `attachments`/`linked_cards`/`linked_docs` (defer — paste into instruction), `artifact_dir` (objective skill defaults it).
5. **B1 moot:** pro-wave-1708 was already merged (PR #103); `feat/ai-hangar` cut clean off main 2026-08-20.
6. Claim filter widens to `engine IN ('claude','codex','copilot')` (kairos rows still excluded).
7. A1–A3 (with aeon-naming), B2–B6, C1–C3, D2–D3, E1–E3: **confirmed as written.** D1 (first repo) implicitly aeon-side POC; AGENTS.md stub goes in regardless for the copilot leg.
