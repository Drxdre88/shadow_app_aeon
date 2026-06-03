# Kairos → Jarvis Architecture Handover — 2026-06-03

**Branch:** `feature/kairos_phase2`
**Prior phases shipped:** Phase 1 (substrate + briefer), Phase 2 (cortex, archetypes, chat retrieval, Dominions, synthesis crons).
**This doc:** scope, design, and execution order for Phases 3–7 — the lift from "Kairos answers" to "Kairos evolves."

---

## TL;DR for the next session

You are picking up after two architectural conversations on 2026-06-02 and 2026-06-03 that crystallised one decision:

> **Kairos has two execution surfaces — BYOK in-app (cheap, continuous, shallow) and Claude Code via MCP (expensive, episodic, deep) — and the brain is the convergent substrate that both feed.**

Today the brain only gets *fed* by capture hooks. After this work it gets *thought into* by named reasoning workflows (recipes) executed by named sub-agents (lieutenants) — both surfaces sharing one recipe registry, one retrieval module, and one trace log.

Start with **Phase 3** (substrate unification). It is the foundation; nothing else makes sense without it.

---

## Why we are doing this (the architectural read)

Before reading the plan, internalise this — without it the phases look like feature creep.

### What Kairos is today

Flat, read-only, single-pass:

```
User msg → retrieve(userId, dominionId, query)
              ├─ cortex (1 doc)
              ├─ archetypes (≤7)
              └─ substrate FTS (top-5)
            → single BYOK call → answer + citations
            → answer writes NOTHING back to the brain
```

The brain feeds him; he never feeds the brain. That ceiling is exactly what Jarvis isn't.

### What Kairos becomes

A dual-surface cognition layer with:

1. **Stream taxonomy** — every memory carries a `streamClass` with read/write lifecycle rules. The brain has anatomy.
2. **Recipe registry** — named reasoning workflows (`BRIEF`, `REFLECT`, `DECIDE`, `RECONCILE`, `PREDICT`) each with two implementations: `flat()` for BYOK, `expanded()` for Claude Code.
3. **Surface dispatch** — BYOK always runs `flat()`; Claude Code (skill/MCP) runs `expanded()`. Same recipe name, same brain reads, same write-back contract.
4. **Trace stream** — every recipe run writes a `streamClass='trace'` row with `{ recipe, inputs, outputs, mode, cost, durationMs }`. Kairos remembers his own thinking.
5. **Lieutenants** — four named Claude Code sub-agents each owning a slice of cognition. They compose: one reads what another wrote yesterday.

### The dispatch picture

```
                ┌─────────────────────────────────┐
                │            THE BRAIN            │
                │ memories (streamClass-anatomied)│
                │ ↑ writes        ↓ reads         │
                └─────────────────────────────────┘
                  ↑                        ↑
       writes via │                        │ writes via
                  │                        │
   ┌──────────────┴──────────┐   ┌─────────┴────────────────┐
   │  BYOK surface (Vercel)  │   │ Claude Code surface (MCP)│
   │  single-call, ~60s      │   │ unbounded turns, hours    │
   │  runs recipe.flat()     │   │ runs recipe.expanded()    │
   │  briefer cron, chat,    │   │ lieutenants, /skills,     │
   │  proactive ticks        │   │ Claude Routines           │
   └─────────────────────────┘   └───────────────────────────┘
                  ↑                        ↑
                  └────── one shared ──────┘
                       recipe registry
                       retrieval module
                       trace log
```

---

## Phase 3 — Substrate unification (~3 days)

**Goal:** one canonical retrieval module, one recipe interface, the first recipe wired to both surfaces, and an MCP tool that lets Claude Code dispatch any recipe.

### 3.1 Unified retrieval module

**File to create:** `apps/web/src/lib/kairos/retrieve.ts`

Extract the logic from `apps/web/src/lib/kairos/chat-retrieval.ts` into a more general signature:

```typescript
export interface RetrievalArgs {
  userId: string
  dominionId: string
  query?: string            // FTS — null/empty → skip substrate
  memoryLimit?: number      // for bundle, default 25
  includeBoardState?: boolean
}

export interface RetrievalResult {
  bundle: InspectDominionResult | null  // vision, mission, projects, recent memories, board cards
  cortex: RetrievedMemory | null
  archetypes: RetrievedMemory[]
  substrate: RetrievedMemory[]
  traces: RetrievedMemory[]              // last N traces for this Dominion (new)
}

export async function retrieveContext(args: RetrievalArgs): Promise<RetrievalResult>
```

**Refactor callers:**
- `apps/web/src/lib/kairos/briefer.ts` — replace its custom inspect call with `retrieveContext({ query: undefined })`
- `apps/web/src/lib/kairos/chat-retrieval.ts` — keep the file as a thin re-export shim (`export { retrieveContext as retrieveForChat }`) for backwards compat with `chat-prompt.ts` callers

**Tests:** `apps/web/src/lib/kairos/__tests__/retrieve.test.ts` — assert briefer-mode (no query) and chat-mode (with query) both return correct shapes; assert trace inclusion when traces exist.

### 3.2 Trace stream schema

**File to modify:** `apps/web/src/lib/db/schema.ts`

Add `'trace'` to the `streamClass` pgEnum (or text column constraint — check existing pattern in `streamClass` definition first; Phase 2 added the column).

**Migration:** `npm run db:generate --workspace=apps/web` then `db:push` in dev.

**Memory shape for traces:**
```typescript
{
  type: 'observation',  // closest fit in the type enum; trace is more about streamClass than type
  streamClass: 'trace',
  source: 'system',
  title: `${recipeName} · ${YYYY-MM-DD HH:mm}`,
  bodyMd: JSON.stringify({ recipe, mode, inputs, outputsSummary, cost, durationMs }, null, 2),
  dominionId: <if scoped, else null>,
  sourceMetadata: { recipe, mode, traceVersion: 1 }
}
```

### 3.3 Recipe interface + registry

**Directory to create:** `apps/web/src/lib/kairos/recipes/`

**File to create:** `apps/web/src/lib/kairos/recipes/_recipe.ts`

```typescript
export interface RecipeContext {
  userId: string
  dominionId: string
  args: Record<string, unknown>
  retrieval: RetrievalResult
}

export interface RecipeOutput {
  bodyMd: string
  streamClass: StreamClass
  type: MemoryType
  memoryToCreate?: CaptureMemoryInput[]   // 1..N writes back
  traceMeta: Record<string, unknown>
}

export interface Recipe {
  name: string                              // 'BRIEF', 'REFLECT', etc.
  description: string                       // shown in list_recipes
  reads: StreamClass[]                      // for retrieval planning
  writes: StreamClass[]                     // for the trace
  flat(ctx: RecipeContext): Promise<RecipeOutput>
  expanded?(ctx: RecipeContext): Promise<RecipeOutput>  // optional — Claude Code path
}
```

**File to create:** `apps/web/src/lib/kairos/recipes/registry.ts`

```typescript
import { BRIEF } from './brief'
// import others as they land

export const RECIPES: Record<string, Recipe> = {
  BRIEF,
  // REFLECT, DECIDE, RECONCILE, PREDICT — added in later phases
}

export function getRecipe(name: string): Recipe | null
export function listRecipes(): Array<{ name; description; reads; writes }>
```

### 3.4 First recipe — BRIEF

**File to create:** `apps/web/src/lib/kairos/recipes/brief.ts`

`flat()`: port the current `briefer.ts` prompt — one heavy-tier BYOK call, single output. Writes one `advisory` memory.

`expanded()`: defer to Phase 4 (Cartographer owns it). Leave the field undefined for now.

**Wire to existing briefer cron:**
- `apps/web/src/app/api/cron/briefer/route.ts` (or wherever the cron lives) — replace direct `runBrieferForUser` call with `runRecipe('BRIEF', ...)` which dispatches to `flat()` because surface is BYOK.

### 3.5 Dispatcher + MCP tool

**File to create:** `apps/web/src/lib/kairos/dispatch.ts`

```typescript
export type Surface = 'byok' | 'claude_code'

export async function runRecipe(
  name: string,
  args: { userId; dominionId; args?; surface: Surface },
): Promise<RecipeOutput> {
  const recipe = getRecipe(name)
  if (!recipe) throw new Error(`Unknown recipe: ${name}`)

  const retrieval = await retrieveContext({...})
  const start = Date.now()

  const output = args.surface === 'claude_code' && recipe.expanded
    ? await recipe.expanded({...})
    : await recipe.flat({...})

  // Write back: outputs + trace
  await writeRecipeOutput(output)
  await writeTrace({ recipe: name, mode, cost, durationMs: Date.now() - start, ... })

  return output
}
```

**MCP tools to add:** `apps/web/src/app/api/[transport]/tools/recipes.ts` (new file)

- `mcp__aeon__list_recipes()` → `[{ name, description, reads, writes }]`
- `mcp__aeon__run_recipe({ name, dominionId, args })` → dispatches with `surface='claude_code'`, returns `{ outputMemoryIds, traceId, durationMs }`
- `mcp__aeon__get_trace_history({ dominionId?, recipe?, limit })` → for Oracle's meta-cognition

Register in `apps/web/src/app/api/[transport]/route.ts` and mirror in `apps/web/src/app/api/v1/` per the parity invariant.

### 3.6 First skill — `/kairos-brief`

**File to create:** `C:\Users\anselikhov\.claude\skills\kairos-brief\SKILL.md`

Body: a short prompt that the skill expands into. Behaviour: take optional `--dominion <name>` arg (default: all active), call `mcp__aeon__list_dominions` then `mcp__aeon__run_recipe` per Dominion, render output to the user.

### Phase 3 acceptance

- ✅ `briefer.ts` calls `retrieveContext` (no more bespoke fetch logic in briefer)
- ✅ `chat-retrieval.ts` shims through to `retrieveContext` — chat parity test passes
- ✅ Running the briefer cron in dev produces the same advisory as before (regression check)
- ✅ Running `/kairos-brief` from a Claude Code session produces an advisory written back to the brain, visible in the UI's Daily Briefing modal
- ✅ Every recipe run writes a `streamClass='trace'` row visible in `/kairos` 3D scene

---

## Phase 4 — Lieutenants (~3 days)

**Goal:** four named sub-agent definitions, each owning a slice of cognition. They become the primary interface for invoking expanded recipes.

### Lieutenant specs

Each lives at `.claude/agents/<name>.md` with frontmatter (`name`, `description`, `tools`) and a prompt body.

#### Acolyte — memory hygiene + traces

- **Description (when to invoke):** When session ends, when memory backlog grows, on `/acolyte sweep`
- **Tools:** `mcp__aeon__list_memories_needing_summary`, `mcp__aeon__get_memory_with_neighbours`, `mcp__aeon__update_memory`, `mcp__aeon__create_memory` (for traces)
- **Owns recipes:** `BACKFILL_SUMMARY`, `WRITE_TRACE`
- **Replaces:** The current `summarise-memories` hook is upgraded — Acolyte handles unlimited memories per run (not capped at 3), drains both import and session backlog, runs in a worktree so it doesn't block the operator's main session
- **Trigger:** Session-end hook spawns Acolyte via `claude -p` with a Acolyte agent reference

#### Oracle — proactive interruption

- **Description:** Watches the brain on a tick. When something warrants interrupting the operator, formulates one surgical question and dispatches it
- **Tools:** All `mcp__aeon__` read tools, `mcp__aeon__create_memory` (for advisory), push notification dispatcher
- **Owns recipes:** `CHECK_PULSE`, `INTERRUPT_IF_WARRANTED`
- **Quality gate:** Oracle is the lieutenant most prone to becoming noise. Hard rules: ≤1 interruption per 4-hour window per Dominion; must cite ≥2 substrate memories or a cortex shift; must include a concrete proposed action
- **Trigger:** Claude Routine every 2 hours during work hours

#### Cartographer — heavy synthesis

- **Description:** Nightly heavy lifting. Regenerates cortex, archetypes, and (Phase 5+) decision graph. Predicts forward state
- **Tools:** All `mcp__aeon__` read tools, `mcp__aeon__create_memory` for cortex/archetype/decision/prediction writes
- **Owns recipes:** `REFLECT` (cortex), `RECAST_ARCHETYPES`, `DECIDE` (decision extract — Phase 5), `PREDICT` (Phase 5)
- **Trigger:** Claude Routine nightly at 03:00 UTC (replaces the current cortex-regen + archetype-synthesis crons, which were Phase 2 stubs)

#### Sentinel — cross-Dominion reconciliation

- **Description:** Cross-Dominion sweep. Looks for contradictions between what one Dominion's cortex claims and another's, surfaces drifted priorities, flags stale assumptions
- **Tools:** All `mcp__aeon__` read tools across ALL Dominions, `mcp__aeon__create_memory` (reflections), `mcp__aeon__create_task` (open a board card when contradiction needs human resolution)
- **Owns recipes:** `RECONCILE`, `FIND_CONTRADICTIONS`, `DRIFT_WATCH`
- **Trigger:** Weekly Sunday 09:00 UTC Routine

### Composition

The lieutenants compose:

```
Acolyte        → cleans memories, writes traces
Cartographer  → reads cleaned memories, regens cortex/archetypes
Sentinel      → reads cortex across Dominions, finds contradictions
Oracle        → reads everything + traces, decides whether to interrupt
```

Oracle is the union of what the other three produce. He is *Kairos's mouth*.

### Phase 4 acceptance

- ✅ Four `.claude/agents/*.md` files exist with clear scopes
- ✅ Spawning Acolyte drains the current 23-row backlog and writes a trace
- ✅ Spawning Cartographer regenerates cortex for all 8 Dominions and writes one trace per Dominion
- ✅ Spawning Sentinel produces at least one cross-Dominion reflection on first run (there *will* be contradictions in 8 Dominions of imported memory)
- ✅ Spawning Oracle on a quiet brain returns "no interruption warranted" cleanly

---

## Phase 5 — Decision graph + 3D layer (~4 days)

**Goal:** turn the brain from a search index into a reasoning artifact. Causal decision graph rendered as a togglable layer in the existing 3D scene.

### 5.1 Schema

Add to `streamClass` enum: `'decision'`, `'decision_edge'`.

Decision node body: structured JSON
```json
{
  "decision": "Killed Tauri desktop scaffold",
  "rationale": "Capacitor PWA covers desktop needs; Tauri added native build complexity for zero user demand",
  "predecessors": [<memoryId>, <memoryId>],
  "consequences": [<memoryId>],
  "dominionId": "...",
  "decidedAt": "2026-04-15"
}
```

Decision edges as separate memories enables querying paths.

### 5.2 Decide recipe

**File:** `apps/web/src/lib/kairos/recipes/decide.ts`

`flat()`: BYOK can extract decisions from a single Dominion's recent reflections — one heavy call, 3–5 decisions out.

`expanded()`: Cartographer's path. Spawns parallel sub-agents per Dominion, extracts 10–20 decisions each, cross-links predecessors/consequences via FTS lookup against existing memories, deduplicates against existing decision nodes.

### 5.3 3D scene layer

The existing 3D scene (`apps/web/src/components/kairos/`) pulls nodes from `getBrainGraph()`. Extend:

- `apps/web/src/components/kairos/sceneAssets.ts` — add crystal geometry refs
- `apps/web/src/components/kairos/nodeColor.ts` — add decision color (cyan/violet recommended for contrast against planet warm tones)
- `apps/web/src/lib/data/memories.ts:getBrainGraph()` — return decision nodes/edges as a distinct type the renderer can branch on
- UI toggle in `KairosShell.tsx`: "Brain / Reasoning / Both" — Brain shows memory planets, Reasoning shows decision crystals with directional flow arrows, Both overlays them

### 5.4 Acceptance

- ✅ Cartographer expanded form produces ≥30 decision nodes across 8 Dominions in one run
- ✅ Decision graph is queryable via new MCP tools: `mcp__aeon__query_decision_paths({ from, to })`
- ✅ 3D scene toggles between layers without re-mount

---

## Phase 6 — Worker daemon + worktree pool (~5 days)

**Goal:** The missing process behind `KAIROS_WORKER_URL` so `spawn_session` actually spawns. Enables Kairos to launch terminals, SSH sessions, and sandboxed Claude Code sessions on demand.

### 6.1 The daemon

**Directory to create:** `apps/kairos-worker/`

Node service that:
- Registers with the Aeon Vercel app via a shared secret + callback URL
- Exposes HTTP endpoints: `POST /spawn`, `POST /shell`, `POST /ssh`
- Manages a worktree pool per registered repo
- Streams session output back via the callback URL (Pusher channel + REST event posts)

Already wired on the Aeon side via `apps/web/src/lib/kairos/spawn.ts:29` — the daemon just needs to exist on the other end.

### 6.2 Worktree pool

For each registered repo path, maintain N pre-created worktrees:
```
shadow_app_aeon/
  ├─ (main checkout — operator works here)
  └─ .kairos-worktrees/
      ├─ pool-1/ (clean checkout, ready to be claimed)
      ├─ pool-2/
      └─ pool-3/
```

On spawn: claim one, run work in it, on completion either promote (open PR) or recycle (`git clean -fdx && git checkout main && git pull`). Pattern matches Claude's own `isolation: "worktree"` mode in the Agent tool.

### 6.3 SSH bridge

Daemon embeds `ssh2` + `node-pty`. Aeon UI opens xterm.js panel → WebSocket to daemon → daemon proxies to remote. SSH keys stay local, never touch Vercel.

For multi-machine: lean on Tailscale (zero-config mesh, matches the Visor pattern already in use).

### 6.4 Acceptance

- ✅ `spawn_session` from MCP launches a real `claude -p` in a worktree, returns sessionId, streams events back
- ✅ Operator can open an xterm panel in Aeon, run commands on the local box
- ✅ Worktree pool auto-recovers after a crashed spawn (garbage collection)

---

## Phase 7 — Autonomous Oracle (~2 days)

**Goal:** Claude Routines schedule lieutenant runs. Oracle ticks every 2h and interrupts only when warranted.

### Routine schedule

| Routine | Cadence | Invokes |
|---|---|---|
| `kairos-acolyte-sweep` | every 4h | Acolyte (drain summary backlog) |
| `kairos-oracle-pulse` | every 2h, 08:00–22:00 local | Oracle (interrupt-if-warranted) |
| `kairos-cartographer-night` | nightly 03:00 UTC | Cartographer (cortex + archetypes + decisions) |
| `kairos-sentinel-weekly` | Sunday 09:00 UTC | Sentinel (cross-Dominion sweep) |

### Push channel

Oracle's interrupt path needs a way out of the brain to the operator. Options:
- Push notification via the existing Pusher channel → desktop notification when Aeon tab is open (cheapest)
- ntfy.sh self-hosted topic → phone push (independent of having Aeon open)
- macOS Notification Center via daemon (only when Worker daemon is running)

Recommendation: Pusher first (already wired), ntfy second (mobile reach), daemon last.

---

## Open decisions (for the next session to resolve before coding)

1. **Trace memory `type`** — `'observation'` is the closest fit but pollutes that bucket. Consider adding `'trace'` to the type enum too, parallel to streamClass. Schema migration touch.

2. **Recipe versioning** — when a recipe's prompt changes meaningfully, do we re-run it across historical contexts? Probably no, but trace `recipeVersion` should be recorded so a future "re-think" tool is possible.

3. **Sentinel autonomy bound** — should Sentinel be allowed to open board cards on its own, or only flag contradictions for human review? Lean toward: flag only on the first month, allow card-opening after Sentinel has produced ≥20 useful flags.

4. **Oracle quiet hours** — config per operator. Default: 22:00–08:00 local silent.

5. **Cost cap per Routine** — Cartographer's expanded form on 8 Dominions could be expensive. Either chunk across nights (one Dominion per night × 8 nights) or run shallow daily + deep weekly.

---

## What's already in place (don't rebuild)

- `streamClass` column exists (Phase 2 commit `0d33ea0`)
- `Dominion` taxonomy + cascade (Phase 2 commit `acd90f4`)
- Cortex + archetype recipes as standalone files in `lib/kairos/cortex.ts` and `archetypes.ts` — these become Cartographer's `flat()` forms with minor wrapping
- `agent_sessions` table + `spawn_session` MCP tool — wait for Phase 6 to actually fire
- `dispatchSpawn` HTTP client in `lib/kairos/spawn.ts` — wait for Phase 6 daemon
- Chat retrieval pipeline (`lib/kairos/chat-retrieval.ts`) — Phase 3 extracts to canonical module
- 3D scene infrastructure (`components/kairos/`) — Phase 5 adds a layer, no new scene
- BYOK routing (`lib/ai/route-task.ts`) — all `flat()` forms go through here unchanged
- MCP server + 66 tools — Phase 3 adds 3 more (`run_recipe`, `list_recipes`, `get_trace_history`)

---

## Starting prompt for the new chat

Paste this into a new Claude Code session:

> Read `docs/kairos/16-handover-2026-06-03-jarvis-arc.md` then implement Phase 3 (substrate unification). The goal is one canonical retrieval module, the recipe interface and registry, the BRIEF recipe ported to use both, the dispatcher with surface-aware routing, and the three new MCP tools (`list_recipes`, `run_recipe`, `get_trace_history`). Add `'trace'` to the `streamClass` enum and write traces from `runRecipe`. Finally create the `/kairos-brief` skill at `~/.claude/skills/kairos-brief/SKILL.md` that calls `mcp__aeon__run_recipe('BRIEF', ...)` per active Dominion. Tests required for `retrieve.ts` and the dispatcher. End-of-phase acceptance is in the doc — verify all five checks before committing. Stay on `feature/kairos_phase2`, use structured commits.
