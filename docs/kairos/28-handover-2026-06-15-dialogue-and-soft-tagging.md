# Handover — Kairos Dialogue + Soft Dominion Tagging (2026-06-15)

**Branch:** `feat/kairos-dialogue` (PR #63 **MERGED** into `main` @ `fe19460`)
**Commits:** `65a049c` (Dialogue weld) · `182974a` (soft Dominion tagging)
**Supersedes:** nothing — extends doc 27 (Aether) one layer up, into conversation.

---

## TL;DR — start here

Two things landed and are live on `main`:

1. **Kairos Dialogue** — the Ask loop became a *conversation*. A pending kairos-ask (or a free topic) opens a threaded, retrieval-grounded back-and-forth that Claude Code (or Claude.ai) authors turn-by-turn with **no BYOK key**, then distils into durable reflections.
2. **Soft Dominion tagging** — a dialogue's distilled insights are no longer *pinned* to one Dominion. They're *tagged* with every front they touch (`dominion:<uuid>` reference tags) and surface from each Dominion's retrieval. Fluid grouping over rigid folders.

If you're here to **discuss the MCP + process setup**, jump to §3 (MCP surface) and §4 (the cognition-engine process). §1–2 are what shipped; §5 is open gaps.

---

## 1. What shipped — Dialogue (`65a049c`)

The "weld": three islands that already existed separately, fused into one loop.

- **Ask loop (initiative)** → `open_dialogue` seeds a thread from a pending kairos-ask; the question becomes Kairos's opening turn and the thread links back to the ask (idempotent — one open dialogue per ask).
- **Chat substrate (multi-turn memory)** → reuses `agent_sessions` + `session_events` with `engine='kairos-dialogue'`. **No new schema.** Null-Dominion allowed (floating dialogues); turn roles are `operator | kairos`.
- **Cognition-engine pattern (BYOK-free)** → `prepare_dialogue_context` packs the seed thought + grounding memories + global core narrative + full turn history + fresh per-turn retrieval. Claude Code authors each Kairos turn in-context. `commit_dialogue` distils the thread into reflections, links them to the ask, closes it.

**Files:** `lib/data/dialogue.ts` (data), `lib/kairos/dialogue.ts` (orchestration), `app/api/[transport]/tools/dialogue.ts` (5 MCP tools). 13 unit tests over the weld logic.

Driven from Claude Code by the **`/kairos-dialogue`** skill (local-only, gitignored under `.claude/skills/`).

## 2. What shipped — Soft Dominion tagging (`182974a`)

**Problem:** `commit_dialogue` forced each reflection into a single `dominionId`. A cross-front insight got filed under one Dominion and went invisible to the others it touched. The only workaround for scoping (close + reopen the thread) shredded conversational continuity.

**Fix — tag, don't pin:**

- **`lib/kairos/dominionTags.ts`** *(new)* — the convention. `dominionTag(id)` → `dominion:<uuid>`; `dominionIdsFromTags(tags)` parses them back. Id-stable (no rename drift), soft pointer (no FK), consistent with `memories.supersededById`.
- **`commit_dialogue` gains `dominionIds[]`** — every front an insight touches. Written as `dominion:<id>` tags alongside `kairos-dialogue`, deduped against the home `dominionId` (the FK already covers it). `filterLiveDominionIds(userId, ids)` (in `lib/data/dialogue.ts`) narrows to live/owned Dominions so a hallucinated id never persists a phantom tag.
- **Read-path union** — `lib/kairos/retrieve.ts` `fetchSubstrate` (both FTS + vector legs) now filters `inDominionScope(dominionId)` = `dominionId = X OR tags @> ['dominion:X']`. A reflection surfaces from **every** Dominion it references. Both legs hit existing indexes (`memories_dominion_idx` btree + `memories_tags_idx` GIN). **No migration.**
- `dominionId` stays as an optional **"home"** anchor; cross-front reflections leave it null and lean on the tags.

**Tests:** +8 (4 commit-tagging in `dialogue.test.ts`, 4 tag-convention in `dominionTags.test.ts`). Full suite **1879 green**, typecheck clean.

---

## 3. MCP surface — the Kairos synthesis tools

All of these are **synthesis-surface tools — NOT part of the Gantt MCP/REST parity invariant** (`gantt-parity.test.ts` only locks `gantt.ts`). They live on the `aeon` MCP server, user-scoped via Bearer token.

### Ask layer (one-shot) — `tools/ask.ts`
| Tool | Role |
|---|---|
| `run_kairos_ask` | Select + persist the single best proactive question from the latest Aether. Never stacks two; returns a silence/reason object on cadence-miss or no signal. The trigger seam for a scheduler. |
| `get_pending_kairos_ask` | Read the current unanswered question without selecting a new one. The read seam for delivery surfaces. |
| `answer_kairos_ask` | One-shot answer → reflection anchored to the question's Dominion → archive the question. |

### Dialogue layer (multi-turn) — `tools/dialogue.ts`
| Tool | Role |
|---|---|
| `open_dialogue` | Seed a thread from a pending ask (`questionMemoryId`) or a free `topic` (+ optional `dominionId`). Returns `threadId`. |
| `prepare_dialogue_context` | Pack seed + history + per-turn retrieval for Kairos's next turn. **The prepare half of the cognition loop.** |
| `append_dialogue_turn` | Record one turn (`role: operator\|kairos`, optional `citations`). |
| `get_dialogue` | Read-only thread + turns (resume / delivery surface). |
| `commit_dialogue` | Distil into reflections (with `dominionIds[]` auto-tagging), link to the ask, close the thread. **The commit half.** |

### Related (grounding / synthesis)
`commit_aether` / `prepare_aether_context` (Aether one-shot self-model, doc 27), `search_memories`, `get_memory_with_neighbours`, `create_memory`, `kairos_reflect`, `get_trace_history`.

### How the two layers relate
`answer_kairos_ask` is the **one-shot** answer to a pending question. Dialogue is the **conversational** form of the same beat — open from the same pending ask, volley, then `commit_dialogue` closes that same ask. Both terminate a question; pick one per question, not both.

---

## 4. The process we've implemented — the cognition-engine pattern

This is the architectural through-line worth discussing. Kairos has **no hosted LLM call** in the synthesis loop. The model *is* the runtime.

```
prepare_*   →   (model synthesises in-context)   →   commit_*
(MCP packs      Claude Code / Claude.ai is the       (MCP persists the
 grounded        cognition engine — grounded in       result as memory;
 context)        real substrate, not improvised)      no key needed)
```

- **`prepare_*`** does all the DB work: retrieval, seed expansion, history. It hands the model a bundle.
- **The model** composes the output (a Kairos turn, an Aether self-model, a distillation) *in its own context*, grounded in the bundle. No BYOK provider call.
- **`commit_*`** is dumb persistence: it writes exactly what the model supplies and does the bookkeeping (link, tag, close).

**Why this matters:** it works from any session with the MCP connector — Claude Code *or* Claude.ai — with zero API-key wiring. The cost moves from a hosted provider into the session that's already running. Aether (doc 27), Dialogue, and the lieutenants all follow this shape.

**Two drive modes:**
- **Claude Code** — the `/kairos-aether`, `/kairos-dialogue` skills script the prepare→compose→commit loop deterministically.
- **Claude.ai** — no skill; the tool *descriptions* are written to be self-driving, so a capable model walks the same loop from a plain prompt ("open a Kairos dialogue and walk it with me"). Confirmed working end-to-end on 2026-06-14.

**Deploy gate for Claude.ai:** the connector only sees tools live on the production `aeon` MCP endpoint. Dialogue tools were invisible to Claude.ai until #63 merged + deployed — now live.

---

## 5. Open gaps / next moves

1. **Floating dialogue gets no live retrieval.** `prepare_dialogue_context` only runs `retrieveContext` when `thread.dominionId` is set — a free-roaming (unanchored) dialogue comes back `retrieval: null` and leans only on the seed + global narrative. **Fix:** add an optional per-call `focusDominionId` (or `dominionIds[]`) arg to `prepare_dialogue_context`, keyed on the front the operator just named in their latest turn. Decouples *retrieval scope* (per-turn) from *thread anchor* (provenance). This closes the recall-while-live gap and pairs naturally with §2's tagging — a tagged reflection becomes findable from whichever front the turn targets. ~30 lines, no schema.
2. **Dangling Dominion tags.** Soft `dominion:<id>` tags have no FK. Delete a Dominion → tag dangles (readers ignore it). Clean future sweep: a Dominion-delete hook stripping matching tags, or an Acolyte hygiene pass.
3. **Tagging is currently dialogue-only.** The `dominionTags.ts` convention is general. If cross-front grouping proves useful, the next surfaces to teach it: `answer_kairos_ask`, `kairos_reflect`, and the `inspect_dominion` display bundle (so tagged reflections show in a Dominion's recent-memories list, not just substrate retrieval).
4. **Union scope is substrate-only.** Cortex/archetype/trace queries still filter by `dominionId` FK alone — correct today (those are lieutenant singletons, never cross-tagged), but revisit if any of them start carrying cross-front tags.

---

## 6. Where to look

- **Convention:** `apps/web/src/lib/kairos/dominionTags.ts`
- **Dialogue orchestration:** `apps/web/src/lib/kairos/dialogue.ts`
- **Dialogue data:** `apps/web/src/lib/data/dialogue.ts` (`filterLiveDominionIds`, `loadDialogue`, etc.)
- **Retrieval union:** `apps/web/src/lib/kairos/retrieve.ts` (`inDominionScope`, `fetchSubstrate`)
- **MCP tools:** `apps/web/src/app/api/[transport]/tools/{dialogue,ask}.ts`
- **Skills (local-only):** `.claude/skills/{kairos-dialogue,kairos-aether}/SKILL.md`
- **Prior context:** doc 27 (Aether), doc 25 (working with the brain), doc 22 (hybrid retrieval).
