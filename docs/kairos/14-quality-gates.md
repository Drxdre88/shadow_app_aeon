# Kairos — Quality Gates

**Date:** 01/06/2026 (0106) · **Phase:** 2 (Block A4 of A1–A4)
**Companion docs:** [`12-kairos-evolution-plan.md`](./12-kairos-evolution-plan.md), [`13-handover-2026-06-01.md`](./13-handover-2026-06-01.md)

This is the operating doc for *how memories enter and leave the brain* — the rules that keep the substrate signal-rich without losing what matters. It replaces the original A3 prune plan after the owner-overruled reframe.

---

## 1. Stream classes — what enters what

Every memory carries a `stream_class` (added in A1). The class decides how the cosmic view, the Briefer, and (Phase 1B) the archetype generator treat the row.

| Class | What it is | Where it comes from | Visibility default |
|---|---|---|---|
| `reflection` | Owner-fired first-class signal — beliefs, priorities, observations, corrections. **Higher weight than any other class.** Can override drift. | `manual` source, `type='reflection'`, EOD button, future phone capture | always visible |
| `idea` | Free-form user thought, capture, manual note. The default for anything not otherwise classified. | `manual` source, `type='note'` | visible |
| `agentic` | Produced by an agent session — Claude Code session summaries, future Codex sessions, MCP tool capture from agents | `source IN ('claude','agent_session')` | visible (collapsible) |
| `execution` | Activity-derived: board imports, cron snapshots, project rollups, system events. "What was done." | `source IN ('import','cron')` + system kinds | collapsed by default |
| `archetype` | Phase 1B — Kairos-synthesised master nodes per Dominion (one row per archetype) | `kairos_reflect` MCP tool / nightly synthesis | pinned, always visible |
| `cortex` | Phase 1B — the living Dominion document. One per Dominion, regenerated nightly. | nightly synthesis pass | pinned, always visible |

**Rule:** when capturing a new memory through the data layer, infer `stream_class` from `source` + `type` + `source_metadata.kind` using the same cascade used by the A1 backfill. Default to `idea` only if nothing else fits.

---

## 2. The memory/board boundary (reframed in A3)

The board (`board_tasks`) is the source of truth for cards. The brain (`memories`) is the source of truth for synthesis — decisions, reflections, advisories, archetypes.

**Don't mirror.** Earlier the `kairos-board-backfill` script imported every card as a memory so the Briefer could see them. That created stale duplicates and polluted the substrate. As of A3 the Briefer reads cards live via `inspectDominion()`'s board-task join. The bulk-import script is deprecated (tripwire requires `KAIROS_ALLOW_LEGACY_BOARD_BACKFILL=1`).

**What goes in memories from board activity:**
- ✅ A manual reflection about a card (e.g. "the DB migration card has been sitting for 3 weeks because I'm scared of locking writes — need to schedule a maintenance window").
- ✅ A briefing advisory that names cards (these are Kairos's reading of board state, not the cards themselves).
- ✅ Agentic summaries that reference card work.
- ❌ The card's title and description. That's already on the board. Querying live is cheap.

**Card-level retention:** every card on every board is signal, regardless of length. A 22-char `finish DB migration` is as important as a 2-page spec. We never delete cards as cleanup — they live on the board, the board is permanent.

---

## 3. Cross-user data isolation (known leak)

The A2 work surfaced 5 memories owned by user `3d600c5f` that reference board cards / projects owned by *other* beta-tester users (e.g. `Test2`, `mr dubai`). They got into the owner's memory table via the cron snapshot job.

**Rule going forward:** any cron / system / import job that captures memories must scope to the owner of the source object. Snapshotting another user's project into your memory layer is a bug, not data.

**Action item (separate card):** audit `app/api/cron/project-snapshot/route.ts` and `lib/kairos/auto-capture.ts` for cross-user scoping; the 5 surfaced orphans are the symptom of whatever the leak is.

---

## 4. Dominion lifecycle (graduation rules)

The 8 Dominions are intentionally non-hierarchical, but have an implicit lifecycle:

```
Idea/experiment  →  Shadow Lab        (research, not a product yet)
                 →  Shadow Apps       (becomes an app, not flagship)
                 →  own Dominion      (graduates: Swarm did, AEON did)
                 ←  Shadow Apps       (de-graduates if it stalls)
```

**Movement rule:** a Dominion's `id` is permanent. To move an app between Dominions, update `project.dominion_id` (and `dominion_repos` if the repo follows). Memory `dominion_id`s either follow the project (via cascade re-run) or stay anchored to the *capture-time* Dominion as historical record — TBD when the first graduation actually happens.

**Cortex transferability (Phase 1B):** when we build the cortex, its content must be transferable across Dominion ids — i.e. content keyed by `dominion_id` not embedded with it. If we ever rename or merge Dominions, the cortex follows.

---

## 5. Reflection weight (Phase 1B contract)

Reflections are first-class. When the archetype generator runs (Phase 1B):

- A reflection of class `reflection` outweighs N memories of any other class in the same time window (calibration: start at N=10, tune empirically).
- A reflection can **override** drift flags. If activity in a Dominion suggests "user has lost interest" but a recent reflection contradicts that, the reflection wins.
- Reflections are never archived by the compaction job. They live forever.

---

## 6. Compaction policy (what this scaffold will do in Phase 1B)

Weekly cron at `app/api/cron/memory-compaction/route.ts` (added in this block as a stub).

**Phase 1A behaviour (now):** count, report, archive nothing. Logs the per-Dominion / per-stream breakdown so we can see how the substrate is evolving.

**Phase 1B behaviour (next):**
1. For each Dominion, fetch all `execution`-stream memories older than 30 days unarchived.
2. Bucket by week.
3. Call the archetype generator to either (a) absorb them into an existing archetype, or (b) create a new one if they form a coherent theme.
4. Soft-archive (`archivedAt = now`) every memory the archetype absorbed. Pinned and `reflection`-class rows are never archived.
5. Regenerate the cortex doc for any Dominion whose archetypes changed.

**Tuning knob:** `MIN_AGE_DAYS` (default 30), `BATCH_SIZE` (default 200 memories per Dominion per run). Never time out compaction; if a Dominion is over budget, defer the rest to next week.

---

## 7. What the substrate looks like as of A4

```
Total memories:        378
Dominions:             8 (1 existing + 7 created in A2)
Repos bound:           10
Projects assigned:     29 (of 31 owner-scoped projects; 4 from other users left alone)

Stream class:
  execution            237  (board imports + cron snapshots — kept, every card is signal)
  agentic               89  (claude / agent session summaries)
  idea                  52  (free-form thought, manual notes)
  reflection             0  (first reflection captures land here)

Dominion partition (after A2 cascade + A3 orphan reassign):
  Swarm                 66
  Shadow Lab            64
  AEON                  63
  Shadow Apps           51
  STP Dev               46
  STP Asset Trading     36
  STP Spec              31
  STP Quant             16
  (unassigned)           5  ← cross-user leak, see §3
```

---

## 8. Watch list (what to keep an eye on)

| Item | Why | When it bites |
|---|---|---|
| Cross-user cron snapshot leak (§3) | Other users' projects in your memory table | Now — surfaced 5 rows; will compound as more beta users add data |
| Intra-day card-change polling | Owner wants Kairos to enquire mid-day, not just morning | Phase 1D (loop scheduler) |
| Cortex transferability (§4) | Graduation movements break if cortex is embedded in the Dominion | Phase 1B build |
| Reflection weight calibration (§5) | The N=10 multiplier is a guess | First reflections captured + first archetype runs |
| Substrate growth rate | At 378 memories now; if it doubles weekly without compaction the substrate becomes lossy | After Phase 1B compaction runs once |

---

## 9. Phase 1A ship gate (now satisfied)

✅ Every memory has a `stream_class`
✅ Every applicable memory has a `dominion_id` (98% — 5 cross-user orphans excepted)
✅ No empty-shell pruning (reframed — every card is signal)
✅ Hygiene cron scaffolded at `app/api/cron/memory-compaction/route.ts`

Next: **Phase 1B** — archetype generator + Dominion cortex schema + `kairos_reflect` MCP tool.
