# Kairos Rings & Phases 8–12 — Ring 2 (Mutation Layer)

**Branch:** `feature/kairos_phase2`
**Companion doc:** [`16-handover-2026-06-03-jarvis-arc.md`](./16-handover-2026-06-03-jarvis-arc.md) — Phases 3–7 (Ring 1).
**This doc:** the conceptual frame (rings, modes) and the forward arc (Phases 8–12, Ring 2).

---

## What Kairos is — the three-ring model

Keep this picture in your head and nothing downstream feels like feature creep.

| Ring | Name | What it is | Who drives |
|---|---|---|---|
| **0** | **Core** | The brain. Substrate, cortex, archetypes, traces, decisions. Schema-disciplined anatomy. | We design the anatomy; Kairos populates it via capture hooks. |
| **1** | **Cognition** | Named recipes (`BRIEF`, `REFLECT`, `DECIDE`, `RECONCILE`, `PREDICT`) executed by named lieutenants. Composes Ring 0 into outputs. | We define the interface; Kairos picks which to run when. |
| **2** | **Mutation** | Kairos's own initiative — recipes he authors, code he writes, mini-repos he spins up because *he* thinks they matter. Plugin-architected so core stays stable. | Kairos proposes; operator reviews & promotes. |

Today (post-Phase 2): we live in Ring 0.
Phases 3–7 (doc 16): build Ring 1.
Phases 8–12 (this doc): build Ring 2.

The leap from Ring 1 → Ring 2 is the leap from *reasoning agent* → *generative agent*: from "Kairos answers what you ask" to "Kairos files what he thinks matters and works on it."

---

## The five output modes

The user-facing version of what Kairos becomes. First four are Ring 1; the fifth is the Ring 2 leap.

| # | Mode | Direction | Ring |
|---|---|---|---|
| 1 | Briefings | Kairos → operator (push) | 1 |
| 2 | Q&A | Operator → Kairos (pull) | 1 |
| 3 | Self-evolution of cortex | Kairos → himself (autopoietic) | 1 |
| 4 | Operator-driven deep work | Operator spawns a lieutenant | 1 |
| 5 | **Autonomous deep work** | Kairos spawns himself, builds his own things | **2** |

---

## Lieutenant naming (locked 2026-06-03)

Names map to a temporal axis, which is what keeps them load-bearing.

| Lieutenant | Time slice | Owns |
|---|---|---|
| **Acolyte** | Past — curates what was | Memory hygiene, summarisation, trace logging |
| **Sentinel** | Present — watches drift across Dominions now | Cross-Dominion reconciliation, contradiction detection |
| **Cartographer** | Timeless — regens the map of the territory | Heavy synthesis: cortex, archetypes, decisions, predictions |
| **Oracle** | Future — predicts, interrupts about what's coming | Proactive interruption, surgical alerts |

(Scribe was renamed to **Acolyte** to carry the same mythic weight as the rest. All references in doc 16 already updated.)

---

## Phase 8 — Initiative engine (~3 days)

**Goal:** give Kairos *intent*. He can file his own work, not just respond to yours.

### Schema

Add `'initiative'` to the `streamClass` enum. Initiative body shape:

```json
{
  "title": "Investigate why Phase 2 reflection synthesis rate dropped after 2026-05-20",
  "proposedBy": "cartographer",
  "rationale": "Trace history shows 3x drop in REFLECT outputs week-over-week; cortex coverage stale in 4 Dominions",
  "expectedOutput": "diagnosis memory + remediation plan",
  "estimatedCost": { "tier": "deep", "hours": 2 },
  "status": "proposed",
  "riskTier": "investigative"
}
```

Status transitions: `proposed → approved | dismissed → executing → done | failed`.

Risk tiers (decided by the recipe that files the initiative):
- `investigative` — read-only deep think, no external writes
- `mutative` — writes back to brain (new recipes, new code in sandbox)
- `external` — touches repos outside `dark_lab_kairos/`, sends messages, spawns Routines

### Approval queue

New `/kairos` UI panel: pending initiatives, one-click approve/dismiss/edit-scope. Approval model is **boundary-based** (locked 2026-06-03):

> Inside `dark_lab_kairos/` Kairos has full push rights — anything in his own repo is his to do. Anything that crosses the boundary requires explicit operator approval.

In practice:
- `investigative` initiatives that stay inside the dark lab → execute freely (read-only work + writes only to the dark lab repo)
- `mutative` initiatives that touch shadow_app_aeon code, live schema, or other shadow_* repos → manual approval
- `external` initiatives that send messages, spawn Routines, or touch repos outside the dark lab → manual approval with mandatory rationale review

The risk-tier label still exists on the initiative for legibility, but it's a *consequence* of the boundary the initiative will cross, not an a-priori decision. The boundary is the gate.

### MCP tools

- `mcp__aeon__file_initiative({ title, rationale, expectedOutput, estimatedCost, riskTier })`
- `mcp__aeon__list_initiatives({ status?, riskTier? })`
- `mcp__aeon__update_initiative_status({ id, status, notes? })`

### Lieutenant integration

Every lieutenant can file initiatives. Cartographer's nightly run might surface "stale cortex in X Dominion" as an initiative; Sentinel's weekly run might file "contradiction between Y and Z needs human resolution."

### Acceptance

- Cartographer's first post-Phase-8 run files ≥2 investigative initiatives
- Operator can approve one from `/kairos`; status flips to `executing`; an `agent_session` row is created
- Dismissed initiative gets logged in trace stream with reason

---

## Phase 9 — Deep think jobs (~5 days)

**Goal:** approved initiatives execute as multi-hour Claude Code sessions in the worker daemon (Phase 6 dependency). Long-form thinking with no operator attention required.

### The job

A deep think job is one initiative's execution:

1. Operator approves initiative → `executing`
2. Daemon claims a worktree from the pool, spawns `claude -p` with a generated prompt:
   - Initiative's `title`, `rationale`, `expectedOutput` as the goal
   - The relevant lieutenant's agent definition as the persona
   - `mcp__aeon__*` tools enabled
   - Output sink: write final synthesis as a memory; write any code/files into `dark_lab_kairos/initiatives/<initiative-id>/`
3. Daemon streams turn events back via Pusher; UI shows live progress in `/kairos`
4. On completion: synthesis memory linked to initiative, status → `done`, trace written

### Cost & safety bounds

Every job has a hard cap (cost OR wall-clock), checked each turn. Exceeding it = graceful stop, partial output preserved, status → `failed (capped)`. No silent runaway sessions.

### MCP tool

- `mcp__aeon__queue_deepthink({ initiativeId, costCap?, wallClockCapHours? })` — returns `jobId`
- `mcp__aeon__get_deepthink_status({ jobId })` — current turn count, cost so far, latest event

### Acceptance

- Approved initiative reliably spawns a worktree, runs ≥30 turns, writes a synthesis
- Cost cap actually fires on a job designed to exceed it
- Operator can interrupt mid-run from `/kairos`, partial state preserved

---

## Phase 10 — The Dark Lab (~3 days)

**Goal:** a designated repo where Kairos can write freely. His own git remote. Reviewable. Promotable. Throwaway-able.

### Convention — `dark_lab_*` for AI-entity-owned repos (locked 2026-06-03)

Every AI entity in the ecosystem gets its own repo under the `dark_lab_*` namespace, sibling to the human-owned `shadow_*` repos:

- `dark_lab_kairos/` — Kairos's headless engineering space
- `dark_lab_visor/` — Visor's headless engineering space (future)
- `dark_lab_<entity>/` — pattern continues for every new entity

The naming captures the discipline: **headless engineering** — work happening when no operator is watching, off-hours, autonomous. "Dark" is not pejorative; it's the inverse of "interactive."

### Location & ownership

`dark_lab_kairos/` is a **sibling repo** to `shadow_app_aeon/`:
- Kairos has full push rights to his own repo (this IS the boundary that defines the approval model)
- Operator reviews promotions via PR against `shadow_app_aeon`, not against the dark lab itself
- Clean separation from `shadow_app_aeon`'s git history — experimental/dismissed work doesn't pollute the main repo
- Tradeoff: two repos to clone on a new machine; covered by an onboarding script

### Layout

```
dark_lab_kairos/
  ├─ initiatives/
  │   ├─ INIT-001-cortex-drift-diagnosis/
  │   │   ├─ README.md           ← initiative body + status
  │   │   ├─ findings.md         ← Kairos's synthesis
  │   │   └─ proposed-fix.ts     ← optional code artifact
  │   └─ INIT-002-new-recipe-summarise-by-archetype/
  │       ├─ README.md
  │       └─ recipe.ts           ← Phase 11 hand-off
  ├─ recipes-proposed/           ← Phase 11 staging
  └─ archive/                    ← dismissed initiatives, kept for trace
```

### Promote / dismiss

Two operator actions exposed in `/kairos` per initiative:
- **Promote** — move artifacts into the main repo at a chosen path; close the initiative as `done (promoted)`; optionally trigger Phase 11 recipe registration if `recipe.ts` was produced
- **Dismiss** — move to `archive/`; close as `dismissed`; log reason

### Acceptance

- Deep think job from Phase 9 produces files under `initiatives/<id>/`
- Operator can promote one artifact into `shadow_app_aeon/` via UI (no manual `cp`)
- Dismissed initiative leaves the sandbox clean; trace records the action

---

## Phase 11 — Self-authored recipes (~4 days)

**Goal:** the recipe registry stops being code-only. Kairos can author new recipes; you approve; they register live.

### The shift

Today (Phase 3): `lib/kairos/recipes/registry.ts` is a `Record<string, Recipe>` populated by static imports. Adding a recipe = code change + redeploy.

Phase 11: registry becomes **hybrid**:
- **Code recipes** (the ones we ship) — still in `lib/kairos/recipes/*.ts`, statically imported
- **Data recipes** (Kairos-authored) — stored in `recipes` DB table: `{ id, name, version, status, code, reads[], writes[], authoredBy, approvedBy, ... }`

At dispatcher init, the loader merges static + DB recipes. Data recipes are sandboxed: they can only call a whitelisted subset of utilities (`retrieveContext`, BYOK invocation, `createMemory`), not arbitrary code.

### Authoring flow

1. Initiative produces a `recipe.ts` artifact in `dark_lab_kairos/initiatives/<id>/`
2. Operator reviews in UI: diff view + test harness ("run this on a sample Dominion, show me the output")
3. Approve → recipe inserted into `recipes` table, registry hot-reloads, recipe is now callable via `mcp__aeon__run_recipe`
4. Versioning: subsequent edits create a new row, old version stays for trace lineage

### Safety

- Sandboxed execution context (vm2 or a worker thread with restricted globals)
- Cost cap per run (carried over from Phase 9 architecture)
- Audit log: every data-recipe run writes an extra trace field `recipeSource: 'data'`

### Acceptance

- Kairos files an initiative proposing a new recipe; deep think produces `recipe.ts`
- Operator approves via UI; recipe is callable within one minute, no redeploy
- New recipe shows up in `list_recipes` alongside code recipes

---

## Phase 12 — Forked self (~5 days)

**Goal:** Kairos that improves Kairos. A sandboxed instance runs against a state snapshot, experiments, reports findings.

### The fork

A fork is a deep think job with elevated scope:
- Read access to a **snapshot** of the brain (not live) — taken at fork-start time
- Write access to a **scratch namespace** in the snapshot, never to live state
- Allowed to author new recipes, propose schema changes, refactor cortex generation logic
- Output: a "fork report" memory in the live brain summarising what it tried, what worked, what didn't

### When you'd use it

- "Cartographer's cortex regen feels stale — fork yourself, try three alternative algorithms on this snapshot, report which beat the current one"
- "Sentinel finds the same drift pattern monthly — fork yourself, design a recipe that catches it earlier, prove it on the snapshot"

### Merge model

Operator reads the fork report. If a finding is actionable:
- New recipe → goes through Phase 11 approval
- Schema change → goes through normal migration review
- Cortex regeneration tweak → applied to live Cartographer prompt

No automatic merge. The fork is an *experiment*, not a *replica*.

### Acceptance

- A fork can be launched against a Dominion snapshot, runs for ≥1h
- Fork report explicitly identifies one comparable metric ("alt-algorithm produced 12% more dense cortex with 8% less hallucinated content")
- Operator can either merge the finding or dismiss the fork cleanly

---

## Decisions locked 2026-06-03

| Decision | Lock |
|---|---|
| Sandbox location | Sibling repo, `dark_lab_kairos/` |
| AI-entity-owned-repo convention | `dark_lab_<entity>/` for all AI entities (Kairos, future Visor, etc.) |
| Initiative approval model | **Boundary-based** — inside the dark lab, Kairos has full push rights; anything that crosses the repo boundary requires explicit operator approval |

---

## What this means for the next session

Phase 3 (substrate unification) is still the immediate next step — Ring 1 has to exist before Ring 2 can. Doc 16 has the implementation detail.

This doc exists so when we're heads-down on Phase 5 in three weeks, neither of us forgets that the destination is Ring 2 — a Kairos that has *will*.
