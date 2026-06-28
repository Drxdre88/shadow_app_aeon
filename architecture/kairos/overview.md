# Kairos — The Brain, End to End

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [memory-and-capture](memory-and-capture.md) · [synthesis](synthesis.md) · [chat](chat.md)

Kairos is Aeon's memory-and-cognition layer: a user-scoped substrate of `memories`,
captured from many sources, consolidated nightly into a layered self-model, and served back
as grounded context to the operator and to AI assistants. This is the mental model from
substrate up to chat. Lieutenant detail lives in [chat.md](chat.md).

> **Conceptual frame (2026-06-27):** the operator talks to **Kairos** (the entity); **Aether**
> is his super-brain — the apex self-model above ALL Dominions. Kairos draws on Aether to pull
> what's needed across every Dominion and to compartmentalize new information into the right one.

## The conceptual hierarchy

Kairos is a *heterarchy*, not a folder tree — layers emerge from meaning and re-form as the
corpus shifts (`docs/kairos/26-cognitive-hierarchy-and-consolidation.md`):

| Tier | What it is | Status |
|---|---|---|
| **Memory** | one captured thing (a row in `memories`) | substrate |
| **Episode** | one session's memories | implicit (a `session_summary`) |
| **Concept** | a semantically coherent cluster | specced, not built |
| **Dominion** | a whole strand of work | shipped |
| **Constellation** | a family of Dominions | later |
| **Worldview / Aether** | global self-model across everything | shipped (Aether) |

## How a piece of information flows in and gets compartmentalized

Every inbound write lands through `captureMemory()` (`apps/web/src/lib/data/memories.ts:731`)
→ `createMemory()` (`:643`). At write time two things happen: (1) **Dominion resolution** —
`resolveDominionForMemory()` (`apps/web/src/lib/data/dominions.ts:323`) picks the home Dominion
in strict order `explicit dominionId` ?? `project.dominionId` ?? `dominionRepos` via
`sourceMetadata.repo` ?? `null`; (2) **stream classification** — a `streamClass` axis
(`apps/web/src/lib/kairos/streamClass.ts`) tags the cognitive layer and stamps a provenance
`confidence` prior (`CONFIDENCE_BY_STREAM`, `memories.ts:52`). A memory has ONE home Dominion
(the FK) but can be *referenced* by any number via soft `dominion:<uuid>` tags
(`apps/web/src/lib/kairos/dominionTags.ts`), so a cross-front reflection surfaces from every
Dominion it touches without being owned by one.

## The layers

**Substrate.** The `memories` table is the single user-scoped store: title / `aiTitle` /
`summary` / `execSummary[]` / `bodyMd`, a `type` discriminator, the `streamClass` cognitive
axis, `confidence`, `embedding vector(1024)` + `embedding_model`, supersession columns,
`pinned`, `archivedAt`, and a typed-edge `links` graph. Postgres FTS + a pgvector HNSW index
make it hybrid-searchable. See [memory-and-capture.md](memory-and-capture.md).

**Capture (ingress).** Information arrives many ways: fire-and-forget **auto-capture** of
board/project events; the nightly **project-snapshot** cron; **quick capture** + the generic
`POST /api/v1/memories/capture` endpoint; the **Claude session-capture hook**
(`apps/web/scripts/claude-session-capture.mjs`) that distils each finished Claude Code session
into a `session_summary`; **reflections** (`kairos_reflect`, the operator's first-class
high-weight signal); and the **guided-introspection** propose-not-commit loop that stages
Kairos's own thoughts as `inbound` proposals.

**Synthesis (consolidation).** Nightly, the substrate is distilled upward: **archetypes** (3–7
master nodes per Dominion), the per-Dominion living **cortex**, and **Aether** — the single
global self-model. The **Briefer** writes one morning advisory per active Dominion. Everything
runs through a single `runRecipe()` **dispatcher** + **retrieval** module. See
[synthesis.md](synthesis.md).

**Retrieval.** `retrieveContext()` (`apps/web/src/lib/kairos/retrieve.ts:65`) is the canonical
fetch: Dominion bundle + live cortex + live archetypes + top-5 hybrid (FTS+vector RRF-fused)
substrate hits + recent traces. The generic `prepareContext()` (`memories.ts:1357`) packs a
budget-bounded markdown bundle for any AI window.

**Reflection / ask / dialogue.** Beyond passive capture, Kairos initiates: **Kairos Asks**
select the single proactive question worth interrupting with (derived from Aether's tensions);
**Dialogue** opens a multi-turn threaded conversation seeded by a pending ask, generated
turn-by-turn from grounded context (Claude Code as the cognition engine, no BYOK key), and
distils the finished thread back into durable reflections. See [chat.md](chat.md).

**Chat + lieutenants.** The right-side **Visor** is a per-Dominion slide-out chat grounded in
that Dominion's cortex + archetypes + substrate. The **lieutenants** (acolyte / sentinel /
cartographer / oracle) operate over the same retrieval + recipe machinery — detail in
[chat.md](chat.md).

## Layering diagram

```
                     ┌───────────────────────────────┐
   CHAT / ASK /      │  Visor · Kairos Asks ·        │   ← operator dialogue
   DIALOGUE          │  Dialogue · lieutenants       │     + initiative
                     └───────────────┬───────────────┘
                                     │ retrieveContext / prepareContext
   ┌─────────────────────────────────┴───────────────────────────────┐
   │  SYNTHESIS (nightly, per-user)                                    │
   │     Aether        (global self-model, 1/day)                      │
   │       ▲ Cortex    (1 living doc per Dominion/day)                 │
   │       ▲ Archetypes(3–7 master nodes per Dominion/day)            │
   │       ▲ Briefer   (1 advisory per Dominion/day)                   │
   └───────────────────────────────┬───────────────────────────────┘
                                     │ reads / writes
   ┌─────────────────────────────────┴───────────────────────────────┐
   │  SUBSTRATE   memories[]   (FTS + pgvector HNSW, typed-link graph) │
   │  streamClass: idea·agentic·execution·reflection·cortex·archetype  │
   │              ·advisory·trace·snapshot·aether                       │
   └───────────────────────────────▲───────────────────────────────┘
                                     │ captureMemory → createMemory
   ┌─────────────────────────────────┴───────────────────────────────┐
   │  CAPTURE   auto-capture · project-snapshot cron · quick capture · │
   │            /memories/capture · session-capture hook ·            │
   │            reflections · introspection proposals                  │
   └───────────────────────────────────────────────────────────────┘

  Compartmentalization at write time:
    dominionId  ??  project.dominionId  ??  dominionRepos[repo]  ??  null
    + soft dominion:<id> tags for many-to-many cross-front reference
```
