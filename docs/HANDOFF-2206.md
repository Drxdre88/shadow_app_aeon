# Handoff — Aeon session (22 Jun 2026)

Context for the next agent picking up this repo (`shadow_app_aeon`, the Aeon board app).
Stack: Next.js 16 / React 19 / Drizzle / **Neon Postgres** / Vercel / Pusher / Zustand.

---

## TL;DR — current state

- **Branch:** `fix/kairos-summary-backlog-allowlist` (working tree clean).
- **PR #65: MERGED → live in prod.** Realm-member assignee fix + **keep-warm cron removal** (the compute-cost fix).
- **PR #66: OPEN, CI green, MERGEABLE.** Two features bundled:
  1. `fc9806c` — "never-asleep saves" (auto-retry + durable offline queue + save-status pill).
  2. `056d8f2` — "Smooth UI Renders" master motion toggle.
- **Immediate next step:** decide whether to **merge #66** (prod deploy) as-is, or **split** the two features into separate PRs first. Then browser-verify.

---

## What is LIVE in prod (merged)

1. **Compute bleed stopped.** A `keep-warm` Vercel cron was pinging Neon every 4 min (`*/4 * * * *`), inside Neon's 5-min scale-to-zero window → compute ran 24/7 (~720 h/mo) and blew the compute-hour budget. **Removed** (cron entry + route). Neon now scales to zero on idle. Do **NOT** re-add a keep-warm cron — the correct lever for zero cold-start is a deliberate Neon plan setting (see Tier 4 below).
2. **Assignee picker fix.** Task assignee list read `projectMembers` only, so realm members (who get access via `groupMembers`) and the project owner were never assignable → empty picker on realm projects. New `findAssignableMembers` (owner + explicit members + realm members) feeds the picker and the assign-guard.

## What is in PR #66 (open, not yet deployed)

### A. Never-asleep saves (Tier 0 + Tier 1)
Goal: a board edit never silently vanishes when Neon is waking up or the network drops.
- `lib/store/persistMutation.ts` — `withRetry` (4 attempts, ~3.6s backoff) + `isTransientError`. Retries transient/cold-start failures before any rollback; real rejections (permission/validation) fail fast.
- `lib/store/mutationDispatch.ts` — serialisable mutation records (`task.create/update/delete/move`) + `dispatchMutation` + `isAlreadyApplied` (duplicate replay = success).
- `lib/store/mutationQueue.ts` — **durable** Zustand+persist (localStorage) FIFO queue. Optimistic edit applies instantly → enqueued → flushed with retry → confirmed. Survives tab close / offline-for-hours; re-flushes on `online` / tab focus / load. Only hard rejections roll back (and self-heal on next version-check). Rollback/onSuccess closures live in an in-memory `sideEffects` map keyed by mutation id (intentionally not persisted).
- `lib/store/boardStore.ts` — `saveStatus` state (`idle|saving|saved|retrying|error|offline`) + `setSaveStatus`.
- `components/board/SaveStatusPill.tsx` — header pill: Saving / Reconnecting / Offline (N) / Saved.
- `app/project/[id]/useBoardHandlers.ts` — the 4 task handlers now `enqueue` durably.
- **Coverage gap:** only the 4 **task** mutations are queued. Column / vault / archive handlers still use the simpler `persistMutation` retry path (or raw `.then/.catch`). Carded as a follow-up: "route column/vault/archive through the queue too."
- Tests: `persistMutation.test.ts`, `mutationDispatch.test.ts`, `mutationQueue.test.ts`.

### B. Smooth UI Renders toggle
Goal: one Settings switch to make the whole app instant (audit found real interaction-gating delays).
- Setting: `themeStore.smoothUiRenders` (default **true**) + `setSmoothUiRenders` + `useSmoothUiRenders()` selector. Allowlisted in `SAFE_PREF_KEYS` so it persists via DB prefs.
- UI: `components/ui/settings/GeneralTab.tsx` → `SmoothRendersSetting` (Settings → **Board/General** tab, ⚡ icon, top).
- Three coordinated layers when OFF:
  1. **Global CSS kill-switch** — `ThemeProvider` sets `html[data-reduce-motion="true"]`; `app/globals.css` rule flattens every CSS/Tailwind transition+animation to `0ms`.
  2. **Framer `MotionConfig reducedMotion="always"`** in `ThemeProvider` (disables transform/layout animations app-wide).
  3. **JS-timer offenders gated** to the setting: `SortableTaskCard` 250ms card-click open, three `mode="wait"` view swaps (`ProjectContent`, `ProjectViewSwitcher`, `aether/ReaderPane` → `sync` + 0 duration), `TaskBoard` drag drop-animation.
- **Known gap:** Framer *modal* open/close opacity fades (the "spring family": Settings/Help/Stats/Gantt/Changelog, plus NarrativeModal 500ms, KairosVisorShell 320ms) still fade over their own duration in fast mode (reducedMotion only kills transform, not opacity tweens). Their scale/slide IS disabled so they're much snappier. Clean follow-up: a shared motion-duration helper wired to the same setting.

---

## Outstanding roadmap (cards exist on the AEON APP board, mostly Human Review / Up Next)

The "never asleep" research produced a tiered plan. Done: Tier 0 + Tier 1 (in #66). Remaining:
- **Tier 3** — lighten the dashboard's 10s poll (it runs **two full server actions every 10s**, no version short-circuit — heaviest recurring DB load; `DashboardContent.tsx:169`). Adopt the board's cheap version-check pattern; add a Pusher connection badge + apply deltas instead of full re-download; move board Pusher channel to **private/authed** (currently public `board-<projectId>`).
- **Tier 4 — DECISION for the operator:** for zero work-hours cold-start, set Neon (Launch plan) auto-suspend to 30 min OR disable scale-to-zero (always-on floor ≈ 187.5 CU-h ≈ **~$20/mo**). This is the honest replacement for keep-warm. Do NOT re-add a cron.
- **Tier 5** — when the new fluid React app is built, adopt a real local-first sync engine (Zero/Rocicorp or ElectricSQL) from day one. Linear's lesson: sync engine first, not bolted on.
- **Snappiness quick-wins** (from the 4-prowler delay audit; not yet done — separate from the toggle): card-click → `onDoubleClick` (also fixes the "E shortcut" bug), shorten 300ms checkbox/drop durations to 150ms, focus `setTimeout`→`requestAnimationFrame` (TaskEditModal/VaultDaysModal/KairosVisor/TaskChecklist), QuickCapture 600→300ms close, prefetch Gantt/Canvas data at project mount (currently gated behind tab-click + board load → slow first visit).
- **Queue coverage** — extend the durable queue to column/vault/archive mutations.

---

## Open decisions awaiting the operator

1. **Merge PR #66** as-is, or split saves vs smooth-UI into two PRs?
2. **Tier 4** Neon always-on (~$20/mo) — yes/no?
3. Do the **snappiness quick-win batch** next?
4. **Kairos dialogue thread** `92d5914f-d0c4-453e-be04-a57186f5efad` is OPEN (free-topic, seeded on the autonomy/portfolio inflection). Not committed/distilled. Resume via `/kairos-dialogue --resume` or let it lapse.

---

## Board / realm restructure (done this session, via MCP — not code)

- **AI Engineering realm**: collapsed 13 boards → 7 slim + 1 rollup. Every active board now **4 columns**: `Backlog · In Progress · Review · Done` (Blocked = label). Zero card loss. 5 empty shell projects deleted (Arcane ML, Shadow Dag, KAL EL, VULCAN, RIFT). New **"AI Engineering — Mission Control"** rollup board (`Now · Next · Later · Shipped`, project id `99842710-8f58-4959-b442-1ae7b511f7f2`) — intended as the Kairos-readable prioritization surface.
- **AEON APP board** (flagship, realm AEON Dev) deliberately **left on 8-col** — this repo's `aeon-dev.md` automation depends on it. Do NOT collapse it without updating that file.
- **Per-repo `aeon-dev.md` configs** in the 6 collapsed boards' repos (shadow_app_swarm, shadow_data_lab, shadow_dev_lab, shadow_app_hydra, shadow_app_visor, shadow_app_arq) were rewritten to the 4-col model. **Verify whether those are committed in their own repos** — they were left uncommitted at the time.
- STP realm (10 boards) is the next candidate for the same 4-col treatment if asked.

## Memory / Kairos (done this session)

CC persistent memory refreshed: Aether marked **shipped & merged** (was stale "uncommitted"), and two new layers documented — **Kairos Asks** and **Kairos Dialogue**. See `memory/MEMORY.md` index. Aether/Asks/Dialogue are all live in main (PRs #60/#61/#62/#63).

---

## Gotchas / landmines

- **Stale Next types break local typecheck.** After deleting/renaming a route, `npx tsc --noEmit` fails on `.next/dev/types/validator.ts` referencing the old path. Fix: `rm -rf apps/web/.next/dev/types apps/web/.next/types` then re-typecheck. CI (fresh build) is unaffected.
- **`gh pr view` returns MERGED PRs** for the branch — when creating a new PR after a merge, use `gh pr create --base main --head <branch>` explicitly (don't trust the `||` fallback).
- **Commits: no `Co-Authored-By` lines** (operator preference).
- **Ship flow:** local typecheck + full test before push (Stop hook enforces it). Full suite is currently **1902 tests**.
- **MCP `aeon` server** = the prod server. New MCP tools must be deployed before callable.
- Neon writes are **never lost** during a cold-start — it's a connection wait, not data loss. The retry/queue handles it.

## Key file index

| Concern | Files |
|---|---|
| Durable saves | `lib/store/{persistMutation,mutationQueue,mutationDispatch}.ts`, `lib/store/boardStore.ts` (saveStatus), `components/board/SaveStatusPill.tsx`, `app/project/[id]/useBoardHandlers.ts` |
| Smooth UI toggle | `stores/themeStore.ts` (smoothUiRenders), `app/globals.css` ([data-reduce-motion]), `components/providers/ThemeProvider.tsx`, `components/ui/settings/GeneralTab.tsx` |
| Access / members | `lib/data/members.ts` (findAssignableMembers), `lib/data/projects.ts` (verifyProjectAccess) |
| Realtime / polling | `app/project/[id]/useProjectData.ts` (30s board poll, Pusher), `app/dashboard/DashboardContent.tsx` (10s poll — Tier 3 target), `lib/realtime/index.ts` |
| DB | `lib/db/index.ts` (Neon pool, poolQueryViaFetch), `apps/web/vercel.json` (crons — keep-warm REMOVED) |
